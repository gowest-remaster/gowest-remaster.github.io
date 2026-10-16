// Shared TSL uniforms + node functions (terrain lookups, wind field, seasonal colours, cloud shadows, weathering).
import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  texture,
  uint,
  smoothstep,
  mix,
  clamp,
  select,
  max,
  sin,
  normalWorld,
  positionWorld,
} from 'three/tsl';
import { FIELD, FIELD_W, FIELD_D, MAX_SQUARES, REGION, HEIGHT_RES, terrainHeight } from '../env/layout';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

// ------------------------------------------------------------------ uniforms
export const uTime = uniform(0);
export const uWindDir = uniform(new THREE.Vector2(0.8, -0.6).normalize());
export const uWind = uniform(0.45);
export const uSunDir = uniform(new THREE.Vector3(0.3, 0.5, -0.8).normalize());
export const uSunColor = uniform(new THREE.Color(1, 1, 1));
export const uOvercast = uniform(0);
export const uCloudCover = uniform(0.35);
export const uCloudOffset = uniform(new THREE.Vector2());
export const uSeason = uniform(0);
export const uSnow = uniform(0);
export const uWet = uniform(0);
export const uRainHaze = uniform(0);
/** horizon sky radiance (pre-exposure): ambient light for unlit particles such as smoke */
export const uSkyAmbient = uniform(new THREE.Color(0.4, 0.42, 0.45));
export const uLightning = uniform(0);
export const uFogDensity = uniform(0.00012);
/** squares in play: 8 (one claim) or 16 (after the 1909 second claim) */
const uSquareCount = uniform(8);
/** 0..1 parched ground / heat (drought) */
export const uDrought = uniform(0);
/** 0..1 chalk-line square boundaries (field place) */
export const uFieldGrid = uniform(0);

// ------------------------------------------------------------------ field squares data (one texel per square)
// R = stage (0 prairie, 1 plowed, 2 planted, 3 sprout, 4 growing, 5 ripe, 6 stubble, 7 burnt)
// G = crop (0 none, 1 wheat, 2 winter wheat, 3 oats, 4 corn, 5 barley)
// B = growth 0..1 within the stage, A = flags (1 selected, 2 hovered, 4 marked/ghost)
export const STAGES = ['prairie', 'plowed', 'planted', 'sprout', 'growing', 'ripe', 'stubble', 'burnt'] as const;
export const CROPS = [null, 'wheat', 'winterWheat', 'oats', 'corn', 'barley'] as const;
export const fieldData = new Float32Array(MAX_SQUARES * 4);
/** Field work in progress (playFieldWork): x = square index (-1 none), y = progress 0..1 of the work front across
 *  the square (local x < y * FIELD.square already shows the new stage), z = the stage being made, w = 1 while active. */
export const uWorkFront = uniform(new THREE.Vector4(-1, 0, 0, 0));
const fieldTex = new THREE.DataTexture(fieldData, MAX_SQUARES, 1, THREE.RGBAFormat, THREE.FloatType);
fieldTex.magFilter = fieldTex.minFilter = THREE.NearestFilter;
fieldTex.generateMipmaps = false;
fieldTex.needsUpdate = true;

// ------------------------------------------------------------------ textures
function makeNoiseTexture(): THREE.DataTexture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  let seed = 1234567;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed >>> 24;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
const noiseTex = makeNoiseTexture();

/** Heights of the region baked from the CPU terrain function (half float, bilinear). */
function makeHeightTexture(): THREE.DataTexture {
  const n = HEIGHT_RES;
  const data = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = REGION.x0 + ((i + 0.5) / n) * REGION.size;
      const z = REGION.z0 + ((j + 0.5) / n) * REGION.size;
      data[j * n + i] = THREE.DataUtils.toHalfFloat(terrainHeight(x, z));
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
const heightTex = makeHeightTexture();
export const maskTexHolder = { tex: new THREE.DataTexture(new Uint8Array(4), 1, 1) as THREE.Texture };

// ------------------------------------------------------------------ hashing / noise
const pcg = Fn(([v]: N[]) => {
  const state = v.mul(uint(747796405)).add(uint(2891336453));
  const word = state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state).mul(uint(277803737));
  return word.shiftRight(uint(22)).bitXor(word);
});
/** float hash in [0,1) of an integer 2D cell (ivec2 node) */
export const hash2i = Fn(([c]: N[]) => {
  const h = pcg(uint(c.x).mul(uint(1597334677)).bitXor(pcg(uint(c.y))));
  return float(h.shiftRight(uint(8))).div(16777216.0);
});
/** cheap value noise via bilinear sampling of the random texture (lattice = 1 unit) */
export const tnoise = Fn(([p]: N[]) => texture(noiseTex, p.mul(1 / 256)).level(float(0)).r);
export const tnoise4 = Fn(([p]: N[]) => texture(noiseTex, p.mul(1 / 256)).level(float(0)));

