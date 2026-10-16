// Kit uber-material: one shader program for (nearly) every opaque town surface.
// Each loaded GLB's per-material primitives are merged into ONE mesh per LOD node; a per-vertex `kid`
// selects a row in a small parameter texture (texture-array layer, tile, tint, roughness, paint colour, wear...)
// and the shading mode (textured surface, peeling paint, shingles, solid colour, shop goods, lamp).
// Tiling texture sets live in three DataArrayTextures (albedo 1024², normal + ARM 512²).
// Result: a building is ~3-4 draw calls (kit + glass + sign) and the whole town compiles a handful of programs.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  attribute,
  texture,
  textureLoad,
  ivec2,
  int,
  uv,
  vec2,
  vec3,
  float,
  mix,
  smoothstep,
  clamp,
  fract,
  floor,
  sin,
  luminance,
  normalMap,
  select,
} from 'three/tsl';
import { weatherColor, weatherRough } from '../../engine/tsl';
import { kitIntact, townTex, uTownLamps } from './materials';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const BASE = `${import.meta.env.BASE_URL}world/assets/town/`;
/** Tiling sets in the arrays (layer index = position). Surfaces using another set stay separate materials. */
export const KIT_LAYERS = [
  'rough_wood', 'weathered_brown_planks', 'large_sandstone_blocks', 'sandstone_cracks', 'red_brick_03', 'worn_brick_wall',
  'rusty_metal_02', 'worn_corrugated_iron', 'painted_plaster', 'dark_wood', 'old_wood_floor', 'fine_grained_wood',
  'hessian_230', 'rough_linen', 'gravel_stones',
];
const LAYER = new Map(KIT_LAYERS.map((n, i) => [n, i]));
const ALB = 1024;
const AUX = 512;

function arrayTex(size: number, srgb: boolean): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array(size * size * 4 * KIT_LAYERS.length), size, size, KIT_LAYERS.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
const tAlb = arrayTex(ALB, true);
const tNrm = arrayTex(AUX, false);
const tArm = arrayTex(AUX, false);
let arraysReady: Promise<void> | null = null;

async function fillLayer(t: THREE.DataArrayTexture, size: number, layer: number, url: string): Promise<void> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, size, size).data;
  // canvas rows are top-down; glTF UVs expect flipY = false: copy as-is
  (t.image.data as Uint8Array).set(px, layer * size * size * 4);
  bmp.close();
}

/** Load every layer into the arrays (once). */
export function kitArrays(): Promise<void> {
  arraysReady ??= Promise.all(
    KIT_LAYERS.flatMap((n, i) => [
      fillLayer(tAlb, ALB, i, `${BASE}tex/${n}_c.webp`),
      fillLayer(tNrm, AUX, i, `${BASE}tex/${n}_n.webp`),
      fillLayer(tArm, AUX, i, `${BASE}tex/${n}_r.webp`),
    ]),
  ).then(() => {
    for (const t of [tAlb, tNrm, tArm]) t.needsUpdate = true;
  });
  return arraysReady;
}

// ------------------------------------------------------------------ parameter table
const COLS = 5;
const ROWS = 256;
const pData = new Float32Array(COLS * ROWS * 4);
const pTex = new THREE.DataTexture(pData, COLS, ROWS, THREE.RGBAFormat, THREE.FloatType);
pTex.magFilter = pTex.minFilter = THREE.NearestFilter;
pTex.generateMipmaps = false;
pTex.needsUpdate = true;
const rows = new Map<string, number>();

const MODE = { surface: 0, paint: 1, shingle: 2, solid: 3, goods: 4, lamp: 5 } as const;

