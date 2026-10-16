// 2.5D plate compositor (docs/world/sets.md "Plates"): a pre-rendered beauty plate per gameplay camera, drawn as a
// full-screen pass that re-projects every pixel's view ray into the plate camera (so safe-area offsets, aspect and
// a little drift never show an edge), cross-fades two lighting keys, and writes the plate's depth so live actors
// (crops, people, animals, windmill wheel, smoke, weather) occlude and are occluded correctly. A low-poly proxy
// catches the live actors' shadows as a matte.
import * as THREE from 'three/webgpu';
import {
  Fn, texture, uniform, vec2, vec4, float, screenUV, cameraProjectionMatrixInverse, cameraWorldMatrix, cameraPosition, cameraNear, cameraFar,
  viewZToPerspectiveDepth, perspectiveDepthToViewZ, mix, select, cameraViewMatrix, positionGeometry, exp,
} from 'three/tsl';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { loadGltf } from '../engine/gltf';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

interface PlateKey {
  sunDir: [number, number, number];
  sunColor: [number, number, number];
  sunIntensity: number;
  ambient?: [number, number, number];
  ambientUp?: [number, number, number];
  ambientDown?: [number, number, number];
  exposure?: number;
  hdri?: string;
}
export interface PlateJson {
  version: number;
  view: string;
  camera: { pos: [number, number, number]; look: [number, number, number]; up?: [number, number, number]; fovY: number; aspect: number; near?: number; far?: number };
  overscan?: number;
  keys: Record<string, PlateKey>;
  layers?: { id: string; when: Record<string, unknown>; bbox?: number[]; /** per key: layer images are cropped to this rect (full-plate px) */ cropByKey?: Record<string, [number, number, number, number]> }[];
  live?: string[];
  shadowMatte?: { strength: number; maxDistance?: number };
  size?: [number, number];
  /** baked field squares (sets.md): crop bbox in full-plate px, variant images at `scale` */
  squares?: { bbox: [number, number, number, number]; scale?: number; variants: string[]; /** per-variant RGBM range (default 8) */ range?: Record<string, number> };
  /** 'logdepth8': data images packed by scripts/plates/pack.ts (else EXR) */
  data?: string;
  dataDepth?: { d0: number; lnRange: number };
}

const BASE = `${import.meta.env.BASE_URL}world/plates/`;

export interface PlateLayer {
  id: string;
  when: Record<string, unknown>;
  /** group of per-key quads (one material per key with FIXED textures: swapping a texture binding for one of a
   *  different size kept the stale binding on WebGPU, which drew cropped layers stretched) */
  quad: THREE.Group;
  /** per key index: the quad (undefined until that key's images exist) */
  keyQuads: (THREE.Mesh | undefined)[];
  /** per key index: weight uniform */
  weights: (N | undefined)[];
  /** per key index: crop rect (full-plate px) or undefined = full frame */
  crops: ([number, number, number, number] | undefined)[];
}
export interface PlateState {
  house: string;
  barn: boolean;
  windmill: boolean;
  year: number;
  fence: number;
  [k: string]: unknown;
}
/** sets.md layer conditions: house: [...], barn, windmill (bool or era), yearMin/yearMax, fenceMin, any */
function layerMatches(w: Record<string, unknown>, st: PlateState): boolean {
  if (Array.isArray(w.any)) return w.any.some((c) => layerMatches(c as Record<string, unknown>, st));
  if (w.any === true) return true;
  if (Array.isArray(w.extras) && !w.extras.every((e) => (st.extras as string[] | undefined)?.includes(e as string))) return false;
  if (typeof w.townGrowthMin === 'number' && Number(st.townGrowth ?? 0) < w.townGrowthMin) return false;
  if (typeof w.townGrowthBelow === 'number' && Number(st.townGrowth ?? 0) >= w.townGrowthBelow) return false;
  if (Array.isArray(w.house) && !w.house.includes(st.house)) return false;
  if (typeof w.house === 'string' && w.house !== st.house) return false;
  if (w.barn !== undefined && !!w.barn !== st.barn) return false;
  if (typeof w.windmill === 'string' && (!st.windmill || w.windmill !== st.era)) return false;
  if (typeof w.windmill === 'boolean' && w.windmill !== st.windmill) return false;
  if (typeof w.yearMin === 'number' && st.year < w.yearMin) return false;
  if (typeof w.yearMax === 'number' && st.year > w.yearMax) return false;
  if (typeof w.fenceMin === 'number' && st.fence < w.fenceMin) return false;
  for (const [k, v] of Object.entries(w)) {
    if (['any', 'house', 'barn', 'windmill', 'yearMin', 'yearMax', 'fenceMin', 'bbox', 'townGrowthMin', 'townGrowthBelow', 'extras'].includes(k)) continue;
    if (k in st && st[k] !== v) return false;
  }
  return true;
}

