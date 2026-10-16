// Town kit materials: semantic glTF material names -> shared TSL PBR materials.
// GLBs from tools/blender/town carry geometry + COLOR_0 masks only:
//   R = baked AO, G = grime (ground splash / eave drip / crevices), B = per-part random, A = per-part wear.
// UVs are in metres with U along the grain/courses. Every exterior surface gets the world's rain/snow weathering.
import * as THREE from 'three/webgpu';
import {
  positionLocal,
  texture,
  uv,
  vec2,
  vec3,
  float,
  mix,
  smoothstep,
  attribute,
  normalMap,
  clamp,
  fract,
  floor,
  luminance,
  uniform,
  sin,
  positionWorld,
  max,
} from 'three/tsl';
import { weatherColor, weatherRough, uTime, uWind } from '../../engine/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const BASE = `${import.meta.env.BASE_URL}world/assets/town/`;
const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
const texPending: Promise<unknown>[] = [];

/** Night/evening lamp glow for shop windows, street lamps and interior lamps (0 = off, 1 = lit). */
export const uTownLamps = uniform(0);

export function townTex(path: string, srgb: boolean): THREE.Texture {
  const hit = texCache.get(path);
  if (hit) return hit;
  let done: () => void = () => {};
  texPending.push(new Promise<void>((r) => (done = r)));
  const t = loader.load(`${BASE}${path}`, () => done(), undefined, () => done());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.flipY = false; // glTF UV convention
  texCache.set(path, t);
  return t;
}
/** Resolves when every texture requested so far has loaded (or failed). */
export function townTexturesReady(): Promise<unknown> {
  return Promise.all(texPending);
}

interface TexSet {
  c: THREE.Texture;
  n: THREE.Texture;
  r: THREE.Texture;
}
function set(name: string): TexSet {
  return { c: townTex(`tex/${name}_c.webp`, true), n: townTex(`tex/${name}_n.webp`, false), r: townTex(`tex/${name}_r.webp`, false) };
}

const vcol = (): N => attribute('color', 'vec4');
const hash = (x: N): N => fract(sin(x.mul(127.1).add(311.7)).mul(43758.5453));

/** Kansas dust: what grime pulls every exterior surface toward. */
const DUST = vec3(0.3, 0.245, 0.18);

/** Remember how a material was made (so kit geometry can be merged under the shared uber material, kitmat.ts);
 *  if anyone later swaps one of its nodes, kitIntact() reports false and the material is left alone. */
const nodeSig = (m: THREE.Material): unknown[] => {
  const n = m as unknown as Record<string, unknown>;
  return ['colorNode', 'roughnessNode', 'metalnessNode', 'normalNode', 'aoNode', 'emissiveNode', 'positionNode', 'opacityNode'].map((k) => n[k]);
};
function tagKit(m: THREE.Material, desc: Record<string, unknown>): void {
  m.userData.kit = desc;
  m.userData.kitSig = nodeSig(m);
}
export function kitIntact(m: THREE.Material): boolean {
  const d = m.userData.kit;
  const sig = m.userData.kitSig as unknown[] | undefined;
  return !!d && !!sig && nodeSig(m).every((x, i) => x === sig[i]);
}

/** Per-material values go in uniforms, never literals: identical graphs then compile to ONE shader program. */
export const U = (x: number): N => uniform(x);
export const UC = (c: THREE.ColorRepresentation): N => uniform(new THREE.Color(c));

function grimeApply(base: N, uvm: N, amount: number | N, streakAmt: number | N = 0.35): N {
  const v = vcol();
  const gm = texture(townTex('tex/grime_m.webp', false), uvm.mul(vec2(1 / 2.2, 1 / 3.2)));
  const streak = gm.r.mul(typeof streakAmt === 'number' ? U(streakAmt) : streakAmt);
  const blot = gm.g.sub(0.5).mul(0.25);
  const g = clamp(v.g.mul(0.85).add(streak).add(blot).mul(typeof amount === 'number' ? U(amount) : amount), 0, 1);
  return mix(base, DUST.mul(mix(float(0.75), float(1.15), gm.b)), g);
}

