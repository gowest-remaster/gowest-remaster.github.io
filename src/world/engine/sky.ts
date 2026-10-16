// HDRI skies (CC0 Poly Haven "puresky" captures) used as the visible sky AND image-based lighting.
// The sun is removed from the IBL copy (clamped) and re-added as a shadow-casting directional light,
// with each HDRI rotated so its captured sun azimuth lines up with our simulated sun.
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Fn, texture, equirectUV, vec3, float, mix, uniform, positionWorldDirection, smoothstep, cos, sin, exp, positionView, fog, max, positionWorld, cameraPosition } from 'three/tsl';
import { uLightning, uRainHaze, uSunDir, uSunColor, uOvercast } from './tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export type SkyId = 'clear' | 'golden' | 'overcast' | 'storm' | 'snow';
const FILES: Record<SkyId, string> = {
  clear: 'kloofendal_48d_partly_cloudy_puresky',
  golden: 'evening_road_01_puresky',
  overcast: 'kloofendal_overcast_puresky',
  storm: 'overcast_soil_puresky',
  snow: 'snow_field_2_puresky',
};

export interface SkyEntry {
  id: SkyId;
  bg: THREE.DataTexture; // full-range, for the visible sky
  ibl: THREE.DataTexture; // sun clamped, for PMREM
  env: THREE.Texture | null;
  sunAz: number; // radians, azimuth of the captured sun in texture space
  sunEl: number;
  horizon: THREE.Color; // average horizon radiance (for haze)
  skyIrr: number;
  sunIrr: number; // irradiance of the clamped-off sun (drives the directional light)
  sunColor: THREE.Color;
}

function half(v: number): number {
  return THREE.DataUtils.fromHalfFloat(v);
}

function analyse(tex: THREE.DataTexture, id: SkyId): SkyEntry {
  const img = tex.image as { data: Uint16Array; width: number; height: number };
  const { width: w, height: h, data } = img;
  const ch = data.length / (w * h);
  let best = -1;
  let bx = 0;
  let by = 0;
  const step = 2;
  for (let y = 0; y < h / 2; y += step) {
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * ch;
      const l = half(data[o]) * 0.2126 + half(data[o + 1]) * 0.7152 + half(data[o + 2]) * 0.0722;
      if (l > best) {
        best = l;
        bx = x;
        by = y;
      }
    }
  }
  // horizon colour: average of a band just above the horizon
  const hz = new THREE.Color(0, 0, 0);
  let cnt = 0;
  const y0 = Math.floor(h * 0.47);
  const y1 = Math.floor(h * 0.495);
  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < w; x += 8) {
      const o = (y * w + x) * ch;
      hz.r += half(data[o]);
      hz.g += half(data[o + 1]);
      hz.b += half(data[o + 2]);
      cnt++;
    }
  }
  hz.multiplyScalar(1 / cnt);
  // IBL copy with the sun clamped out (the directional light provides it, with shadows)
  const clampV = THREE.DataUtils.toHalfFloat(id === 'clear' || id === 'golden' ? 12 : 60);
  const clampF = half(clampV);
  const d2 = new Uint16Array(data.length);
  d2.set(data);
  const sunC = new THREE.Color(0, 0, 0);
  const dOmega = ((2 * Math.PI) / w) * (Math.PI / h);
  for (let y = 0; y < h / 2; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const sa = dOmega * Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch;
      const r = half(data[o]);
      const g = half(data[o + 1]);
      const b = half(data[o + 2]);
      const m = Math.max(r, g, b);
      if (m > clampF) {
        const k = clampF / m;
        sunC.r += r * (1 - k) * sa;
        sunC.g += g * (1 - k) * sa;
        sunC.b += b * (1 - k) * sa;
        d2[o] = THREE.DataUtils.toHalfFloat(r * k);
        d2[o + 1] = THREE.DataUtils.toHalfFloat(g * k);
        d2[o + 2] = THREE.DataUtils.toHalfFloat(b * k);
      }
    }
  }
  // half-float HDR clips the sun disc, so derive the sun from the sky's diffuse irradiance on a
  // horizontal surface and a typical direct:diffuse ratio; colour from the glow around the sun.
  let skyIrr = 0;
  const glow = new THREE.Color(0, 0, 0);
  for (let y = 0; y < h / 2; y += 2) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const sa = dOmega * 4 * Math.cos(lat) * Math.sin(lat);
    for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * ch;
      const r = Math.min(half(data[o]), clampF);
      const g = Math.min(half(data[o + 1]), clampF);
      const b = Math.min(half(data[o + 2]), clampF);
      skyIrr += (0.2126 * r + 0.7152 * g + 0.0722 * b) * sa;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > Math.min(best, clampF) * 0.35) {
        glow.r += r;
        glow.g += g;
        glow.b += b;
      }
    }
  }
  const ratio: Record<SkyId, number> = { clear: 6, golden: 6.5, overcast: 0, storm: 0, snow: 0 };
  const sunIrr = skyIrr * ratio[id];
  const gm = Math.max(glow.r, glow.g, glow.b) || 1;
  const sunColor = glow.multiplyScalar(1 / gm);
  if (id === 'clear') sunColor.lerp(new THREE.Color(1, 0.97, 0.92), 0.6);
  if (id === 'golden') sunColor.lerp(new THREE.Color(1, 0.68, 0.38), 0.6);
  void sunC;
  const ibl = new THREE.DataTexture(d2, w, h, tex.format as THREE.PixelFormat, THREE.HalfFloatType);
  ibl.mapping = THREE.EquirectangularReflectionMapping;
  ibl.colorSpace = THREE.LinearSRGBColorSpace;
  ibl.magFilter = ibl.minFilter = THREE.LinearFilter;
  ibl.needsUpdate = true;
  const u = bx / w;
  const v = by / h;
  // three equirect: u = atan(dir.z, dir.x) / 2pi + 0.5, v = asin(dir.y)/pi + 0.5 (with flipY)
  const sunAz = (u - 0.5) * Math.PI * 2;
  const sunEl = (0.5 - v) * Math.PI;
  console.info('[sky]', id, 'skyIrr', skyIrr.toFixed(2), 'sunIrr', sunIrr.toFixed(2), 'sunCol', sunColor.toArray().map((v) => v.toFixed(2)).join(','), 'el', ((sunEl * 180) / Math.PI).toFixed(1), 'az', ((sunAz * 180) / Math.PI).toFixed(1), 'horizon', hz.toArray().map((v) => v.toFixed(3)).join(','), 'peak', best.toFixed(1));
  return { id, bg: tex, ibl, env: null, sunAz, sunEl, horizon: hz, skyIrr, sunIrr, sunColor };
}

