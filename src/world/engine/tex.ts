import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, float, mix, positionWorld, normalMap, vertexColor, luminance } from 'three/tsl';
import { tnoise, weatherColor, weatherRough, type WeatherOpts } from './tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
export const pending: Promise<unknown>[] = [];
let maxAniso = 8;
export function setMaxAnisotropy(a: number): void {
  maxAniso = a;
}

function tex(name: string, srgb: boolean, ext = 'jpg'): THREE.Texture {
  const hit = cache.get(name);
  if (hit) return hit;
  let done: () => void = () => {};
  pending.push(
    new Promise<void>((res) => {
      done = res;
      setTimeout(res, 30000);
    }),
  );
  const t = loader.load(`${import.meta.env.BASE_URL}world/tex/${name}.${ext}`, () => done(), undefined, () => done());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  cache.set(name, t);
  return t;
}

export interface PBRSet {
  name?: string;
  map: THREE.Texture;
  normal: THREE.Texture;
  arm: THREE.Texture; // R = AO, G = roughness, B = metalness
}
export function pbr(name: string): PBRSet {
  return { name, map: tex(`${name}_diffuse`, true), normal: tex(`${name}_nor_gl`, false), arm: tex(`${name}_arm`, false) };
}

export interface MatOpts extends WeatherOpts {
  /** uv scale (repeats per uv unit) */
  scale?: number | [number, number];
  tint?: THREE.ColorRepresentation | THREE.Color;
  /** strength of large-scale brightness variation that breaks tiling */
  macro?: number;
  normalScale?: number;
  roughnessMul?: number;
  metalness?: number;
  /** custom uv node (e.g. world-projected) */
  uvNode?: N;
  side?: THREE.Side;
  vertexColors?: boolean;
  aoIntensity?: number;
  /** 1 = texture saturation as-is */
  saturation?: number;
}

/** scan name -> default saturation (0 = greyscale) */
const TINTED_SCANS: Record<string, number> = { rough_linen: 0 };

/** PBR node material from a texture set, with macro variation + rain/snow weathering. */
export function pbrMaterial(set: PBRSet, o: MatOpts = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: o.side ?? THREE.FrontSide });
  const sc = o.scale ?? 1;
  const s2 = Array.isArray(sc) ? sc : [sc, sc];
  const uvN = (o.uvNode ?? uv()).mul(vec2(s2[0], s2[1]));
  const tint = new THREE.Color(o.tint ?? 0xffffff);
  const macroAmt = o.macro ?? 0.18;
  const macro = mix(float(1 - macroAmt), float(1 + macroAmt), tnoise(positionWorld.xz.mul(0.35).add(positionWorld.y.mul(0.2))));
  let base: N = texture(set.map, uvN).rgb;
  // scans with a strong colour cast are used as greyscale detail (the tint provides the colour)
  const sat = o.saturation ?? (set.name && TINTED_SCANS[set.name] !== undefined ? TINTED_SCANS[set.name] : undefined);
  if (sat !== undefined) base = mix(vec3(luminance(base)), base, sat);
  if (set.name === 'rough_linen' && o.saturation === undefined) base = base.mul(1.25);
  base = base.mul(vec3(tint.r, tint.g, tint.b)).mul(macro);
  if (o.vertexColors !== false) base = base.mul(vertexColor());
  const arm = texture(set.arm, uvN);
  m.colorNode = weatherColor(base, o);
  m.roughnessNode = weatherRough(arm.g.mul(o.roughnessMul ?? 1).clamp(0.04, 1), o);
  m.metalnessNode = float(o.metalness ?? 0);
  const ns = o.normalScale ?? 1;
  m.normalNode = normalMap(texture(set.normal, uvN), vec2(ns, ns));
  m.aoNode = mix(float(1), arm.r, o.aoIntensity ?? 1);
  return m;
}