// ------------------------------------------------------------------ region lookups
const regionUV = Fn(([p]: N[]) => p.sub(vec2(REGION.x0, REGION.z0)).div(REGION.size));
export const terrainH = Fn(([p]: N[]) => texture(heightTex, regionUV(p)).level(float(0)).r);
export const sampleMask = Fn(([p]: N[]) => {
  const uv = regionUV(p).toVar();
  const inside = uv.x.greaterThan(0).and(uv.y.greaterThan(0)).and(uv.x.lessThan(1)).and(uv.y.lessThan(1));
  return select(inside, texture(maskTexHolder.tex as THREE.Texture, uv).level(float(0)), vec4(0));
});
/** x = inside an owned square (0/1), y = square index (-1 outside), zw = local metres in the square */
export const fieldInfo = Fn(([p]: N[]) => {
  const l = vec2(p.x.sub(FIELD.x0), float(FIELD.z0).sub(p.y)).toVar();
  const pitch = FIELD.square + FIELD.gap;
  const cell = l.div(pitch).floor();
  const loc = l.sub(cell.mul(pitch));
  const inField = l.x.greaterThan(0).and(l.y.greaterThan(0)).and(l.x.lessThan(FIELD_W)).and(l.y.lessThan(FIELD_D));
  const claim = cell.x.div(2).floor();
  const idx = claim.mul(8).add(cell.y.mul(2)).add(cell.x.sub(claim.mul(2)));
  const owned = idx.lessThan(uSquareCount);
  const inSq = loc.x.lessThan(FIELD.square).and(loc.y.lessThan(FIELD.square)).and(inField).and(owned);
  return vec4(select(inSq, float(1), float(0)), select(inField.and(owned), idx, float(-1)), loc);
});
/** per-square data (see fieldData) */
export const squareData = Fn(([idx]: N[]) => texture(fieldTex, vec2(idx.add(0.5).div(MAX_SQUARES), 0.5)).level(float(0)));

// ------------------------------------------------------------------ wind
/** x = bend amount, y = gust intensity (bands rolling across the prairie with the wind) */
export const windAt = Fn(([p]: N[]) => {
  const d = uWindDir;
  const along = p.dot(d);
  const across = p.dot(vec2(d.y.negate(), d.x));
  const speed = uWind.mul(9).add(3);
  const q = vec2(along.sub(uTime.mul(speed)).mul(0.028), across.mul(0.011));
  const g0 = tnoise(q).mul(0.62).add(tnoise(q.mul(2.3).add(5)).mul(0.38));
  const g = smoothstep(0.36, 0.8, g0);
  const flutter = sin(along.mul(1.3).sub(uTime.mul(speed.mul(0.9).add(2))).add(across.mul(0.37))).mul(0.5).add(0.5);
  const bend = uWind.mul(0.3).add(g.mul(uWind.mul(0.95).add(0.12))).add(flutter.mul(0.07).mul(uWind.add(0.3)));
  return vec2(bend, g);
});

