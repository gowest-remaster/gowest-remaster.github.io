// Homestead kit GLB loading: meshopt + WebP glTF from public/world/assets/homestead, baked PBR materials
// upgraded to node materials (rain darkening + snow via engine/tsl weathering), plant cards with wind,
// *_LOD0/1/2 siblings turned into THREE.LOD.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { texture, uv, vec3, float, attribute, positionLocal, positionWorld, sin, mix, normalMap, vec2, normalViewGeometry, luminance, uniform } from 'three/tsl';
import { uTime, uWind, uWindDir, weatherColor, weatherRough, tnoise } from '../../engine/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const BASE = `${import.meta.env.BASE_URL}world/assets/homestead/`;
const gltf = new GLTFLoader();
gltf.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Object3D>>();

/** LOD switch distances in metres: LOD1 beyond [0], LOD2 beyond [1]. */
export const LOD_DIST: [number, number] = [40, 110];

export function toLOD(root: THREE.Object3D, dist: [number, number] = LOD_DIST): THREE.Object3D {
  const groups = new Map<string, { parent: THREE.Object3D; lods: THREE.Object3D[] }>();
  root.traverse((o) => {
    const m = /^(.*)_LOD(\d)$/.exec(o.name);
    if (m && o.parent) {
      const key = o.parent.uuid + '/' + m[1];
      const g = groups.get(key) ?? { parent: o.parent, lods: [] };
      g.lods[Number(m[2])] = o;
      groups.set(key, g);
    }
  });
  for (const [key, { parent, lods }] of groups) {
    const lod = new THREE.LOD();
    lod.name = key.split('/')[1];
    lods.forEach((o, i) => {
      if (!o) return;
      parent.remove(o);
      lod.addLevel(o, i === 0 ? 0 : (dist[i - 1] ?? 300 * i));
    });
    // single-level plant LOD sets fade to nothing at the last distance
    if (lods.length === 2) lod.addLevel(new THREE.Object3D(), dist[1] * 2.3);
    parent.add(lod);
  }
  return root;
}

const plantMats = new Map<THREE.Texture, THREE.MeshStandardNodeMaterial>();
/** Alpha-tested plant card material: atlas x vertex tint, wind sway weighted by vertex alpha (height on card). */
export function plantMaterial(map: THREE.Texture): THREE.MeshStandardNodeMaterial {
  let m = plantMats.get(map);
  if (m) return m;
  m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  m.name = 'Plants';
  map.anisotropy = 8;
  const t = texture(map, uv());
  const col: N = attribute('color', 'vec4');
  const albedo: N = t.rgb.mul(col.rgb);
  // the scans are lush European greens; pull them toward dry prairie (less saturated, a touch darker)
  m.colorNode = weatherColor(mix(vec3(luminance(albedo)), albedo, 0.7).mul(0.86), { porosity: 0.3 });
  m.opacityNode = t.a;
  m.alphaTest = 0.45;
  m.roughnessNode = float(0.8);
  m.metalnessNode = float(0);
  // cards carry up-facing foliage normals: use them on both sides (no back-side flip)
  m.normalNode = normalViewGeometry;
  // wind: sway the card tops along the wind direction, with gusts from world-space noise
  const w: N = col.a.mul(col.a);
  const ph: N = positionWorld.x.mul(0.37).add(positionWorld.z.mul(0.41));
  const gust: N = tnoise(positionWorld.xz.mul(0.05).sub(vec2(uTime.mul(0.6), 0)));
  const amp: N = uWind.mul(0.07).add(0.01).mul(gust.mul(1.2).add(0.4));
  const sway: N = sin(uTime.mul(2.3).add(ph)).mul(0.5).add(0.6).mul(amp).mul(w);
  m.positionNode = positionLocal.add(vec3(uWindDir.x, float(0), uWindDir.y).mul(sway));
  // soft translucency: lift the shadowed side a touch
  m.emissiveNode = t.rgb.mul(col.rgb).mul(0.04);
  m.forceSinglePass = true;
  plantMats.set(map, m);
  return m;
}

// ---------------------------------------------------------------------------------------------- shared programs
// Every baked kit material is built from ONE fixed node graph: textures (1x1 defaults when a map is missing)
// and uniforms only, no per-material constants. The generated WGSL is then identical across materials, so
// the whole kit compiles to a handful of programs: {weather on/off} x {opaque, alpha-test, vertex-colour}.
function px(r: number, g: number, b: number, a = 255, srgb = false): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
const DEF = { map: px(255, 255, 255, 255, true), orm: px(255, 255, 255), normal: px(128, 128, 255) };