export interface SurfOpts {
  tex: string;
  /** metres covered by one texture tile */
  tile?: number;
  /** swap u/v (grain textures whose grain runs along V) */
  swap?: boolean;
  tint?: THREE.ColorRepresentation;
  saturation?: number;
  roughMul?: number;
  roughAdd?: number;
  metal?: number;
  normalScale?: number;
  grime?: number;
  /** per-part tone variation (uses the vertex random channel) */
  vary?: number;
  porosity?: number;
  /** weather exposure (0 for interiors) */
  exposure?: number;
  ao?: number;
  side?: THREE.Side;
}

function uvOf(o: { tile?: number; swap?: boolean }): N {
  const u = uv();
  return mix(u, vec2(u.y, u.x), U(o.swap ? 1 : 0)).mul(U(1 / (o.tile ?? 1.2)));
}

/** Generic textured surface with vertex AO/grime/variation. Every option is a uniform, so all surface()
 *  materials (any texture set, tint, tile...) share one shader program per `side`. */
export { solid, dim, grimeApply, vcol, set as texSet };

export function surface(o: SurfOpts): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: o.side ?? THREE.FrontSide });
  const s = set(o.tex);
  const u = uvOf(o);
  const v = vcol();
  let base: N = texture(s.c, u).rgb;
  base = mix(vec3(luminance(base)), base, U(o.saturation ?? 1));
  base = base.mul(UC(o.tint ?? 0xffffff));
  base = base.mul(float(1).add(v.b.sub(0.5).mul(U((o.vary ?? 0.18) * 2))));
  base = grimeApply(base, uv(), o.grime ?? 1);
  const arm = texture(s.r, u);
  const ex = U(o.exposure ?? 1);
  m.colorNode = weatherColor(base, { porosity: U(o.porosity ?? 0.7), exposure: ex } as never);
  const rough = arm.g.mul(U(o.roughMul ?? 1)).add(U(o.roughAdd ?? 0)).add(v.g.mul(0.1)).clamp(0.04, 1);
  m.roughnessNode = weatherRough(rough, { exposure: ex } as never);
  m.metalnessNode = U(o.metal ?? 0);
  const ns = U(o.normalScale ?? 1);
  m.normalNode = normalMap(texture(s.n, u), vec2(ns, ns));
  m.aoNode = mix(float(1), v.r, 0.55).mul(mix(float(1), arm.r, U(o.ao ?? 0.6)));
  tagKit(m, { k: 'surface', ...o });
  return m;
}