// ------------------------------------------------------------------ seasonal prairie colour (linear albedo)
export const grassAlbedo = Fn(([p, h]: N[]) => {
  const patchN = tnoise(p.mul(0.045)).mul(0.5).add(tnoise(p.mul(0.17).add(3)).mul(0.3)).add(tnoise(p.mul(0.6).add(7)).mul(0.2));
  const dryPatch = smoothstep(0.55, 0.85, tnoise(p.mul(0.021).add(11)));
  const spring = mix(vec3(0.035, 0.1, 0.012), vec3(0.11, 0.2, 0.028), h).toVar();
  spring.assign(mix(spring, vec3(0.08, 0.14, 0.03), patchN.mul(0.5)));
  spring.assign(mix(spring, vec3(0.15, 0.18, 0.05), dryPatch.mul(0.35)));
  const summer = mix(vec3(0.06, 0.1, 0.022), vec3(0.2, 0.2, 0.065), h).toVar();
  summer.assign(mix(summer, vec3(0.12, 0.16, 0.04), patchN.mul(0.45)));
  summer.assign(mix(summer, vec3(0.3, 0.24, 0.1), dryPatch.mul(0.55)));
  const autumn = mix(vec3(0.22, 0.1, 0.03), vec3(0.45, 0.28, 0.09), h).toVar();
  autumn.assign(mix(autumn, vec3(0.42, 0.12, 0.035), smoothstep(0.45, 0.8, patchN).mul(0.8)));
  const winter = mix(vec3(0.22, 0.17, 0.11), vec3(0.42, 0.35, 0.24), h);
  const s = uSeason;
  const c = mix(spring, summer, clamp(s, 0, 1)).toVar();
  c.assign(mix(c, autumn, clamp(s.sub(1), 0, 1)));
  c.assign(mix(c, winter, clamp(s.sub(2), 0, 1)));
  // drought: scorched, bleached straw
  c.assign(mix(c, mix(vec3(0.3, 0.24, 0.13), vec3(0.45, 0.38, 0.24), h), uDrought.mul(0.85)));
  return c;
});

// ------------------------------------------------------------------ clouds (shadows on the ground)
const cloudMap = Fn(([xz]: N[]) => {
  const p = xz.add(uCloudOffset).mul(0.00045);
  const base = tnoise(p).mul(0.5).add(tnoise(p.mul(2.03).add(1.7)).mul(0.27)).add(tnoise(p.mul(4.1).add(9.2)).mul(0.14)).add(tnoise(p.mul(8.3).add(3.3)).mul(0.09));
  const cov = uCloudCover;
  return smoothstep(float(1).sub(cov).sub(0.08), float(1).sub(cov).add(0.28), base);
});
export const cloudShadowAt = Fn(([wp]: N[]) => {
  const L = uSunDir;
  const t = float(1800).sub(wp.y).div(max(L.y, 0.08));
  const c = cloudMap(wp.xz.add(L.xz.mul(t)));
  const s = float(1).sub(c.mul(0.8));
  return mix(s, float(1), uOvercast);
});

// ------------------------------------------------------------------ weathering (rain darkening, snow on up-faces)
export interface WeatherOpts {
  porosity?: number;
  exposure?: number;
  snowStart?: number;
}
export function weatherColor(base: N, o: WeatherOpts = {}): N {
  const porosity = o.porosity ?? 0.8;
  const expo = o.exposure ?? 1;
  return Fn(() => {
    const wet = uWet.mul(expo);
    const c = base.mul(mix(float(1), float(0.5), wet.mul(porosity))).toVar();
    const nz = tnoise(positionWorld.xz.mul(3.1).add(positionWorld.y.mul(2))).mul(0.25).add(tnoise(positionWorld.xz.mul(0.6)).mul(0.2));
    const sn = uSnow.mul(expo);
    const snowMask = smoothstep(0.56, 0.86, normalWorld.y.add(nz).add(sn.sub(0.75).mul(0.9))).mul(smoothstep(0.0, 0.25, sn));
    return mix(c, vec3(0.86, 0.9, 0.95), snowMask);
  })();
}
export function weatherRough(base: N, o: WeatherOpts = {}): N {
  const expo = o.exposure ?? 1;
  return Fn(() => {
    const wet = uWet.mul(expo);
    const r = mix(base, mix(float(0.32), float(0.1), clamp(normalWorld.y, 0, 1)), wet.mul(0.85)).toVar();
    const nz = tnoise(positionWorld.xz.mul(3.1).add(positionWorld.y.mul(2))).mul(0.25).add(tnoise(positionWorld.xz.mul(0.6)).mul(0.2));
    const sn = uSnow.mul(expo);
    const snowMask = smoothstep(0.5, 0.82, normalWorld.y.add(nz).add(sn.sub(0.75).mul(0.9))).mul(smoothstep(0.0, 0.25, sn));
    return mix(r, float(0.62), snowMask);
  })();
}

