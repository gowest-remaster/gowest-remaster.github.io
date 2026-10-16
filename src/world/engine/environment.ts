// Shared outdoor lighting rig used by the game world AND lookdev: HDRI sky dome + IBL (PMREM), a
// cascaded-shadow sun matched to the HDRI, aerial-perspective haze, weather state smoothing and
// per-sky exposure normalisation. Everything that writes the global lighting uniforms lives here.
import * as THREE from 'three/webgpu';
import { uniform, positionWorld, cameraPosition, mix, pow, max, normalize, Fn, float, pmremTexture } from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { Skies, type SkyId } from './sky';
import {
  uWind, uWindDir, uSunDir, uSunColor, uOvercast, uCloudCover, uSeason, uSnow, uWet, uRainHaze, uSkyAmbient, uFogDensity, uDrought, cloudShadowAt,
} from './tsl';

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'storm' | 'snow';

export interface EnvState {
  weather: WeatherKind;
  month: number;
  hour: number;
  wind: number;
  snowCover: number;
  drought: number;
  /** 0..1 darkening for cinematics */
  darken?: number;
  /** multiplier on sky fill light (street canyons) */
  fill?: number;
  /** sky (IBL) to light the live actors with, overriding the weather's: a pre-rendered view's key names the sky it
   *  was baked under, so live figures match the plate (e.g. the snow key under clear weather) */
  sky?: string;
}

const WEATHER = {
  clear: { overcast: 0, cloud: 0.32, rain: 0, snowFall: 0, haze: 0, wet: 0, windMin: 0 },
  overcast: { overcast: 1, cloud: 0.9, rain: 0, snowFall: 0, haze: 0.05, wet: 0.05, windMin: 0.3 },
  rain: { overcast: 1, cloud: 0.95, rain: 0.55, snowFall: 0, haze: 0.28, wet: 0.85, windMin: 0.45 },
  storm: { overcast: 1, cloud: 1, rain: 1, snowFall: 0, haze: 0.75, wet: 1, windMin: 0.85 },
  snow: { overcast: 1, cloud: 0.95, rain: 0, snowFall: 1, haze: 0.22, wet: 0, windMin: 0.25 },
} as const;

/** continuous season value from the month: Apr 0 (spring), Jul 1, Oct 2, Jan 3, back to spring at 4 */
function seasonValue(month: number): number {
  return (((month - 4 + 12) % 12) + 0.5) / 3;
}

/** Sun direction for Kansas (38.5°N). World axes: north = -z, east = +x. */
function sunDirection(hour: number, month: number, out: THREE.Vector3): THREE.Vector3 {
  const doy = month * 30.4 - 15;
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const lat = THREE.MathUtils.degToRad(38.5);
  const dec = THREE.MathUtils.degToRad(decl);
  const H = THREE.MathUtils.degToRad((hour - 12) * 15);
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  let az = Math.acos(THREE.MathUtils.clamp((Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat)), -1, 1));
  if (H > 0) az = 2 * Math.PI - az;
  const h = Math.cos(el);
  // azimuth from north (−z), clockwise toward east (+x)
  return out.set(h * Math.sin(az), Math.sin(el), -h * Math.cos(az)).normalize();
}