/** Painted wood (clapboards, trim): weathered grain under chalky paint that peels by wear level. */
export function paint(hex: string, opts: { wear?: number; lap?: boolean } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const w = set('rough_wood');
  const v = vcol();
  const u = uv();
  const gu = vec2(u.y, u.x).mul(1 / 1.3).add(vec2(v.b.mul(7.0), 0));
  const grain = texture(w.c, gu);
  const peel = texture(townTex('tex/peel_m.webp', false), u.mul(vec2(1 / 1.1, 1 / 0.75)).add(vec2(v.b.mul(3.1), v.b.mul(1.7))));
  const col: N = UC(`#${hex}`);
  const lum: N = luminance(col);
  const wear0: N = U(opts.wear ?? 0.3);
  // wear rises on worn parts (A), grimy/low boards (G) and lower on the wall
  // peeling happens in patches (weather side, around joints), not evenly everywhere
  const gate = smoothstep(0.42, 0.78, texture(townTex('tex/grime_m.webp', false), u.mul(vec2(1 / 9.0, 1 / 6.0)).add(vec2(v.b.mul(0.37), 0))).g);
  // a few boards per wall weathered far worse (split, re-nailed, south-facing)
  const badBoard = smoothstep(0.88, 0.95, v.b).mul(0.35);
  const lvl = clamp(wear0.mul(0.22).add(gate.mul(wear0.mul(0.9))).add(v.a.sub(0.5).mul(0.1)).add(v.g.mul(0.38)).add(badBoard), 0.005, 0.95);
  const cov = smoothstep(lvl.sub(0.05), lvl.add(0.05), peel.r);
  const woodCol = mix(grain.rgb, vec3(luminance(grain.rgb)), 0.5).mul(vec3(1.05, 1.0, 0.94));
  // sun-bleached, chalky paint that telegraphs the grain a little
  const bleach = lum.mul(vec3(1.08, 1.02, 0.93));
  let pc: N = mix(col, bleach, 0.18);
  pc = pc.mul(mix(float(0.86), float(1.05), peel.g)).mul(mix(float(1), luminance(grain.rgb).mul(2.2).clamp(0.6, 1.2), 0.18));
  // board-to-board variation: tone and a slight hue drift (repainted boards, different paint lots)
  pc = pc.mul(float(1).add(v.b.sub(0.5).mul(0.16))).mul(mix(vec3(1.03, 1.0, 0.95), vec3(0.97, 1.0, 1.04), fract(v.b.mul(7.31))));
  let base: N = mix(woodCol, pc, cov);
  // the odd replacement board never painted: warmer, newer raw pine
  const newBoard = smoothstep(0.012, 0.006, v.b);
  base = mix(base, grain.rgb.mul(vec3(1.08, 0.98, 0.84)), newBoard);
  // dark hairline at the peel edge (paint thickness shadow)
  const edge = smoothstep(lvl.sub(0.05), lvl, peel.r).mul(smoothstep(lvl.add(0.06), lvl, peel.r));
  base = base.mul(float(1).sub(edge.mul(0.22)));
  {
    // LOD 'lap:' walls: draw clapboard courses on a flat wall (uniform switch keeps one program)
    const f = fract(u.y.div(0.115));
    const lapShade = mix(float(0.55), float(1), smoothstep(0.0, 0.16, f)).mul(mix(float(1.04), float(0.96), f));
    base = base.mul(mix(float(1), lapShade, U(opts.lap ? 1 : 0)));
  }
  base = grimeApply(base, u, 1.15, 0.55);
  // rain streaks: grey run-off stains hanging below laps and joints (stronger low on the wall)
  const st = texture(townTex('tex/grime_m.webp', false), u.mul(vec2(1 / 1.6, 1 / 2.4)).add(vec2(v.b.mul(0.7), 0)));
  const streak = smoothstep(0.25, 0.85, st.r).mul(0.22).mul(float(1).add(v.g));
  base = base.mul(float(1).sub(streak.mul(vec3(0.9, 0.95, 1.0))));
  m.colorNode = weatherColor(base, { porosity: 0.55 });
  const arm = texture(w.r, gu);
  const rough = mix(arm.g, float(0.58).add(peel.g.mul(0.18)), cov).add(v.g.mul(0.08)).clamp(0.05, 1);
  m.roughnessNode = weatherRough(rough, {});
  m.metalnessNode = float(0);
  m.normalNode = normalMap(texture(w.n, gu), mix(vec2(1.1, 1.1), vec2(0.3, 0.3), cov));
  m.aoNode = mix(float(1), v.r, 0.55).mul(mix(float(1), arm.r, 0.5));
  tagKit(m, { k: 'paint', hex, wear: opts.wear ?? 0.3, lap: !!opts.lap });
  return m;
}

