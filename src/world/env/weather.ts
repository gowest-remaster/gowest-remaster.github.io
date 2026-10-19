// Precipitation: GPU-animated rain streaks (velocity-aligned, length = motion blur), ground splash rings,
/* eslint-disable @typescript-eslint/no-explicit-any */
// and snowflakes with turbulent drift. All particles live in world-anchored wrapping boxes around the
// camera, so they don't swim when the camera moves; counts scale with intensity.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, int, ivec2, uniform, instanceIndex, positionGeometry, cameraPosition, uv, mix, smoothstep, sin, cos, normalize, cross,
  fract, varying, mod,
} from 'three/tsl';
import { hash2i, terrainH, uTime, uWindDir, uLightning } from '../engine/tsl';
import { LOW_MEMORY } from '../../lowmem';
import { ScreenWeather } from './screenWeather';


const quad = (): THREE.InstancedBufferGeometry => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
};

export class Weather {
  group = new THREE.Group();
  rain: THREE.Mesh;
  splash: THREE.Mesh;
  snow: THREE.Mesh;
  uWindSpeed = uniform(5);
  uRain = uniform(0);
  uSnowFall = uniform(0);
  uLight = uniform(new THREE.Color(0.5, 0.55, 0.6));
  readonly maxRain = 60000;
  readonly maxSplash = 5000;
  readonly maxSnow = 40000;
  /** phones: one full-screen overlay per effect instead of the particle boxes (see screenWeather.ts) */
  private screen: ScreenWeather | null = LOW_MEMORY ? new ScreenWeather(this.uLight) : null;
  private fx = { hail: 0, dust: 0 };
  private fwd = new THREE.Vector3();

  constructor() {
    const box = vec3(70, 36, 70);
    // ---------------------------------------------------------------- rain streaks
    {
      const g = quad();
      g.instanceCount = 0;
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const vA = varying(float(), 'vRainA');
      m.positionNode = Fn(() => {
        const id = int(instanceIndex);
        const r1 = hash2i(ivec2(id, 3));
        const r2 = hash2i(ivec2(id, 7));
        const r3 = hash2i(ivec2(id, 13));
        const r4 = hash2i(ivec2(id, 17));
        const fallV = r4.mul(2).add(8.5); // m/s
        const vel = vec3(uWindDir.x.mul(this.uWindSpeed), fallV.negate(), uWindDir.y.mul(this.uWindSpeed)).mul(r3.mul(0.15).add(0.92));
        const t = uTime;
        const base = vec3(r1, r2, r3).mul(box).add(vel.mul(t));
        // wrap into a box centred on the camera (world anchored)
        const rel = mod(base.sub(cameraPosition).add(box.mul(0.5)), box).sub(box.mul(0.5));
        const p = cameraPosition.add(rel).add(vec3(0, 8, 0));
        const dir = normalize(vel);
        const toCam = normalize(cameraPosition.sub(p));
        const side = normalize(cross(dir, toCam));
        const len = fallV.mul(0.04).mul(r1.mul(0.4).add(0.8)); // ~shutter 1/25 s
        const w = float(0.0045).mul(rel.length().mul(0.04).add(1));
        const gy = terrainH(p.xz);
        const below = p.y.lessThan(gy);
        const vis = float(id).lessThan(float(this.maxRain).mul(this.uRain));
        const dist = rel.length();
        vA.assign(smoothstep(36, 10, dist).mul(smoothstep(3.5, 7.0, dist)).mul(r2.mul(0.5).add(0.5)));
        const pos = p.add(side.mul(positionGeometry.x.mul(w))).sub(dir.mul(positionGeometry.y.mul(len)));
        return below.or(vis.not()).or(dist.lessThan(3.5)).select(vec3(0, -9999, 0), pos);
      })();
      const along = uv().y;
      const across = uv().x.sub(0.5).abs().mul(2);
      m.colorNode = (this.uLight as any).mul(5.0).add(vec3(0.7, 0.75, 0.9).mul(uLightning).mul(3));
      m.opacityNode = vA.mul(smoothstep(0, 0.25, along)).mul(smoothstep(1, 0.6, along)).mul(float(1).sub(across)).mul(0.3);
      this.rain = new THREE.Mesh(g, m);
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 10;
      this.group.add(this.rain);
    }
    // ---------------------------------------------------------------- splashes (rings on the ground)
    {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      g.instanceCount = 0;
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const vPh = varying(float(), 'vSplashPh');
      m.positionNode = Fn(() => {
        const id = int(instanceIndex);
        const rate = float(2.2);
        const ph0 = hash2i(ivec2(id, 101));
        const cyc = uTime.mul(rate).add(ph0);
        const k = int(cyc.floor());
        const ph = fract(cyc);
        const a = hash2i(ivec2(id, k)).mul(6.2831);
        const rr = hash2i(ivec2(k, id)).sqrt().mul(22);
        const xz = cameraPosition.xz.add(vec2(cos(a), sin(a)).mul(rr));
        const gy = terrainH(xz).add(0.03);
        const size = ph.mul(0.16).add(0.03);
        vPh.assign(ph);
        const vis = float(id).lessThan(float(this.maxSplash).mul(this.uRain));
        return vis.select(vec3(xz.x, gy, xz.y).add(positionGeometry.mul(size)), vec3(0, -9999, 0));
      })();
      const d = uv().sub(0.5).length().mul(2);
      const ring = smoothstep(0.62, 0.8, d).mul(smoothstep(1.0, 0.85, d));
      m.colorNode = (this.uLight as any).mul(1.6);
      m.opacityNode = ring.mul(float(1).sub(vPh)).mul(0.35);
      this.splash = new THREE.Mesh(g, m);
      this.splash.frustumCulled = false;
      this.group.add(this.splash);
    }
    // ---------------------------------------------------------------- snow
    {
      const g = quad();
      g.instanceCount = 0;
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const vA = varying(float(), 'vSnowA');
      const sbox = vec3(50, 30, 50);
      m.positionNode = Fn(() => {
        const id = int(instanceIndex);
        const r1 = hash2i(ivec2(id, 31));
        const r2 = hash2i(ivec2(id, 37));
        const r3 = hash2i(ivec2(id, 41));
        const fall = r3.mul(0.6).add(0.9);
        const t = uTime;
        const drift = vec3(uWindDir.x.mul(this.uWindSpeed).mul(0.5), fall.negate(), uWindDir.y.mul(this.uWindSpeed).mul(0.5));
        const swirl = vec3(sin(t.mul(r1.add(0.6)).add(r2.mul(20))).mul(0.6), 0, cos(t.mul(r2.add(0.5)).add(r1.mul(20))).mul(0.6));
        const base = vec3(r1, r2, r3).mul(sbox).add(drift.mul(t)).add(swirl);
        const rel = mod(base.sub(cameraPosition).add(sbox.mul(0.5)), sbox).sub(sbox.mul(0.5));
        const p = cameraPosition.add(rel).add(vec3(0, 6, 0));
        const toCam = normalize(cameraPosition.sub(p));
        const right = normalize(cross(vec3(0, 1, 0), toCam));
        const up = cross(toCam, right);
        const s = r1.mul(0.012).add(0.014);
        const vis = float(id).lessThan(float(this.maxSnow).mul(this.uSnowFall)).and(p.y.greaterThan(terrainH(p.xz)));
        const dist = rel.length();
        vA.assign(smoothstep(28, 8, dist).mul(smoothstep(0.3, 1.2, dist)));
        const q = positionGeometry.xy.sub(vec2(0, 0.5));
        return vis.select(p.add(right.mul(q.x.mul(s))).add(up.mul(q.y.mul(s))), vec3(0, -9999, 0));
      })();
      const d = uv().sub(0.5).length().mul(2);
      m.colorNode = (this.uLight as any).mul(1.6).add(0.03);
      m.opacityNode = smoothstep(1, 0.2, d).mul(vA).mul(0.9);
      this.snow = new THREE.Mesh(g, m);
      this.snow.frustumCulled = false;
      this.group.add(this.snow);
    }
    void mix;
    if (this.screen) this.group.add(this.screen.group);
  }