export class Skies {
  entries = new Map<SkyId, SkyEntry>();
  /** blend A -> B */
  uBlend = uniform(0);
  uRotA = uniform(0);
  uRotB = uniform(0);
  uExposureA = uniform(1);
  uExposureB = uniform(1);
  texA: N;
  texB: N;
  current: SkyId = 'clear';
  next: SkyId = 'clear';
  ready: Promise<void>;
  backgroundNode: N;
  fogNode: N;

  constructor(renderer: THREE.WebGPURenderer, fogDensity: N, hazeTint: N) {
    const loader = new HDRLoader();
    loader.setDataType(THREE.HalfFloatType);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const placeholder = new THREE.DataTexture(new Uint16Array(4 * 4), 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    placeholder.needsUpdate = true;
    const dirRot = (rot: N) =>
      Fn(() => {
        const d = positionWorldDirection;
        const c = cos(rot);
        const s = sin(rot);
        return vec3(d.x.mul(c).sub(d.z.mul(s)), d.y, d.x.mul(s).add(d.z.mul(c)));
      })();
    const uvA = equirectUV(dirRot(this.uRotA));
    const uvB = equirectUV(dirRot(this.uRotB));
    this.texA = texture(placeholder, uvA);
    this.texB = texture(placeholder, uvB);
    this.backgroundNode = Fn(() => {
      const a = this.texA.rgb.mul(this.uExposureA);
      const b = this.texB.rgb.mul(this.uExposureB);
      const c = mix(a, b, this.uBlend).toVar();
      // sun halo: the HDRI sun is clamped out of the IBL copy and the disc itself is clipped in half-float,
      // so re-add a Mie forward-scattering glow + a small hot core around the simulated sun
      const mu = positionWorldDirection.dot(uSunDir).max(0);
      const sunGlow = vec3(uSunColor as N).mul(mu.pow(900).mul(1.2).add(mu.pow(48).mul(0.05)).add(mu.pow(6).mul(0.012)));
      c.addAssign(sunGlow.mul(float(1).sub(uOvercast.mul(0.92))));
      // rain curtain: grey veil strongest toward the horizon
      const dy = positionWorldDirection.y;
      const veil = uRainHaze.mul(float(1).sub(smoothstep(0.0, 0.35, dy))).mul(0.75);
      c.assign(mix(c, hazeTint, veil));
      c.addAssign(vec3(0.75, 0.8, 1.0).mul(uLightning).mul(2.0));
      // below the horizon the puresky captures are blank: use the haze colour
      c.assign(mix(hazeTint, c, smoothstep(-0.02, 0.01, dy)));
      return c;
    })();
    const fogFactor = Fn(() => {
      const d = positionView.length();
      // weather haze hugs the ground: thin it with the ray's mean height (aerial views, e.g. the field, stay readable)
      const hMean = max(cameraPosition.y.add(positionWorld.y).mul(0.5), 0);
      const thin = mix(float(1), exp(hMean.div(-70)), uRainHaze.mul(4).min(1));
      const dens = fogDensity.mul(uRainHaze.mul(18).mul(thin).add(1));
      return float(1).sub(exp(d.mul(dens).negate())).mul(max(float(0.96), 0));
    })();
    this.fogNode = fog(hazeTint, fogFactor);

    const load = async (id: SkyId) => {
      const t = (await loader.loadAsync(`${import.meta.env.BASE_URL}world/hdri/${FILES[id]}.hdr`)) as THREE.DataTexture;
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      const e = analyse(t, id);
      e.env = pmrem.fromEquirectangular(e.ibl).texture;
      this.entries.set(id, e);
      this.onLoaded?.(e);
    };
    // clear + golden gate the title; the weather skies stream in afterwards
    this.ready = (async () => {
      await Promise.all((['clear', 'golden'] as SkyId[]).map(load));
      this.texA.value = this.entries.get('clear')!.bg;
      this.texB.value = this.entries.get('clear')!.bg;
    })();
    this.all = this.ready.then(() => Promise.all((['overcast', 'storm', 'snow'] as SkyId[]).map(load))).then(() => undefined);
  }
  all: Promise<void>;
  onLoaded: ((e: SkyEntry) => void) | null = null;

  /** Rotation that puts entry's captured sun at world azimuth `az` (atan2(z, x)). */
  rotationFor(id: SkyId, sunDir: THREE.Vector3): number {
    const e = this.entries.get(id);
    if (!e) return 0;
    const az = Math.atan2(sunDir.z, sunDir.x);
    return e.sunAz - az;
  }
}