/** Wood shingles: per-shingle tone/width variation and gaps drawn from the course U coordinate. */
function shingle(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const w = set('rough_wood');
  const v = vcol();
  const u = uv();
  const k = u.x.div(0.15).add(v.b.mul(13.7)).add(hash(floor(u.y.div(0.14))).mul(0.5));
  const id = floor(k);
  const h = hash(id.add(v.b.mul(91.0)));
  const fx = fract(k);
  // courses up the slope (flat roof fields carry V in metres up the slope; course strips have small V)
  const cv = u.y.div(0.14).add(v.b.mul(0.0));
  const course = floor(cv);
  const cf = fract(cv);
  const gu = vec2(u.y.mul(1.0), u.x).mul(1 / 1.1).add(vec2(h.mul(5.0), h.mul(3.0)));
  const c = texture(w.c, gu).rgb;
  let base: N = c.mul(vec3(0.62, 0.58, 0.55)).mul(mix(float(0.62), float(1.18), h));
  const gap = smoothstep(0.0, 0.035, fx).mul(smoothstep(1.0, 0.965, fx));
  base = base.mul(mix(float(0.15), float(1), gap));
  // butt shadow at the bottom of each course + slight lift toward the butt
  const butt = smoothstep(0.0, 0.1, cf);
  base = base.mul(mix(float(0.35), float(1), butt)).mul(mix(float(1.05), float(0.92), cf));
  void course;
  // moss/lichen + dust on the weather side
  base = mix(base, vec3(0.13, 0.13, 0.07), smoothstep(0.75, 0.95, h).mul(0.35));
  base = grimeApply(base, u, 0.6, 0.2);
  m.colorNode = weatherColor(base, { porosity: 0.8 });
  const arm = texture(w.r, gu);
  m.roughnessNode = weatherRough(arm.g.mul(1.05).clamp(0.5, 1), {});
  m.metalnessNode = float(0);
  m.normalNode = normalMap(texture(w.n, gu), vec2(1.2, 1.2));
  m.aoNode = mix(float(1), v.r, 0.35).mul(mix(float(0.6), float(1), gap));
  tagKit(m, { k: 'shingle' });
  return m;
}

function glass(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({
    color: 0xf0f4f0,
    metalness: 0,
    roughness: 0.015,
    transmission: 1,
    ior: 1.52,
    thickness: 0.004,
    specularIntensity: 1,
    side: THREE.DoubleSide,
  });
  // clear old cylinder glass; only a little dust/film in patches (milky glass reads as frosted)
  const gm = texture(townTex('tex/grime_m.webp', false), positionWorld.xy.mul(0.35));
  m.roughnessNode = float(0.012).add(smoothstep(0.72, 1.0, gm.g).mul(0.05));
  return m;
}

/** Druggist's show globe: coloured liquid in glass that glows when back-lit (and at night with the lamps). */
function showGlobe(hex: number): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({ color: hex, roughness: 0.05, metalness: 0, transmission: 0.6, ior: 1.4, thickness: 0.3, specularIntensity: 1 });
  m.emissiveNode = UC(hex).mul(uTownLamps.mul(1.5).add(0.15));
  return m;
}

/** Wool bunting flag that ripples in the wind (vertex wave grows toward the fly end). */
function flag(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const u = uv();
  const k = u.x;
  const ph = u.x.mul(9.0).sub(uTime.mul(uWind.mul(5.0).add(2.5)));
  const amp = k.mul(k.mul(0.5).add(0.5)).mul(uWind.mul(0.16).add(0.03));
  const wave = sin(ph).mul(amp).add(sin(ph.mul(1.7).add(u.y.mul(4.0))).mul(amp.mul(0.35)));
  m.positionNode = positionLocal.add(vec3(0, sin(ph.mul(0.5)).mul(amp.mul(0.25)).sub(k.mul(0.06).mul(float(1).sub(uWind))), wave));
  const c = texture(townTex('signs/flag_us45.webp', true), u);
  m.colorNode = weatherColor(c.rgb.mul(float(0.85).add(sin(ph).mul(0.12))), { porosity: 0.8 });
  m.roughnessNode = float(0.85);
  return m;
}