  /** disaster precipitation that the phone overlay draws (hail pellets, blowing dust); 0..1 */
  setScreenFx(hail: number, dust: number): void {
    this.fx.hail = hail;
    this.fx.dust = dust;
  }

  update(_dt: number, _t: number, _cam: THREE.Camera, rain: number, snow: number, wind: number, storm: boolean): void {
    if (this.screen) {
      // the wind's lean on screen: its component across the view direction
      const fwd = _cam.getWorldDirection(this.fwd);
      const wd = uWindDir.value as THREE.Vector2;
      const across = wd.x * -fwd.z + wd.y * fwd.x;
      const slant = across * (0.08 + wind * (storm ? 0.35 : 0.22));
      this.screen.update(_cam, rain, snow, this.fx.hail, this.fx.dust, slant);
      this.rain.visible = this.splash.visible = this.snow.visible = false;
      return;
    }
    this.uRain.value = rain;
    this.uSnowFall.value = snow;
    this.uWindSpeed.value = 1 + wind * (storm ? 9 : 6);
    (this.rain.geometry as THREE.InstancedBufferGeometry).instanceCount = rain > 0.01 ? this.maxRain : 0;
    (this.splash.geometry as THREE.InstancedBufferGeometry).instanceCount = rain > 0.01 ? this.maxSplash : 0;
    (this.snow.geometry as THREE.InstancedBufferGeometry).instanceCount = snow > 0.01 ? this.maxSnow : 0;
    this.rain.visible = rain > 0.01;
    this.splash.visible = rain > 0.01;
    this.snow.visible = snow > 0.01;
  }

  setLight(c: THREE.Color): void {
    (this.uLight.value as THREE.Color).copy(c);
  }
}