/** A plate source: either RGBM 8-bit images + planar EXR depth (baked), or a live render target (self-test). */
export interface PlateSource {
  beauty: THREE.Texture[]; // one per key, same order as keys
  rgbm: boolean;
  depth: THREE.Texture;
  /** 'planar' = metres along the plate camera's forward axis; 'ndc' = perspective depth buffer of the plate camera */
  depthMode: 'planar' | 'ndc';
  camera: THREE.PerspectiveCamera; // the plate camera (world matrices + projection)
  /** data images packed by scripts/plates/pack.ts (8-bit WebP, log depth in R,G; rows top-down) instead of EXR */
  packed?: { d0: number; lnRange: number };
}

/** Images load as ImageBitmaps: decoded off the main thread, raw (no premultiply / colour conversion, which RGBM and
 *  packed data need), so the GPU upload is a plain copy (an <img> upload decoded synchronously: 200+ ms tasks). */
const bitmaps = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
const loadImage = (url: string): Promise<THREE.Texture> =>
  bitmaps.loadAsync(url).then((img) => {
    const t = new THREE.Texture(img as ImageBitmap);
    t.premultiplyAlpha = false;
    t.needsUpdate = true;
    return t;
  });

const prepRGBM = (t: THREE.Texture): THREE.Texture => {
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
};

export class PlateView {
  /** resolves when the world is idle enough for background streaming (set by the world; default: next idle) */
  static whenQuiet: () => Promise<void> = () => new Promise((r) => setTimeout(r, 250));
  /** upload a texture to the GPU now (set by the world: renderer.initTexture) */
  static initTexture: ((t: THREE.Texture) => void) | null = null;

  json: PlateJson | null = null;
  keys: string[] = [];
  quad: THREE.Mesh;
  proxy: THREE.Object3D | null = null;
  /** key blend: 0 = keys[a], 1 = keys[b] */
  uBlend = uniform(0);
  private uViewProj = uniform(new THREE.Matrix4());
  private uPlateNear = uniform(0.3);
  private uPlateFar = uniform(9000);
  private uPlateView = uniform(new THREE.Matrix4());
  private texA: N;
  private texB: N;
  /** every image the plate draws (base keys, depth, layer colour + data): uploaded ahead by the world */
  textures = new Set<THREE.Texture>();
  /** stands in for B whenever B would be the same Texture as A (see setKeys) */
  private bSpare: THREE.Texture;
  private texD: N;
  src: PlateSource;