/** Row for a kit material descriptor, or -1 if it can't be absorbed. */
function rowFor(m: THREE.Material): number {
  if (!kitIntact(m)) return -1;
  const d = m.userData.kit as Record<string, any>;
  const key = JSON.stringify(d);
  const hit = rows.get(key);
  if (hit !== undefined) return hit;
  if (rows.size >= ROWS) return -1;
  // p0 layer, mode, 1/tile, swap | p1 tint rgb, saturation | p2 vary*2, roughMul, roughAdd, metal
  // p3 grime, porosity, exposure, normalScale | p4 wear, lap, aoTex, dimK
  const p = new Array(COLS * 4).fill(0);
  const lin = (c: THREE.ColorRepresentation) => new THREE.Color(c);
  if (d.k === 'surface') {
    const layer = LAYER.get(d.tex);
    if (layer === undefined) return -1;
    const t = lin(d.tint ?? 0xffffff);
    p.splice(0, 20, layer, MODE.surface, 1 / (d.tile ?? 1.2), d.swap ? 1 : 0, t.r, t.g, t.b, d.saturation ?? 1, (d.vary ?? 0.18) * 2, d.roughMul ?? 1, d.roughAdd ?? 0, d.metal ?? 0, d.grime ?? 1, d.porosity ?? 0.7, d.exposure ?? 1, d.normalScale ?? 1, 0, 0, d.ao ?? 0.6, d.dimK ?? 0);
  } else if (d.k === 'paint') {
    const c = lin(`#${d.hex}`);
    p.splice(0, 20, 0, MODE.paint, 1 / 1.3, 1, c.r, c.g, c.b, 1, 0.16, 1, 0, 0, 1.15, 0.55, 1, 1, d.wear, d.lap ? 1 : 0, 0.5, 0);
  } else if (d.k === 'shingle') {
    p.splice(0, 20, 0, MODE.shingle, 1 / 1.1, 1, 1, 1, 1, 1, 0, 1.05, 0, 0, 0.6, 0.8, 1, 1.2, 0, 0, 1, 0);
  } else if (d.k === 'solid' || d.k === 'lamp') {
    const c = lin(d.color);
    p.splice(0, 20, 0, d.k === 'lamp' ? MODE.lamp : MODE.solid, 1, 0, c.r, c.g, c.b, 1, 0, d.rough, 0, d.metal, 0, 0.7, 0, 0, 0, 0, 0, d.dimK ?? 0);
  } else if (d.k === 'goods') {
    p.splice(0, 20, 0, MODE.goods, 1, 0, 1, 1, 1, 1, 0, 0.6, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, d.dimK ?? 0.18);
  } else return -1;
  const r = rows.size;
  rows.set(key, r);
  for (let i = 0; i < COLS * 4; i++) pData[r * COLS * 4 + i] = p[i];
  pTex.needsUpdate = true;
  return r;
}

// ------------------------------------------------------------------ the uber material
const hash = (x: N): N => fract(sin(x.mul(127.1).add(311.7)).mul(43758.5453));
const DUST = vec3(0.3, 0.245, 0.18);
const mats = new Map<string, THREE.MeshStandardNodeMaterial>();