/** Red, white and blue bunting (stripes across the swag). */
function buntingMat(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const t = uv().y;
  const c = mix(mix(vec3(0.42, 0.05, 0.05), vec3(0.78, 0.76, 0.7), smoothstep(0.32, 0.36, t)), vec3(0.06, 0.09, 0.28), smoothstep(0.65, 0.69, t));
  m.colorNode = weatherColor(c.mul(texture(townTex('tex/rough_linen_c.webp', true), uv().mul(4.0)).rgb.mul(1.5)), { porosity: 0.8 });
  m.roughnessNode = float(0.9);
  return m;
}

/** Alpha-tested painted/pasted label (wall bills, painted decals): ONE program for every texture. */
export function alphaLabel(path: string, o: { side?: THREE.Side; offset?: boolean } = {}): THREE.MeshStandardNodeMaterial {
  const t = townTex(path, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.MeshStandardNodeMaterial({ side: o.side ?? THREE.DoubleSide, alphaTest: 0.5 });
  if (o.offset) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const c = texture(t, uv());
  m.colorNode = weatherColor(c.rgb, { porosity: 0.9 });
  m.opacityNode = c.a;
  m.roughnessNode = float(0.9);
  return m;
}
function posterMat(id: string): THREE.MeshStandardNodeMaterial {
  return alphaLabel(`posters/${id}.webp`);
}

function solid(color: THREE.ColorRepresentation, rough: number, metal = 0, emissive?: N): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal });
  const v = vcol();
  m.aoNode = v.r;
  if (emissive) m.emissiveNode = emissive;
  else tagKit(m, { k: 'solid', color: new THREE.Color(color), rough, metal });
  return m;
}

/** Goods on shelves behind the glass: tins, boxes, packets in period colours with label bands. */
function goods(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const v = vcol();
  const u = uv();
  const pal = [vec3(0.42, 0.07, 0.05), vec3(0.08, 0.16, 0.3), vec3(0.55, 0.42, 0.12), vec3(0.12, 0.22, 0.1), vec3(0.6, 0.55, 0.45), vec3(0.3, 0.14, 0.06), vec3(0.05, 0.05, 0.05), vec3(0.45, 0.3, 0.2)];
  const i = floor(v.b.mul(7.99));
  let c: N = pal[0];
  for (let k = 1; k < pal.length; k++) c = mix(c, pal[k], clamp(i.sub(k - 1), 0, 1));
  const band = smoothstep(0.3, 0.32, fract(u.y.mul(6.0))).mul(smoothstep(0.7, 0.68, fract(u.y.mul(6.0))));
  c = mix(c, vec3(0.75, 0.68, 0.52), band.mul(hash(i.add(3.0)).greaterThan(0.4).select(float(0.85), float(0))));
  m.colorNode = c;
  m.roughnessNode = float(0.55).add(hash(i).mul(0.3));
  m.metalnessNode = hash(i.add(7.0)).greaterThan(0.75).select(float(0.6), float(0));
  m.aoNode = v.r;
  tagKit(m, { k: 'goods' });
  return m;
}

function sign(id: string): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const t = townTex(`signs/${id}.webp`, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const v = vcol();
  const u = uv();
  const c = texture(t, u);
  const w = set('rough_wood');
  const gu = vec2(u.y.mul(0.9), u.x.mul(4.0)).add(vec2(v.b.mul(3), 0));
  let base: N = c.rgb;
  base = grimeApply(base, u.mul(vec2(4, 1)), 0.5, 0.4);
  m.colorNode = weatherColor(base, { porosity: 0.5 });
  m.roughnessNode = weatherRough(float(0.62).add(c.a.oneMinus().mul(0.2)), {});
  m.metalnessNode = float(0);
  m.normalNode = normalMap(texture(w.n, gu), vec2(0.5, 0.5));
  // big single quad: corner-only vertex AO is unreliable, so leave occlusion to GTAO
  return m;
}

/** Lantern glass: sooty glass that glows warm when the town lamps are lit (uTownLamps). */
function lampGlass(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x9a9080, roughness: 0.15, transparent: true, side: THREE.DoubleSide });
  const gm = texture(townTex('tex/grime_m.webp', false), uv().mul(2.0));
  m.opacityNode = float(0.35).add(gm.g.mul(0.25)).add(uTownLamps.mul(0.3));
  m.emissiveNode = vec3(1.0, 0.66, 0.32).mul(uTownLamps.mul(4.0)).mul(float(1).sub(gm.g.mul(0.4)));
  return m;
}