  constructor(src: PlateSource) {
    this.src = src;
    const cam = src.camera;
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    (this.uViewProj.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    (this.uPlateView.value as THREE.Matrix4).copy(cam.matrixWorldInverse);
    this.uPlateNear.value = cam.near;
    this.uPlateFar.value = cam.far;
    this.texA = texture(src.beauty[0]);
    // texB must never start as the same Texture object as texA: the node builder would share one binding between
    // them, and B (a key streamed in later) would then sample A's image forever. A clone shares the image (same size).
    this.bSpare = src.beauty[0].clone();
    this.bSpare.needsUpdate = true;
    this.texB = texture(src.beauty[1] && src.beauty[1] !== src.beauty[0] ? src.beauty[1] : this.bSpare);
    this.texD = texture(src.depth);
    for (const t of [...src.beauty, this.bSpare, src.depth]) this.textures.add(t);
    const m = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: true });
    m.name = 'plate';
    m.toneMapped = true;
    const rgbm = src.rgbm;
    const ndcDepth = src.depthMode === 'ndc';
    const uvT = this.uvNode();
    const decode = (t: N) => (rgbm ? t.rgb.mul(t.a).mul(8) : t.rgb);
    m.colorNode = Fn(() => {
      const a = decode(this.texA.sample(uvT));
      const b = decode(this.texB.sample(uvT));
      return vec4(mix(a, b, this.uBlend as N) as N, 1);
    })();
    m.depthNode = Fn(() => {
      const d = this.dataDepth(this.texD.sample(this.src.depthMode === 'planar' ? this.dataUV(uvT) : uvT));
      const planar = ndcDepth ? perspectiveDepthToViewZ(d, this.uPlateNear, this.uPlateFar).negate() : d;
      return this.depthFromPlanar(planar);
    })();
    const geo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geo, m);
    this.quad.frustumCulled = false;
    this.quad.renderOrder = -1000;
    // keep the quad in clip space: the vertex stage outputs the plane directly
    m.vertexNode = vec4(positionGeometry.xy, 0, 1);
  }

  /** uv into a data image: EXR rows are stored bottom-up, packed WebP rows top-down like the colour */
  private dataUV(uv: N): N {
    return this.src.packed ? uv : vec2(uv.x, float(1).sub(uv.y));
  }
  /** planar depth (m) from a data image sample */
  private dataDepth(t: N): N {
    const pk = this.src.packed;
    if (!pk) return t.r;
    const u = t.r.mul(255 * 256).add(t.g.mul(255)).div(65535);
    return exp(u.mul(pk.lnRange)).mul(pk.d0);
  }

  /** plate texture uv of this pixel: its live view ray re-projected through the plate camera */
  uvNode(): N {
    return Fn(() => {
      const ndc = vec4(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y.mul(2)), 1, 1);
      const v = cameraProjectionMatrixInverse.mul(ndc);
      const world = cameraWorldMatrix.mul(vec4(v.xyz.div(v.w), 1)).xyz;
      const p = this.uViewProj.mul(vec4(world, 1));
      const q = p.xy.div(p.w);
      // decoded images (flipY = false) and WebGPU render targets both store row 0 at the top
      return vec2(q.x.mul(0.5).add(0.5), float(0.5).sub(q.y.mul(0.5)));
    })();
  }

  /** plate planar depth (m along the plate camera's forward) -> the live depth-buffer value along this pixel's ray */
  depthFromPlanar(planarIn: N): N {
    // bias the plate a little behind its baked depth: live actors standing in baked grass / on baked ground would
    // otherwise z-fight it (speckles of plate pixels over animals); real occluders are metres in front, unaffected
    const planar = planarIn.mul(1.004).add(0.25);
    const ndc = vec4(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y.mul(2)), 1, 1);
    const v = cameraProjectionMatrixInverse.mul(ndc);
    const dirW = cameraWorldMatrix.mul(vec4(v.xyz.div(v.w), 0)).xyz.normalize();
    const fwdPlate = this.uPlateView.transpose().mul(vec4(0, 0, -1, 0)).xyz;
    const t = planar.div(dirW.dot(fwdPlate).max(1e-4));
    const pW = cameraPosition.add(dirW.mul(t));
    const viewZ = cameraViewMatrix.mul(vec4(pW, 1)).z;
    const sky = planar.greaterThan(this.uPlateFar.mul(0.98));
    return select(sky, float(1), viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar).clamp(0, 1));
  }

  // ------------------------------------------------------------------ layers (buildings by state, town stages)
  layers: PlateLayer[] = [];

  /** Composite: out = layer + plate*(1-alpha)*shadow (premultiplied RGBM colour; EXR R depth, G alpha, B shadow).
   *  Blend One / OneMinusSrcAlpha with alpha' = 1-(1-a)*shadow; depth = min(plate, layer). */
  addLayer(id: string, when: Record<string, unknown>): PlateLayer {
    const g = new THREE.Group();
    g.name = 'plateLayer:' + id;
    const L: PlateLayer = { id, when, quad: g, keyQuads: [], weights: [], crops: [] };
    this.layers.push(L);
    this.quad.add(g);
    return L;
  }

  /** the quad that composites layer `L` for key index `i` from its (fixed) colour + data images.
   *  Composite: out = w*layer + plate*(1 - w*(1-(1-alpha)*shadow)) (premultiplied RGBM colour; EXR R depth, G alpha,
   *  B shadow), depth = min(plate, layer) where the layer covers. */
  setLayerKey(L: PlateLayer, i: number, colour: THREE.Texture, data: THREE.Texture, crop?: [number, number, number, number]): void {
    const old = L.keyQuads[i];
    if (old) {
      old.removeFromParent();
      (old.material as THREE.Material).dispose();
    }
    this.textures.add(colour).add(data);
    const size = this.json?.size ?? [2560, 1440];
    const c = crop ?? [0, 0, size[0], size[1]];
    const tC = texture(colour);
    const tD = texture(data);
    const plateD = texture(this.src.depth);
    const w = uniform(0);
    const m = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true, transparent: false });
    m.depthFunc = THREE.LessEqualDepth;
    m.name = 'plateLayer';
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    const uvFull = this.uvNode();
    const px = vec2(uvFull.x.mul(size[0]), uvFull.y.mul(size[1]));
    // the crop is a uniform (not a constant): every layer quad then compiles to the same shader program and the
    // pipeline cache serves them all (constants made ~100 distinct pipelines on Main Street)
    const uc = uniform(new THREE.Vector4(c[0], c[1], 1 / (c[2] - c[0]), 1 / (c[3] - c[1])));
    const uv = vec2(px.x.sub(uc.x).mul(uc.z), px.y.sub(uc.y).mul(uc.w));
    const inside = uv.x.greaterThanEqual(0).and(uv.x.lessThanEqual(1)).and(uv.y.greaterThanEqual(0)).and(uv.y.lessThanEqual(1));
    // EXR data textures are stored bottom-up relative to the webp colour
    const uvE = this.dataUV(uv);
    const uvPE = this.dataUV(uvFull);
    // layer data: depth, alpha, shadow (EXR: R, G, B; packed: R+G log depth, A alpha, B shadow)
    const pk = !!this.src.packed;
    const alphaOf = (t: N): N => (pk ? t.a : t.g);
    m.colorNode = Fn(() => {
      const cc = tC.sample(uv);
      const dd = tD.sample(uvE);
      const col = cc.rgb.mul(cc.a).mul(8).mul(w);
      const cover = float(1).sub(float(1).sub(alphaOf(dd)).mul(dd.b)).mul(w);
      return select(inside, vec4(col, cover), vec4(0, 0, 0, 0));
    })();
    m.depthNode = Fn(() => {
      const pl = this.dataDepth(plateD.sample(uvPE));
      const lay = this.dataDepth(tD.sample(uvE));
      return this.depthFromPlanar(select(inside, lay.min(pl), pl));
    })();
    m.vertexNode = vec4(positionGeometry.xy, 0, 1);
    const q = new THREE.Mesh(this.quad.geometry, m);
    q.frustumCulled = false;
    q.renderOrder = -999.5 + this.layers.indexOf(L) * 0.01;
    q.visible = false;
    L.keyQuads[i] = q;
    L.weights[i] = w;
    L.crops[i] = crop;
    L.quad.add(q);
  }

  /** show the layers whose `when` matches the world state */
  applyState(st: PlateState): void {
    for (const l of this.layers) l.quad.visible = layerMatches(l.when, st);
  }

  /** keys whose images are loaded (the others are aliased to a loaded key until they stream in) */
  loadedKeys = new Set<string>();
  /** load one lighting key now (no-op once loaded): for a cinematic that needs it immediately */
  ensureKey: (key: string) => Promise<void> = async () => undefined;
  // ------------------------------------------------------------------ baked field squares (sets.md "squares")
  view = '';
  squareQuads: THREE.Mesh[] = [];
  private sqTex = new Map<string, Promise<THREE.Texture | null>>();
  private sqReady = new Map<string, THREE.Texture>();
  private sqState: { a: N; b: N; w: N; w2: N; front: N; on: boolean; ra: N; rb: N; rw: N }[] = [];

  /** build the 16 masked square quads (call once the mask is loaded) */
  initSquares(mask: THREE.Texture): void {
    const sq = this.json?.squares;
    if (!sq) return;
    const size = this.json?.size ?? [2560, 1440];
    const [x0, y0, x1, y1] = sq.bbox;
    const uvP = this.uvNode();
    const cropUV = vec2(uvP.x.mul(size[0]).sub(x0).div(x1 - x0), uvP.y.mul(size[1]).sub(y0).div(y1 - y0));
    const maskS = texture(mask, cropUV);
    // four distinct placeholders: slots built on one shared Texture would share one binding (see setKeys)
    const ph = [0, 1, 2, 3].map(() => {
      const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      t.needsUpdate = true;
      return t;
    });
    for (let i = 0; i < 16; i++) {
      const a = texture(ph[0], cropUV);
      const b = texture(ph[1], cropUV);
      const w = texture(ph[2], cropUV);
      const w2 = texture(ph[3], cropUV);
      const front = uniform(-1);
      const ra = uniform(8);
      const rb = uniform(8);
      const rw = uniform(8);
      const m = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, transparent: false });
      m.name = 'plateSquare';
      const inCrop = cropUV.x.greaterThanEqual(0).and(cropUV.x.lessThanEqual(1)).and(cropUV.y.greaterThanEqual(0)).and(cropUV.y.lessThanEqual(1));
      const mk = maskS.sample(cropUV);
      const mine = mk.r.mul(255).sub(i + 1).abs().lessThan(0.5).and(inCrop);
      m.colorNode = Fn(() => {
        const dec = (t: N, r: N) => t.sample(cropUV).rgb.mul(t.sample(cropUV).a).mul(r);
        const cur = mix(dec(a, ra), dec(b, rb), this.uBlend as N);
        // work in progress: west of the front already shows the new variant
        const done = mk.g.lessThan(front);
        // (the new variant cross-fades between the same two keys as the current one)
        return vec4(select(done, mix(dec(w, rw), dec(w2, rw), this.uBlend as N), cur) as N, 1);
      })();
      m.opacityNode = select(mine, float(1), float(0));
      m.alphaTest = 0.5;
      m.vertexNode = vec4(positionGeometry.xy, 0, 1);
      const q = new THREE.Mesh(this.quad.geometry, m);
      q.frustumCulled = false;
      q.renderOrder = -999.3;
      q.visible = false;
      this.quad.add(q);
      this.squareQuads.push(q);
      this.sqState.push({ a, b, w, w2, front, on: false, ra, rb, rw });
    }
  }

  private sqLoad(key: string, variant: string): THREE.Texture | null {
    const id = `${key}/${variant}`;
    const hit = this.sqReady.get(id);
    if (hit) return hit;
    if (!this.sqTex.has(id)) {
      const sc = this.json?.squares;
      // (variants lists can be per-key subsets, e.g. snow: just try the file; misses fall back to another key)
      if (!sc) return null;
      this.sqTex.set(
        id,
        loadImage(`${BASE}${this.view}/squares/${key}/${variant}.webp`)
          .then((t) => {
            prepRGBM(t);
            this.sqReady.set(id, t);
            return t;
          })
          .catch(() => {
            this.sqMissing.add(id);
            return null;
          }),
      );
    }
    return null;
  }
  private sqMissing = new Set<string>();
  private sqClones = new Map<THREE.Texture, THREE.Texture[]>();
  private sqClone(t: THREE.Texture, n: number): THREE.Texture {
    let list = this.sqClones.get(t);
    if (!list) this.sqClones.set(t, (list = []));
    if (!list[n]) {
      list[n] = t.clone();
      list[n].needsUpdate = true;
    }
    return list[n];
  }
  /** a key whose square images exist (keys still rendering fall back to one that has landed) */
  private sqKey(key: string, variant: string): string {
    if (!this.sqMissing.has(`${key}/${variant}`)) return key;
    return this.keys.find((k) => !this.sqMissing.has(`${k}/${variant}`)) ?? key;
  }

  /** per frame: show square i as `variant` (null = not owned: the base plate's prairie); returns true when shown */
  setSquare(i: number, variant: string | null, keyA: string, keyB: string, work?: { variant: string; front: number }): boolean {
    const q = this.squareQuads[i];
    const st = this.sqState[i];
    if (!q || !st) return false;
    const ta = variant ? this.sqLoad(this.sqKey(keyA, variant), variant) : null;
    const tb = variant ? (this.sqLoad(this.sqKey(keyB, variant), variant) ?? ta) : null;
    const tw = work ? this.sqLoad(this.sqKey(keyA, work.variant), work.variant) : null;
    const tw2 = work ? (this.sqLoad(this.sqKey(keyB, work.variant), work.variant) ?? tw) : null;
    const on = !!(ta && tb && (!work || tw));
    // a variant still streaming in: the square holds its last image (no flash of the base plate's prairie)
    if (!on) {
      if (!variant) q.visible = st.on = false;
      return false;
    }
    q.visible = st.on = true;
    {
      // the four slots must hold distinct Texture objects (a shared one merges their bindings for good, see
      // setKeys): a repeat gets a clone sharing the same image
      const used: THREE.Texture[] = [];
      const slot = (t: THREE.Texture): THREE.Texture => {
        let o = t;
        for (let n = 0; used.includes(o); n++) o = this.sqClone(t, n);
        used.push(o);
        return o;
      };
      st.a.value = slot(ta!);
      st.b.value = slot(tb!);
      st.w.value = slot(tw ?? ta!);
      st.w2.value = slot(tw2 ?? tw ?? tb!);
      st.front.value = work ? work.front : -1;
      const rng = (v: string | undefined) => (v && this.json?.squares?.range?.[v]) || 8;
      st.ra.value = rng(variant ?? undefined);
      st.rb.value = rng(variant ?? undefined);
      st.rw.value = rng(work?.variant ?? variant ?? undefined);
    }
    return on;
  }

  /** show keys[a] blended toward keys[b] by t (texture swaps only: no rebuild) */
  setKeys(a: string, b: string, t: number): void {
    const ia = Math.max(0, this.keys.indexOf(a));
    const ib = Math.max(0, this.keys.indexOf(b));
    const ba = this.src.beauty[ia] ?? this.src.beauty[0];
    const bb = this.src.beauty[ib] ?? this.src.beauty[0];
    // A and B must never hold the same Texture object: a pipeline (re)built in that state shares one binding
    // between them and B then samples A's image for good (a blend to a streamed key never showed). B is unused
    // at blend 0, so a stand-in is fine.
    this.texA.value = ba;
    this.texB.value = bb !== ba ? bb : this.texB.value !== ba ? this.texB.value : this.bSpare;
    this.uBlend.value = bb !== ba ? THREE.MathUtils.clamp(t, 0, 1) : 0;
    // layers: each key has its own quad; show the two in use, weighted (a key not loaded yet uses a loaded one)
    const tt = THREE.MathUtils.clamp(t, 0, 1);
    for (const l of this.layers) {
      const pick = (k: number) => (l.keyQuads[k] ? k : l.keyQuads.findIndex(Boolean));
      const ka = pick(ia);
      const kb = pick(ib);
      // A composites fully, then B is cross-faded over it with weight t: out = t*Lb + (La + P(1-aa)) * (1 - t*ab).
      // (weighting both by (1-t) / t let half the plate show through opaque layers: ghosted buildings)
      const base = -999.5 + this.layers.indexOf(l) * 0.01;
      l.keyQuads.forEach((q, k) => {
        if (!q) return;
        const wgt = k === ka ? (ka === kb ? 1 : tt > 0.999 ? 0 : 1) : k === kb ? tt : 0;
        q.visible = wgt > 0.001;
        q.renderOrder = base + (k === kb && ka !== kb ? 0.005 : 0);
        l.weights[k]!.value = wgt;
      });
    }
  }

  /** the key pair + blend for a time of day / weather (keys: morning, golden, overcast, snow) */
  keyFor(hour: number, weather: string, snow: number): [string, string, number] {
    const has = (k: string) => this.keys.includes(k);
    // interiors bake 'day' / 'evening': daylight through the window until ~16:30, lamp-lit by ~19:00
    if (has('day') || has('evening')) {
      const d = has('day') ? 'day' : 'evening';
      const e = has('evening') ? 'evening' : d;
      return [d, e, THREE.MathUtils.smoothstep(hour, 16.5, 19)];
    }
    if (snow > 0.5 && has('snow')) return ['snow', 'snow', 0];
    if ((weather === 'overcast' || weather === 'rain' || weather === 'storm') && has('overcast')) return ['overcast', 'overcast', 0];
    const m = has('morning') ? 'morning' : this.keys[0];
    const g = has('golden') ? 'golden' : m;
    // morning look until early afternoon, easing into golden hour from ~15:00 to 17:30
    return [m, g, THREE.MathUtils.smoothstep(hour, 14.5, 17.5)];
  }

  dispose(): void {
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    for (const t of this.src.beauty) t.dispose();
    for (const l of this.layers) for (const q of l.keyQuads) if (q) (q.material as THREE.Material).dispose();
    this.src.depth.dispose();
  }

  /** Load a baked plate view from public/world/plates/<view>/ (keys = the first two in plate.json, or `keys`). */
  /** Load a plate view. Only the keys in `first` (default: all) are awaited; the others stream in afterwards and
   *  are used once loaded (until then setKeys falls back to a loaded key), so a cold visit waits for one key. */
  static async load(view: string, keys?: string[], heldKeys: string[] = [], first?: string[]): Promise<PlateView | null> {
    try {
      const json = (await (await fetch(`${BASE}${view}/plate.json`)).json()) as PlateJson;
      for (const k of heldKeys) delete json.keys[k];
      const ks = keys ?? Object.keys(json.keys);
      const firstKs = (first ?? ks).filter((k) => ks.includes(k));
      if (!firstKs.length) firstKs.push(ks[0]);
      const packed = json.data === 'logdepth8' && json.dataDepth ? json.dataDepth : undefined;
      const exr = new EXRLoader().setDataType(THREE.HalfFloatType);
      const loadData = (url: string): Promise<THREE.Texture> =>
        packed
          ? loadImage(url.replace(/\.exr$/, '.data.webp')).then((t) => {
              t.flipY = false;
              t.colorSpace = THREE.NoColorSpace;
              t.generateMipmaps = false;
              t.minFilter = t.magFilter = THREE.NearestFilter;
              t.needsUpdate = true;
              return t;
            })
          : exr.loadAsync(url).then((t) => {
              t.flipY = false;
              t.minFilter = t.magFilter = THREE.NearestFilter;
              return t;
            });
      const beauty: THREE.Texture[] = [];
      const colour = new Map<string, THREE.Texture[]>();
      const data = new Map<string, THREE.Texture[]>();
      const missing = new Set<string>();
      /** one key: beauty + every layer's colour/data */
      const loadKey = async (k: string): Promise<void> => {
        const i = ks.indexOf(k);
        const jobs: Promise<unknown>[] = [loadImage(`${BASE}${view}/${k}/beauty.webp`).then((t) => (beauty[i] = prepRGBM(t)))];
        for (const L of json.layers ?? []) {
          if (!colour.has(L.id)) colour.set(L.id, []);
          if (!data.has(L.id)) data.set(L.id, []);
          jobs.push(
            Promise.all([loadImage(`${BASE}${view}/layers/${L.id}/${k}.webp`).then(prepRGBM), loadData(`${BASE}${view}/layers/${L.id}/${k}.exr`)])
              .then(([c, d]) => {
                colour.get(L.id)![i] = c;
                data.get(L.id)![i] = d;
              })
              .catch(() => missing.add(L.id)),
          );
        }
        await Promise.all(jobs);
      };
      const [depth] = await Promise.all([loadData(`${BASE}${view}/depth.exr`), ...firstKs.map(loadKey)]);
      // a plate whose state layers can't all be composited would leave holes (e.g. a missing house): stay live
      if (missing.size) {
        console.warn('[plates] not using', view, '- missing layers:', [...missing].join(', '));
        return null;
      }
      const c = json.camera;
      const cam = new THREE.PerspectiveCamera(c.fovY, c.aspect, c.near ?? 0.3, c.far ?? 9000);
      cam.position.fromArray(c.pos);
      if (c.up) cam.up.fromArray(c.up);
      cam.lookAt(new THREE.Vector3().fromArray(c.look));
      const i0 = ks.indexOf(firstKs[0]);
      const dense = <T,>(arr: T[]): T[] => ks.map((_k, i) => arr[i] ?? arr[i0]);
      const pv = new PlateView({ beauty: dense(beauty), rgbm: true, depth, depthMode: 'planar', camera: cam, packed });
      pv.json = json;
      pv.keys = ks;
      pv.view = view;
      pv.loadedKeys = new Set(firstKs);
      if (json.squares) {
        try {
          const mask = await loadImage(`${BASE}${view}/squares/mask.png`);
          mask.flipY = false;
          mask.colorSpace = THREE.NoColorSpace;
          mask.generateMipmaps = false;
          mask.minFilter = mask.magFilter = THREE.NearestFilter;
          pv.initSquares(mask);
        } catch (e) {
          console.info('[plates] squares mask missing', view, (e as Error)?.message ?? e);
        }
      }
      for (const L of json.layers ?? []) {
        const pl = pv.addLayer(L.id, L.when);
        for (const k of firstKs) {
          const i = ks.indexOf(k);
          pv.setLayerKey(pl, i, colour.get(L.id)![i], data.get(L.id)![i], L.cropByKey?.[k]);
        }
      }
      const keyJobs = new Map<string, Promise<void>>();
      pv.ensureKey = (k: string) => {
        if (pv.loadedKeys.has(k) || !ks.includes(k)) return Promise.resolve();
        let j = keyJobs.get(k);
        if (!j) {
          j = (async () => {
            await loadKey(k);
            const i = ks.indexOf(k);
            if (missing.size || !beauty[i]) return; // keep using the fallback key
            // upload before the first bind: a bind group built while a streamed texture had no GPU copy yet kept
            // sampling the old key (the snow key never showed as the B side of a blend)
            const up = [beauty[i], ...pv.layers.flatMap((l) => [colour.get(l.id)![i], data.get(l.id)![i]])];
            for (let n = 0; n < up.length; n++) {
              PlateView.initTexture?.(up[n]);
              if (n % 3 === 2) await new Promise((r) => setTimeout(r, 0));
            }
            pv.src.beauty[i] = beauty[i];
            pv.textures.add(beauty[i]);
            for (const l of pv.layers) pv.setLayerKey(l, i, colour.get(l.id)![i], data.get(l.id)![i], json.layers?.find((L) => L.id === l.id)?.cropByKey?.[k]);
            pv.loadedKeys.add(k);
          })();
          keyJobs.set(k, j);
        }
        return j;
      };
      // the remaining keys stream in at low priority; swap them in as each completes
      void (async () => {
        for (const k of ks) {
          if (pv.loadedKeys.has(k)) continue;
          // never while a transition / load is running: EXR decode is main-thread work that would hitch it
          await PlateView.whenQuiet();
          await pv.ensureKey(k);
        }
      })();
      // shadow matte: the ground-only proxy (proxy.glb also holds base-plate masses, which drew phantom geometry)
      // (only outdoor plates bake one; they declare shadowMatte. Interiors have none: don't 404 for it)
      if (json.shadowMatte)
        try {
          const g = await loadGltf(`world/plates/${view}/proxy_ground.glb`);
          pv.proxy = g.scene.clone(true);
        } catch {
          /* no ground proxy yet: no live shadows on the plate */
        }
      return pv;
    } catch (e) {
      console.info('[plates] no plate for', view, (e as Error)?.message ?? e);
      return null;
    }
  }
}