function uber(flat: boolean, side: THREE.Side): THREE.MeshStandardNodeMaterial {
  const key = `${flat}|${side}`;
  const hit = mats.get(key);
  if (hit) return hit;
  void kitArrays();
  const m = new THREE.MeshStandardNodeMaterial({ side, flatShading: flat });
  m.name = 'town-kit';
  const v = attribute('color', 'vec4') as N;
  const row = int(attribute('kid', 'float').add(0.5));
  const P = (c: number): N => textureLoad(pTex, ivec2(int(c), row));
  const p0 = P(0);
  const p1 = P(1);
  const p2 = P(2);
  const p3 = P(3);
  const p4 = P(4);
  const mode = p0.y;
  const isM = (k: number): N => select(mode.equal(float(k)), float(1), float(0));
  const u0 = uv() as N;
  const uvT = mix(u0, vec2(u0.y, u0.x), p0.w).mul(p0.z);
  const layer = int(p0.x.add(0.5));
  const alb = texture(tAlb, uvT).depth(layer).rgb;
  const nrm = texture(tNrm, uvT).depth(layer);
  const arm = texture(tArm, uvT).depth(layer);
  const grimeT = townTex('tex/grime_m.webp', false);
  const gm = texture(grimeT, u0.mul(vec2(1 / 2.2, 1 / 3.2)));

  // --- surface
  const surf = mix(vec3(luminance(alb)), alb, p1.w).mul(p1.xyz).mul(float(1).add(v.b.sub(0.5).mul(p2.x)));

  // --- peeling paint over weathered grain (wood = layer 0 through uvT)
  const peel = texture(townTex('tex/peel_m.webp', false), u0.mul(vec2(1 / 1.1, 1 / 0.75)).add(vec2(v.b.mul(3.1), v.b.mul(1.7))));
  const wear0 = p4.x;
  const gate = smoothstep(0.42, 0.78, texture(grimeT, u0.mul(vec2(1 / 9.0, 1 / 6.0)).add(vec2(v.b.mul(0.37), 0))).g);
  const badBoard = smoothstep(0.88, 0.95, v.b).mul(0.35);
  const lvl = clamp(wear0.mul(0.22).add(gate.mul(wear0.mul(0.9))).add(v.a.sub(0.5).mul(0.1)).add(v.g.mul(0.38)).add(badBoard), 0.005, 0.95);
  const cov = smoothstep(lvl.sub(0.05), lvl.add(0.05), peel.r).mul(isM(MODE.paint));
  const woodCol = mix(alb, vec3(luminance(alb)), 0.5).mul(vec3(1.05, 1.0, 0.94));
  const col = p1.xyz;
  let pc: N = mix(col, luminance(col).mul(vec3(1.08, 1.02, 0.93)), 0.18);
  pc = pc.mul(mix(float(0.86), float(1.05), peel.g)).mul(mix(float(1), luminance(alb).mul(2.2).clamp(0.6, 1.2), 0.18));
  pc = pc.mul(float(1).add(v.b.sub(0.5).mul(0.16))).mul(mix(vec3(1.03, 1.0, 0.95), vec3(0.97, 1.0, 1.04), fract(v.b.mul(7.31))));
  let paint: N = mix(woodCol, pc, cov);
  paint = mix(paint, alb.mul(vec3(1.08, 0.98, 0.84)), smoothstep(0.012, 0.006, v.b));
  const edge = smoothstep(lvl.sub(0.05), lvl, peel.r).mul(smoothstep(lvl.add(0.06), lvl, peel.r));
  paint = paint.mul(float(1).sub(edge.mul(0.22)));
  const lf = fract(u0.y.div(0.115));
  paint = paint.mul(mix(float(1), mix(float(0.55), float(1), smoothstep(0.0, 0.16, lf)).mul(mix(float(1.04), float(0.96), lf)), p4.y));
  const st = texture(grimeT, u0.mul(vec2(1 / 1.6, 1 / 2.4)).add(vec2(v.b.mul(0.7), 0)));
  paint = paint.mul(float(1).sub(smoothstep(0.25, 0.85, st.r).mul(0.22).mul(float(1).add(v.g)).mul(vec3(0.9, 0.95, 1.0))));

  // --- shingles (courses along V, shingles along U)
  const k = u0.x.div(0.15).add(v.b.mul(13.7)).add(hash(floor(u0.y.div(0.14))).mul(0.5));
  const h = hash(floor(k).add(v.b.mul(91.0)));
  const fx = fract(k);
  const cf = fract(u0.y.div(0.14));
  const sAlb = texture(tAlb, vec2(u0.y, u0.x).mul(1 / 1.1).add(vec2(h.mul(5.0), h.mul(3.0)))).depth(int(0)).rgb;
  const gap = smoothstep(0.0, 0.035, fx).mul(smoothstep(1.0, 0.965, fx));
  let sh: N = sAlb.mul(vec3(0.62, 0.58, 0.55)).mul(mix(float(0.62), float(1.18), h)).mul(mix(float(0.15), float(1), gap));
  sh = sh.mul(mix(float(0.35), float(1), smoothstep(0.0, 0.1, cf))).mul(mix(float(1.05), float(0.92), cf));
  sh = mix(sh, vec3(0.13, 0.13, 0.07), smoothstep(0.75, 0.95, h).mul(0.35));

  // --- solid colour + lamp
  const solidC = p1.xyz;

  // --- shop goods behind glass (period palette, label bands)
  const gi = floor(v.b.mul(7.99));
  const pal = [vec3(0.42, 0.07, 0.05), vec3(0.08, 0.16, 0.3), vec3(0.55, 0.42, 0.12), vec3(0.12, 0.22, 0.1), vec3(0.6, 0.55, 0.45), vec3(0.3, 0.14, 0.06), vec3(0.05, 0.05, 0.05), vec3(0.45, 0.3, 0.2)];
  let goodsC: N = pal[0];
  for (let i = 1; i < pal.length; i++) goodsC = mix(goodsC, pal[i], clamp(gi.sub(i - 1), 0, 1));
  const band = smoothstep(0.3, 0.32, fract(u0.y.mul(6.0))).mul(smoothstep(0.7, 0.68, fract(u0.y.mul(6.0))));
  goodsC = mix(goodsC, vec3(0.75, 0.68, 0.52), band.mul(select(hash(gi.add(3.0)).greaterThan(0.4), float(0.85), float(0))));

  // --- pick by mode
  let base: N = surf;
  base = mix(base, paint, isM(MODE.paint));
  base = mix(base, sh, isM(MODE.shingle));
  base = mix(base, solidC, isM(MODE.solid).add(isM(MODE.lamp)));
  base = mix(base, goodsC, isM(MODE.goods));
  // grime (amount p3.x; 0 for solids/goods)
  const g = clamp(v.g.mul(0.85).add(gm.r.mul(select(isM(MODE.paint).greaterThan(0.5), float(0.55), float(0.35)))).add(gm.g.sub(0.5).mul(0.25)).mul(p3.x), 0, 1);
  base = mix(base, DUST.mul(mix(float(0.75), float(1.15), gm.b)), g);
  m.colorNode = weatherColor(base, { porosity: p3.y, exposure: p3.z } as never);

  // roughness / metal
  const rSurf = arm.g.mul(p2.y).add(p2.z).add(v.g.mul(0.1));
  const rPaint = mix(arm.g, float(0.58).add(peel.g.mul(0.18)), cov).add(v.g.mul(0.08));
  const rGoods = float(0.55).add(hash(gi).mul(0.3));
  let rough: N = rSurf;
  rough = mix(rough, rPaint, isM(MODE.paint));
  rough = mix(rough, arm.g.mul(1.05).clamp(0.5, 1), isM(MODE.shingle));
  rough = mix(rough, p2.y, isM(MODE.solid).add(isM(MODE.lamp)));
  rough = mix(rough, rGoods, isM(MODE.goods));
  m.roughnessNode = weatherRough(rough.clamp(0.04, 1), { exposure: p3.z } as never);
  m.metalnessNode = mix(p2.w, select(hash(gi.add(7.0)).greaterThan(0.75), float(0.6), float(0)), isM(MODE.goods));

  // normal: textured modes only (solid/goods get scale 0)
  const ns: N = mix(p3.w, mix(float(1.1), float(0.3), cov), isM(MODE.paint));
  m.normalNode = normalMap(nrm, vec2(ns, ns));

  // occlusion: baked vertex AO (+ texture AO), interiors (dimK > 0) cut indirect light
  const aoN = mix(float(1), v.r, 0.55).mul(mix(float(1), arm.r, p4.z));
  const aoSolid = v.r;
  let ao: N = mix(aoN, aoSolid, isM(MODE.solid).add(isM(MODE.lamp)).add(isM(MODE.goods)).clamp(0, 1));
  ao = mix(ao, mix(float(1), v.r, 0.35).mul(mix(float(0.6), float(1), gap)), isM(MODE.shingle));
  m.aoNode = select(p4.w.greaterThan(0), v.r.mul(p4.w), ao);
  m.emissiveNode = vec3(1.0, 0.62, 0.28).mul(uTownLamps.mul(6)).mul(isM(MODE.lamp));
  mats.set(key, m);
  return m;
}