export class Environment {
  skies: Skies;
  sun = new THREE.DirectionalLight(0xffffff, 1);
  live = { overcast: 0, cloud: 0.3, rain: 0, snowFall: 0, haze: 0, wet: 0, snow: 0, season: 0, hour: 9.5, wind: 0.45, drought: 0 };
  /** exposure the camera should use after per-sky normalisation (multiply by the user exposure) */
  cameraExposure = 1;
  /** sky radiance near the horizon (for rain/snow particle lighting etc.) */
  horizon = new THREE.Color(0.6, 0.7, 0.8);
  shownEnv: SkyId | null = null;
  onEnvChange: ((env: THREE.Texture) => void) | null = null;
  private envNode: ReturnType<typeof pmremTexture> | null = null;
  private uHaze = uniform(new THREE.Color(0.6, 0.7, 0.8));
  private uHazeSun = uniform(new THREE.Color(1, 0.85, 0.6));
  private SKY_EXPOSURE: Record<SkyId, number> = { clear: 1, golden: 1, overcast: 1, storm: 1, snow: 1 };
  private CAM_EXPOSURE: Record<SkyId, number> = { clear: 1, golden: 1, overcast: 1, storm: 1, snow: 1 };
  private scene: THREE.Scene;
  snap = true;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, opts: { shadowFar?: number; cascades?: number } = {}) {
    this.scene = scene;
    const hazeTint = Fn(() => {
      const d = normalize(positionWorld.sub(cameraPosition));
      const s = pow(max(d.dot(uSunDir), 0), 6).mul(float(1).sub(uOvercast));
      return mix(this.uHaze, this.uHazeSun, s);
    })();
    this.skies = new Skies(renderer, uFogDensity, hazeTint);
    scene.backgroundNode = this.skies.backgroundNode;
    scene.fogNode = this.skies.fogNode;
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 900;
    Object.assign(sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 3;
    sun.shadow.mapSize.set(2048, 2048);
    const csm = new CSMShadowNode(sun, { cascades: opts.cascades ?? 3, maxFar: opts.shadowFar ?? 240, mode: 'practical', lightMargin: 120 });
    csm.fade = true;
    sun.shadow.shadowNode = csm;
    this.installStagger(csm);
    (sun as unknown as { colorNode: unknown }).colorNode = (uSunColor as unknown as { mul: (x: unknown) => unknown }).mul(cloudShadowAt(positionWorld));
    scene.add(sun, sun.target);
    // the environment node exists from the first frame (a dim neutral placeholder until the HDRIs stream in):
    // installing it later changes every material's dynamic cache key and rebuilds them all on the spot
    const ph = new THREE.DataTexture(new Uint16Array([...Array(8 * 4 * 4)].map((_, i) => THREE.DataUtils.toHalfFloat(i % 4 === 3 ? 1 : 0.35))), 8, 4, THREE.RGBAFormat, THREE.HalfFloatType);
    ph.mapping = THREE.EquirectangularReflectionMapping;
    ph.needsUpdate = true;
    this.envNode = pmremTexture(ph);
    scene.environmentNode = this.envNode;
  }

  /** Far-cascade update interval in frames (1 = every frame). The near cascade (people, animals, props) always renders
   * every frame; the far ones cover the whole set and dominate the CPU-side shadow cost, so they take turns. A
   * skipped cascade keeps last frame's light camera, so its map and matrix stay consistent. */
  shadowStagger = 1;
  private shadowFrame = 0;

  private installStagger(csm: CSMShadowNode): void {
    const orig = csm.updateBefore.bind(csm);
    const keep: [THREE.Vector3, THREE.Vector3][] = [];
    csm.updateBefore = (b: unknown) => {
      const lights = csm.lights as THREE.DirectionalLight[];
      const n = this.shadowStagger;
      const f = this.shadowFrame++;
      // cascade i>0 renders on frames where (f + i) % n === 0 (with n = 2: cascade 1 and 2 alternate)
      const skip = lights.map((_l, i) => n > 1 && f > n && i > 0 && (f + i) % n !== 0);
      lights.forEach((l, i) => {
        l.shadow.autoUpdate = false;
        if (skip[i]) keep[i] = [l.position.clone(), l.target.position.clone()];
      });
      orig(b as never);
      lights.forEach((l, i) => {
        if (skip[i]) {
          l.position.copy(keep[i][0]);
          l.target.position.copy(keep[i][1]);
          l.updateMatrixWorld();
          l.target.updateMatrixWorld();
          l.shadow.needsUpdate = false;
        } else l.shadow.needsUpdate = true;
      });
    };
  }

  async ready(): Promise<void> {
    await this.skies.ready;
    this.normalise();
    this.skies.onLoaded = () => this.normalise();
  }

  private normalise(): void {
    // each capture has its own exposure: normalise to plausible total illuminance (sun + sky) and let
    // the "eye" adapt part of the way back
    const TARGET: Record<SkyId, number> = { clear: 10.5, golden: 7.5, overcast: 3.6, storm: 1.8, snow: 4.2 };
    for (const e of this.skies.entries.values()) {
      this.SKY_EXPOSURE[e.id] = TARGET[e.id] / (e.skyIrr + e.sunIrr);
      this.CAM_EXPOSURE[e.id] = Math.pow(10.5 / TARGET[e.id], 0.55);
    }
  }

  /** Advance the smoothed state toward `s` and write every lighting uniform. `camera` anchors the shadow frustum. */
  update(s: EnvState, dt: number, camera: THREE.Camera, holdHour = false): void {
    const w = WEATHER[s.weather];
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 1.5);
    const kSlow = this.snap ? 1 : 1 - Math.exp(-dt * 0.4);
    const L = this.live;
    L.overcast += (w.overcast - L.overcast) * k;
    L.cloud += (w.cloud - L.cloud) * k;
    L.rain += (w.rain - L.rain) * k;
    L.snowFall += (w.snowFall - L.snowFall) * k;
    L.haze += (w.haze - L.haze) * k;
    L.wet += (w.wet - L.wet) * kSlow;
    L.snow += (s.snowCover - L.snow) * kSlow;
    const sT = seasonValue(s.month);
    if (Math.abs(sT - L.season) > 1.5) L.season = sT;
    L.season += (sT - L.season) * k;
    L.hour += (s.hour - L.hour) * (holdHour ? 1 : k);
    L.drought += (s.drought - L.drought) * kSlow;
    L.wind += (Math.max(s.wind, w.windMin) - L.wind) * k;
    this.snap = false;

    const sd = sunDirection(L.hour, s.month, uSunDir.value as THREE.Vector3);
    const el = Math.asin(sd.y);
    let A: SkyId;
    let B: SkyId;
    let blend = 0;
    if (s.weather === 'clear') {
      A = 'clear';
      B = 'golden';
      blend = 1 - THREE.MathUtils.smoothstep(el, 0.12, 0.3);
    } else if (s.weather === 'overcast') A = B = 'overcast';
    else if (s.weather === 'snow') A = B = 'snow';
    else A = B = 'storm';
    if (s.sky && this.skies.entries.has(s.sky as SkyId)) {
      A = B = s.sky as SkyId;
      blend = 0;
    }
    if (!this.skies.entries.has(A)) A = 'clear';
    if (!this.skies.entries.has(B)) B = 'clear';
    const eA = this.skies.entries.get(A);
    const eB = this.skies.entries.get(B);
    const darken = 1 - (s.darken ?? 0);
    const night = THREE.MathUtils.smoothstep(el, -0.12, 0.02);
    if (eA && eB) {
      const sk = this.skies;
      sk.texA.value = eA.bg;
      sk.texB.value = eB.bg;
      sk.uBlend.value = blend;
      sk.uRotA.value = sk.rotationFor(A, sd);
      sk.uRotB.value = sk.rotationFor(B, sd);
      const dim = darken * (0.08 + 0.92 * night);
      sk.uExposureA.value = this.SKY_EXPOSURE[A] * dim;
      sk.uExposureB.value = this.SKY_EXPOSURE[B] * dim;
      const envId = blend > 0.5 ? B : A;
      const envE = envId === A ? eA : eB;
      if (envId !== this.shownEnv) {
        // swap the texture under ONE persistent environment node: assigning scene.environment builds a new
        // texture node, which changes every material's cache key and rebuilds all ~600 of them (multi-second hitch)
        if (envE.env && this.envNode) this.envNode.value = envE.env;
        this.shownEnv = envId;
        if (envE.env) this.onEnvChange?.(envE.env);
      }
      this.scene.environmentRotation.y = -((envId === A ? sk.uRotA.value : sk.uRotB.value) as number);
      this.scene.environmentIntensity = this.SKY_EXPOSURE[envId] * dim * (s.fill ?? 1);
      const sunC = new THREE.Color().copy(eA.sunColor).lerp(eB.sunColor, blend);
      const elK = THREE.MathUtils.smoothstep(el, -0.02, 0.08);
      const sunI = THREE.MathUtils.lerp(eA.sunIrr * this.SKY_EXPOSURE[A], eB.sunIrr * this.SKY_EXPOSURE[B], blend) * elK * (1 - L.overcast * 0.97) * darken;
      // low sun: longer air path reddens the direct light
      const low = 1 - THREE.MathUtils.smoothstep(el, 0.02, 0.22);
      sunC.lerp(new THREE.Color(1, 0.55, 0.28), low * 0.55);
      (uSunColor.value as THREE.Color).copy(sunC).multiplyScalar(sunI);
      const hz = new THREE.Color().copy(eA.horizon).lerp(eB.horizon, blend).multiplyScalar(this.SKY_EXPOSURE[envId] * dim);
      (this.uHaze.value as THREE.Color).copy(hz);
      (this.uHazeSun.value as THREE.Color).copy(hz).lerp(sunC.clone().multiplyScalar(hz.r + hz.g + hz.b), 0.35);
      this.horizon.copy(hz);
      (uSkyAmbient.value as THREE.Color).copy(hz);
      this.cameraExposure = this.CAM_EXPOSURE[envId];
    }
    this.sun.position.copy(sd).multiplyScalar(400).add(camera.position);
    this.sun.target.position.copy(camera.position);
    uOvercast.value = L.overcast;
    uCloudCover.value = L.cloud;
    uRainHaze.value = Math.max(L.haze, L.snowFall * 0.18);
    uFogDensity.value = 0.00006 + L.haze * 0.00022 + L.drought * 0.00012;
    uWet.value = L.wet;
    uSnow.value = L.snow;
    uSeason.value = L.season;
    uDrought.value = L.drought;
    uWind.value = L.wind;
    (uWindDir.value as THREE.Vector2).set(Math.cos(0.6), -Math.sin(0.6));
  }
}
