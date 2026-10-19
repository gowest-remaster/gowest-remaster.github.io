// Phone (low-memory) precipitation: one full-screen quad per effect, drawn in clip space over the frame. No
// particle systems, no per-drop geometry and no extra passes: each effect is a handful of hashed grid layers in
// the fragment shader, so its cost is one screen fill at the capped (DPR 1) resolution, and nothing when it's off.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, int, ivec2, uniform, uv, positionGeometry, smoothstep, sin, abs, fract, floor, max } from 'three/tsl';
import { hash2i, tnoise, uTime, uLightning } from '../engine/tsl';

type N = any;

/** streaks falling down a grid of tall cells: `cols` across the screen height, a `fill` share of cells lit */
function streaks(p: N, seed: number, cols: number, tall: number, speed: number, width: number, len: number, fill: N): N {
  const g = vec2(p.x.mul(cols), p.y.mul(cols / tall).add(uTime.mul(speed)));
  const c = floor(g);
  const f = fract(g);
  const ci = ivec2(int(c.x), int(c.y).add(seed * 7919));
  const on = hash2i(ci).lessThan(fill);
  const x = hash2i(ivec2(int(c.y), int(c.x).add(seed * 104729))).mul(0.7).add(0.15);
  const y0 = hash2i(ivec2(int(c.x).add(31), int(c.y).add(seed))).mul(1 - len);
  const along = f.y.sub(y0).div(len);
  const body = smoothstep(0, 0.35, along).mul(smoothstep(1, 0.7, along));
  const s = smoothstep(width, 0, abs(f.x.sub(x))).mul(body);
  return on.select(s, float(0));
}

/** round flakes drifting down square cells, each wobbling on its own phase */
function flakes(p: N, seed: number, cols: number, speed: number, drift: N, size: number, fill: N): N {
  const g = vec2(p.x.mul(cols).add(uTime.mul(drift)), p.y.mul(cols).add(uTime.mul(speed)));
  const c = floor(g);
  const f = fract(g);
  const ci = ivec2(int(c.x), int(c.y).add(seed * 7919));
  const h = hash2i(ci);
  const on = h.lessThan(fill);
  const cx = hash2i(ivec2(int(c.y), int(c.x).add(seed * 104729))).mul(0.5).add(0.25).add(sin(uTime.mul(h.mul(1.5).add(0.8)).add(h.mul(40))).mul(0.18));
  const cy = hash2i(ivec2(int(c.x).add(17), int(c.y).add(seed))).mul(0.5).add(0.25);
  const d = vec2(f.x.sub(cx), f.y.sub(cy)).length();
  return on.select(smoothstep(size, size * 0.25, d), float(0));
}

export class ScreenWeather {
  group = new THREE.Group();
  readonly uRain = uniform(0);
  readonly uSnow = uniform(0);
  readonly uHail = uniform(0);
  readonly uDust = uniform(0);
  private uAspect = uniform(16 / 9);
  private uSlant = uniform(0.1);
  private meshes: Record<'rain' | 'snow' | 'hail' | 'dust', THREE.Mesh>;

  constructor(light: N) {
    const screen = (): N => {
      const u = uv();
      // aspect-correct, wind-slanted screen space (the slant leans the streaks the way the wind blows)
      return vec2(u.x.mul(this.uAspect).add(u.y.mul(this.uSlant)), u.y);
    };
    const make = (color: N, alpha: N): THREE.Mesh => {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.NormalBlending, toneMapped: false, fog: false });
      m.vertexNode = vec4(positionGeometry.xy, 0, 1);
      m.colorNode = color;
      m.opacityNode = alpha;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 50;
      mesh.visible = false;
      mesh.raycast = () => {};
      this.group.add(mesh);
      return mesh;
    };
    const flash = vec3(0.7, 0.75, 0.9).mul(uLightning).mul(2);
    const rainA = Fn(() => {
      const p = screen();
      const fill = this.uRain.mul(0.45);
      const a = streaks(p, 1, 70, 9, 2.6, 0.05, 0.6, fill).mul(0.55)
        .add(streaks(p.mul(1.37).add(0.31), 2, 70, 9, 2.1, 0.05, 0.5, fill).mul(0.35))
        .add(streaks(p.mul(0.61).add(0.77), 3, 70, 9, 3.4, 0.04, 0.7, fill.mul(0.6)).mul(0.8));
      return a.mul(0.32).mul(this.uRain.min(1).mul(0.6).add(0.4));
    })();
    const hailA = Fn(() => {
      const p = screen();
      const fill = this.uHail.mul(0.35);
      const a = streaks(p, 11, 34, 4, 3.6, 0.12, 0.45, fill).add(streaks(p.mul(1.5).add(0.5), 12, 34, 4, 3.0, 0.12, 0.4, fill).mul(0.6));
      return a.mul(0.75);
    })();
    const snowA = Fn(() => {
      const p = screen();
      const fill = this.uSnow.mul(0.5);
      const drift = this.uSlant.mul(1.5);
      const a = max(flakes(p, 21, 26, 0.16, drift, 0.09, fill), flakes(p.mul(1.6).add(0.4), 22, 26, 0.12, drift.mul(0.8), 0.07, fill).mul(0.7));
      return max(a, flakes(p.mul(0.7).add(0.2), 23, 26, 0.22, drift.mul(1.3), 0.11, fill.mul(0.5))).mul(0.85);
    })();
    const dustA = Fn(() => {
      const u = uv();
      const p = vec2(u.x.mul(this.uAspect), u.y);
      const n = tnoise(p.mul(6).add(vec2(uTime.mul(0.35), 0))).mul(0.6).add(tnoise(p.mul(15).add(vec2(uTime.mul(0.9), uTime.mul(0.1)))).mul(0.4));
      // heavier near the ground (the bottom of the frame), streaky with the wind
      return smoothstep(0.35, 0.8, n).mul(smoothstep(1.0, 0.15, u.y)).mul(this.uDust).mul(0.5);
    })();
    this.meshes = {
      rain: make(light.mul(1.9).add(flash), rainA),
      hail: make(vec3(0.92, 0.95, 1.0).mul(light.mul(0.8).add(0.55)), hailA),
      snow: make(light.mul(1.4).add(0.12), snowA),
      dust: make(vec3(0.58, 0.46, 0.32).mul(light.mul(0.6).add(0.55)), dustA),
    };
  }

  update(cam: THREE.Camera, rain: number, snow: number, hail: number, dust: number, windSlant: number): void {
    this.uAspect.value = (cam as THREE.PerspectiveCamera).aspect || 16 / 9;
    this.uSlant.value = windSlant;
    this.uRain.value = rain;
    this.uSnow.value = snow;
    this.uHail.value = hail;
    this.uDust.value = dust;
    this.meshes.rain.visible = rain > 0.01;
    this.meshes.snow.visible = snow > 0.01;
    this.meshes.hail.visible = hail > 0.01;
    this.meshes.dust.visible = dust > 0.01;
  }
}