// ------------------------------------------------------------------ merge
interface Part {
  mesh: THREE.Mesh;
  row: number;
}

function floatAttr(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): THREE.BufferAttribute {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) {
    out[i * size] = a.getX(i);
    if (size > 1) out[i * size + 1] = a.getY(i);
    if (size > 2) out[i * size + 2] = a.getZ(i);
    if (size > 3) out[i * size + 3] = a.getW(i);
  }
  return new THREE.BufferAttribute(out, size);
}

function prep(p: Part): THREE.BufferGeometry {
  const src = p.mesh.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', floatAttr(src.getAttribute('position'), 3));
  const n = src.getAttribute('normal');
  if (n) g.setAttribute('normal', floatAttr(n, 3));
  const uvA = src.getAttribute('uv');
  g.setAttribute('uv', uvA ? floatAttr(uvA, 2) : new THREE.BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
  const c = src.getAttribute('color');
  const cnt = src.getAttribute('position').count;
  if (c && c.itemSize === 4) g.setAttribute('color', floatAttr(c, 4));
  else {
    const cc = new Float32Array(cnt * 4);
    for (let i = 0; i < cnt; i++) cc.set([1, 0, 0.5, 0.5], i * 4);
    g.setAttribute('color', new THREE.BufferAttribute(cc, 4));
  }
  g.setAttribute('kid', new THREE.BufferAttribute(new Float32Array(cnt).fill(p.row), 1));
  if (src.index) g.setIndex(src.index.clone());
  else g.setIndex([...Array(cnt).keys()]);
  // apply the mesh's local transform (relative to its parent node)
  p.mesh.updateMatrix();
  g.applyMatrix4(p.mesh.matrix);
  return g;
}

/** Merge kit-material primitives under each node into one uber-material mesh. Returns meshes removed. */
export function mergeKit(root: THREE.Object3D): number {
  const byParent = new Map<THREE.Object3D, Part[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || !m.parent || (m as THREE.InstancedMesh).isInstancedMesh) return;
    const row = rowFor(m.material);
    if (row < 0) return;
    const side = m.material.side;
    if (side !== THREE.FrontSide && side !== THREE.DoubleSide) return;
    const arr = byParent.get(m.parent) ?? [];
    arr.push({ mesh: m, row });
    byParent.set(m.parent, arr);
  });
  let removed = 0;
  for (const [parent, parts] of byParent) {
    // groups: normals present or not, front or double sided
    const groups = new Map<string, Part[]>();
    for (const p of parts) {
      const key = `${!!p.mesh.geometry.getAttribute('normal')}|${p.mesh.material instanceof THREE.Material ? p.mesh.material.side : 0}`;
      const a = groups.get(key) ?? [];
      a.push(p);
      groups.set(key, a);
    }
    for (const [key, ps] of groups) {
      if (ps.length < 2 && key.startsWith('true')) continue; // a lone smooth part: nothing gained
      const geo = mergeGeometries(ps.map(prep), false);
      if (!geo) continue;
      const flat = key.startsWith('false');
      const side = Number(key.split('|')[1]) as THREE.Side;
      const mesh = new THREE.Mesh(geo, uber(flat, side));
      mesh.name = 'kit';
      mesh.castShadow = ps.some((p) => p.mesh.castShadow);
      mesh.receiveShadow = true;
      parent.add(mesh);
      for (const p of ps) {
        parent.remove(p.mesh);
        p.mesh.geometry.dispose();
        removed++;
      }
    }
  }
  return removed;
}