/** Still, slightly murky trough water. */
function water(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x1a1c14, roughness: 0.04, metalness: 0, specularIntensity: 1 });
  const gm = texture(townTex('tex/grime_m.webp', false), uv().mul(0.5).add(vec2(uTime.mul(0.01), 0)));
  m.roughnessNode = float(0.03).add(gm.b.mul(0.05));
  m.normalNode = normalMap(texture(townTex('tex/rough_linen_n.webp', false), uv().mul(0.8).add(vec2(0, uTime.mul(0.02)))), vec2(0.04, 0.04));
  return m;
}

const cache = new Map<string, THREE.Material>();

/** Material for a semantic name from the town GLBs (cached; shared across every instance). */
export function townMaterial(name: string, wear = 0.3, flat = false): THREE.Material {
  const key = `${name}|${wear}|${flat}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = makeMaterial(name, wear);
  m.name = name;
  // geometry exported without normals (flat-shaded kit parts): derive face normals in the shader
  if (flat) (m as THREE.MeshStandardMaterial).flatShading = true;
  cache.set(key, m);
  return m;
}

type MatFactory = (arg: string, wear: number) => THREE.Material;
const extra = new Map<string, MatFactory>();
/** Register extra material kinds (sub-modules: interiors, civic, brick...). Name = `kind` or `kind:arg`. */
export function registerTownMaterial(kind: string, f: MatFactory): void {
  extra.set(kind, f);
}

function makeMaterial(name: string, wear: number): THREE.Material {
  const [kind, arg] = name.includes(':') ? (name.split(':') as [string, string]) : [name, ''];
  const ex = extra.get(kind);
  if (ex) return ex(arg, wear);
  switch (kind) {
    case 'paint':
      return paint(arg.slice(0, 6), { wear });
    case 'lap':
      return paint(arg.slice(0, 6), { wear, lap: true });
    case 'sign':
      return sign(arg);
    case 'wood':
      return surface({ tex: 'rough_wood', swap: true, tile: 1.3, tint: 0xe6ded2, saturation: 0.45, vary: 0.22, grime: 1 });
    case 'wood_dark':
      return surface({ tex: 'rough_wood', swap: true, tile: 1.3, tint: 0x7a6e62, saturation: 0.6, vary: 0.2 });
    case 'planks':
      return surface({ tex: 'weathered_brown_planks', tile: 2.0, tint: 0xb0a898, saturation: 0.7 });
    case 'shingle':
      return shingle();
    case 'glass':
      return glass();
    case 'stone':
      return surface({ tex: 'large_sandstone_blocks', tile: 2.0, tint: 0xd6ccbc, grime: 1.2 });
    case 'stone_trim':
      return surface({ tex: 'sandstone_cracks', tile: 1.5, tint: 0xe2d8c4, grime: 0.8 });
    case 'brick':
      return surface({ tex: 'red_brick_03', tile: 1.6, grime: 0.8, vary: 0.08 });
    case 'brick_old':
      return surface({ tex: 'worn_brick_wall', tile: 1.6, grime: 0.8, vary: 0.08 });
    case 'iron':
      return surface({ tex: 'rusty_metal_02', tile: 0.8, tint: 0x5a5450, saturation: 0.5, metal: 0.55, roughMul: 0.9, grime: 0.3, porosity: 0.2 });
    case 'tin':
      return surface({ tex: 'worn_corrugated_iron', tile: 1.5, tint: 0xb8b8b4, metal: 0.8, roughMul: 0.8, grime: 0.6, porosity: 0.2 });
    case 'brass':
      return solid(0xc8963e, 0.28, 1);
    case 'int_dark':
      return solid(0x0d0a08, 0.95);
    case 'int_wall':
      return dim(surface({ tex: 'painted_plaster', tile: 2.5, tint: 0x9a8064, grime: 0, exposure: 0, vary: 0.05 }));
    case 'int_ceiling':
      return dim(surface({ tex: 'dark_wood', tile: 2.0, tint: 0x6a5a4a, grime: 0, exposure: 0 }));
    case 'int_floor':
      return dim(surface({ tex: 'old_wood_floor', tile: 2.2, tint: 0x9a8a78, grime: 0, exposure: 0 }));
    case 'shelf':
    case 'counter':
      return dim(surface({ tex: 'fine_grained_wood', swap: true, tile: 1.4, tint: 0x8a6a4a, grime: 0, exposure: 0 }));
    case 'goods':
      return dim(goods());
    case 'burlap':
      return surface({ tex: 'hessian_230', tile: 0.45, tint: 0xc9b48e, saturation: 0.8, grime: 0.6, vary: 0.2, normalScale: 1.4 });
    case 'crate':
      return surface({ tex: 'rough_wood', swap: true, tile: 0.9, tint: 0xf0dcc0, saturation: 0.75, vary: 0.25, grime: 0.6 });
    case 'lamp_glass':
      return lampGlass();
    case 'water':
      return water();
    case 'globe_red':
      return showGlobe(0x9a0c10);
    case 'globe_green':
      return showGlobe(0x0c6a2a);
    case 'hat':
      return dim(surface({ tex: 'rough_linen', tile: 0.3, tint: 0x3a3028, grime: 0, exposure: 0 }), 0.4);
    case 'pie':
      return dim(surface({ tex: 'hessian_230', tile: 0.2, tint: 0xd09050, saturation: 1.1, grime: 0, exposure: 0 }), 0.4);
    case 'crock':
      return dim(solid(0x8a7a62, 0.35), 0.4);
    case 'lumber':
      return surface({ tex: 'fine_grained_wood', swap: true, tile: 1.6, tint: 0xf0d8b0, saturation: 0.8, vary: 0.2, grime: 0.3 });
    case 'canvas':
      return surface({ tex: 'rough_linen', tile: 0.7, tint: 0xb4a68c, saturation: 0.55, grime: 1.3, vary: 0.05, normalScale: 1.6, side: THREE.DoubleSide });
    case 'flag':
      return flag();
    case 'bunting':
      return buntingMat();
    case 'poster':
      return posterMat(arg);
    case 'rope':
      return surface({ tex: 'hessian_230', tile: 0.15, tint: 0xb8a078, saturation: 0.6, grime: 0.4 });
    case 'chalkboard':
      return solid(0x1c2420, 0.9);
    case 'log':
      return surface({ tex: 'rough_wood', swap: true, tile: 0.8, tint: 0xa89070, saturation: 0.8, grime: 0.6, vary: 0.3 });
    case 'barrel_wood':
      return surface({ tex: 'rough_wood', swap: true, tile: 0.9, tint: 0xc8a882, saturation: 0.8, grime: 0.6, vary: 0.25 });
    case 'hay':
      return surface({ tex: 'hessian_230', tile: 0.35, tint: 0xd8b868, saturation: 0.7, grime: 0.3, vary: 0.25, roughAdd: 0.2 });
    case 'jar':
      return solid(0x2a3a2a, 0.12, 0);
    case 'curtain':
      return surface({ tex: 'rough_linen', tile: 0.6, tint: 0xd8ccb0, grime: 0, exposure: 0, side: THREE.DoubleSide });
    case 'lamp': {
      const lm = solid(0x3a3020, 0.4, 0.5, vec3(1.0, 0.62, 0.28).mul(uTownLamps.mul(6)));
      tagKit(lm, { k: 'lamp', color: new THREE.Color(0x3a3020), rough: 0.4, metal: 0.5 });
      return lm;
    }
    default:
      return solid(0x808080, 0.8);
  }
}

/** Interior surfaces seen through shop windows: the sky IBL does not reach inside a room, so cut indirect light. */
function dim<T extends THREE.MeshStandardNodeMaterial>(m: T, k = 0.18): T {
  const v = vcol();
  m.aoNode = v.r.mul(U(k));
  if (m.userData.kit) tagKit(m, { ...m.userData.kit, dimK: k });
  return m;
}

const texturedCache = new WeakMap<THREE.Material, THREE.Material>();
/** Textured glTF materials (re-processed CC0/CC-BY props) keep their maps, gain weathering + baked AO masks. */
function upgradeTextured(src: THREE.MeshStandardMaterial, mesh: THREE.Mesh): THREE.Material {
  const hit = texturedCache.get(src);
  if (hit) return hit;
  const n = new THREE.MeshPhysicalNodeMaterial();
  n.name = src.name;
  n.side = src.side;
  n.transparent = src.transparent;
  n.alphaTest = src.alphaTest;
  const tUV = uv();
  const map = texture(src.map!, tUV);
  let base: N = map.rgb.mul(uniform(src.color.clone()));
  const hasMask = !!mesh.geometry.getAttribute('color');
  if (hasMask) base = mix(base, DUST, clamp(vcol().g.mul(0.6), 0, 1));
  const interior = src.name.startsWith('int_') || src.name.includes('interior');
  n.colorNode = interior ? base : weatherColor(base, { porosity: 0.6 });
  if (src.map && src.alphaTest > 0) n.opacityNode = map.a;
  if (src.transparent) n.opacityNode = map.a.mul(U(src.opacity));
  const rough: N = src.roughnessMap ? texture(src.roughnessMap, tUV).g.mul(U(src.roughness)) : U(src.roughness);
  n.roughnessNode = interior ? rough : weatherRough(rough, {});
  n.metalnessNode = src.metalnessMap ? texture(src.metalnessMap, tUV).b.mul(U(src.metalness)) : U(src.metalness);
  if (src.normalMap) n.normalNode = normalMap(texture(src.normalMap, tUV), uniform(src.normalScale.clone()));
  const aoT: N = src.aoMap ? texture(src.aoMap, tUV).r : float(1);
  n.aoNode = hasMask ? aoT.mul(mix(float(1), vcol().r, 0.6)) : aoT;
  if (src.emissiveMap || src.emissive.getHex() !== 0) n.emissiveNode = (src.emissiveMap ? texture(src.emissiveMap, tUV).rgb : vec3(1)).mul(uniform(src.emissive.clone())).mul(U(src.emissiveIntensity));
  if ((src as THREE.MeshPhysicalMaterial).transmission) {
    n.transmission = (src as THREE.MeshPhysicalMaterial).transmission;
    n.roughness = src.roughness;
  }
  texturedCache.set(src, n);
  return n;
}

const NO_SHADOW = /^(glass|plate_glass|prism_glass|stained_glass|sign:|poster|decal|carved|gilt|goods|jar|int_|shelf|counter|lamp|curtain|brass|iron|hat|pie|crock|globe|chalkboard|water|flag|bunting|rope|wire|insulator|bronze|cast_iron)/;

/** Swap glTF placeholder materials for town materials on every mesh under root. */
export function bindTownMaterials(root: THREE.Object3D, wear = 0.3): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.Material | THREE.Material[];
    const flat = !m.geometry.getAttribute('normal');
    const pick = (s: THREE.Material) => ((s as THREE.MeshStandardMaterial).map ? upgradeTextured(s as THREE.MeshStandardMaterial, m) : townMaterial(s.name, wear, flat));
    if (Array.isArray(src)) m.material = src.map(pick);
    else m.material = pick(src);
    // shadows only from things big enough to matter (cascades multiply every caster's draw calls)
    const nm = (Array.isArray(src) ? src[0] : src).name ?? '';
    m.castShadow = !NO_SHADOW.test(nm);
    m.receiveShadow = true;
  });
}
void max;