const upgraded = new Map<THREE.Material, THREE.Material>();
let glassMat: THREE.Material | null = null;

/** Baked glTF material -> shared-program node material with the engine's rain/snow weathering. */
export function upgradeMaterial(src: THREE.MeshStandardMaterial, _porosity = 0.8, weather = true): THREE.Material {
  const hit = upgraded.get(src);
  if (hit) return hit;
  let out: THREE.Material;
  if (/^Plants/.test(src.name) && src.map) out = plantMaterial(src.map);
  else if (/glass/i.test(src.name)) {
    if (!glassMat) {
      const g = new THREE.MeshPhysicalNodeMaterial({ color: 0x0b0d0f, roughness: 0.04, metalness: 0, ior: 1.52, clearcoat: 0.6 });
      g.name = 'KitGlass';
      g.roughnessNode = weatherRough(float(0.04), {});
      glassMat = g;
    }
    out = glassMat;
  } else {
    const n = new THREE.MeshStandardNodeMaterial();
    n.name = src.name;
    n.side = src.side;
    const t = (tex: THREE.Texture | null, def: THREE.Texture) => texture(tex ?? def, uv());
    const map: N = t(src.map, DEF.map);
    const orm: N = t(src.roughnessMap ?? src.metalnessMap ?? src.aoMap, DEF.orm);
    const tint = uniform(new THREE.Color(src.color.r, src.color.g, src.color.b));
    const rMul = uniform(src.roughness);
    // with no ORM map the default texel is (1,1,1): roughness = rMul, metalness = mMul, ao = 1
    const mMul = uniform(src.metalness);
    let base: N = map.rgb.mul(tint);
    if (src.vertexColors) base = base.mul(attribute('color', 'vec4').rgb);
    n.colorNode = weather ? weatherColor(base, { porosity: 0.8 }) : base;
    const r0: N = orm.g.mul(rMul);
    n.roughnessNode = weather ? weatherRough(r0, {}) : r0;
    n.metalnessNode = orm.b.mul(mMul);
    const ns = uniform(new THREE.Vector2(src.normalScale?.x ?? 1, src.normalScale?.y ?? 1));
    n.normalNode = normalMap(t(src.normalMap, DEF.normal), ns);
    // baked AO is softened: the renderer adds GTAO on top
    n.aoNode = mix(float(1), orm.r, 0.7);
    if ((src.alphaTest > 0 || src.transparent) && src.map) {
      n.opacityNode = map.a;
      if (src.transparent) {
        n.transparent = true;
        n.depthWrite = false;
      } else n.alphaTest = 0.5;
    }
    out = n;
  }
  upgraded.set(src, out);
  return out;
}

/** Small things (and cards, aprons, cloth panels) don't cast shadows: saves shadow draws and triangles. */
const NO_CAST = /^(Plants|Apron|Glass|Window_.*_glass|Straw|Chips|Loose|Ties|Wire)/i;
function prepare(root: THREE.Object3D, weather: boolean): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) m.material = m.material.map((x) => upgradeMaterial(x as THREE.MeshStandardMaterial, 0.8, weather));
    else m.material = upgradeMaterial(m.material as THREE.MeshStandardMaterial, 0.8, weather);
    m.receiveShadow = true;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).getSize(size);
    const small = Math.max(size.x, size.y, size.z) < 0.8;
    // LOD1/LOD2 never cast (LOD0 already provides the shadow up close; far shadows are soft cascades)
    const farLod = /_LOD[12]$/.test(m.name) || /_LOD[12]$/.test(m.parent?.name ?? '');
    m.castShadow = !small && !farLod && !NO_CAST.test(m.name);
  });
}

/** Load `<name>.glb` from public/world/assets/homestead/ and return a fresh clone (materials shared). */
/** `weather: false` for interiors (no rain darkening / snow on up-faces). */
export async function loadGLB(name: string, lodDist: [number, number] = LOD_DIST, weather = !name.startsWith('interior')): Promise<THREE.Object3D> {
  let p = cache.get(name);
  if (!p) {
    p = gltf.loadAsync(`${BASE}${name}.glb`).then((g) => {
      prepare(g.scene, weather);
      return toLOD(g.scene, lodDist);
    });
    cache.set(name, p);
  }
  return (await p).clone(true);
}

/** Find a descendant by exact name (glTF node names survive; Blender '.001' suffixes are stripped). */
export function byName(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o.name === name || o.name.replace(/[._]\d{3}$/, '') === name)) hit = o;
  });
  return hit;
}

/** Pre-compiles nothing; exposed so callers can await a list of kit files up front. */
export function preload(names: string[]): Promise<unknown> {
  return Promise.all(names.map((n) => loadGLB(n)));
}
