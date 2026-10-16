// Disaster cinematics over the plated views. Each one plays at a fixed gameplay camera (placeFor: the world
// dissolves there first), overrides the weather / lighting (the plate follows with its lighting key), animates GPU
// particle effects composited against the plate's depth, and reports progress so the squares scorch / strip.
import * as THREE from 'three/webgpu';
import { float, vec2, vec3, uniform, smoothstep, sin, cos, mix, fract, positionWorld, normalize, transformNormalToView } from 'three/tsl';
import type { DisasterKind, Place } from '../api';
import { terrainH, tnoise, uTime } from '../engine/tsl';
import { particles } from '../engine/particles';
import { BARN, FIELD, FIELD_D, HOME, squareCenter, terrainHeight } from '../env/layout';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const V3 = vec3 as N;

export interface DisasterHost {
  /** temporary environment override (null clears) */
  envOverride(o: Partial<{ weather: 'clear' | 'overcast' | 'rain' | 'storm' | 'snow'; drought: number; snow: number; wind: number; hour: number; darken: number }> | null): void;
  /** square indices currently in play */
  squares(): number;
  /** set a square's visual stage (index into tsl STAGES) */
  setSquareStage(i: number, stage: number): void;
}

export class Disasters {
  group = new THREE.Group();
  private host: DisasterHost;
  private active: { kind: DisasterKind; t: number; dur: number; resolve: () => void; tick: (t: number) => void; end: () => void } | null = null;
  private fx: Record<string, { mesh: THREE.Mesh; uT: N }> = {};
  private uFront = uniform(0); // fire front position (m along the field)
  private uCenter = uniform(new THREE.Vector3());
  private fireLight = new THREE.PointLight(0xff6a20, 0, 260, 1.5);
  private flood: THREE.Mesh;
  private uFloodLevel = uniform(-6);

  constructor(host: DisasterHost) {
    this.host = host;
    const fieldX0 = FIELD.x0;
    const fieldW = 2 * (FIELD.square + FIELD.gap);
    // ---- fire: a line of flames sweeping north->south across the field, smoke above, embers
    this.fx.flames = particles(9000, (_id, r, t) => {
      const x = float(fieldX0 - 40).add(r[0].mul(fieldW + 80));
      // a ragged front: tongues run ahead, some stretches burn low or gutter out
      const band = tnoise(vec2(x.mul(0.035), t.mul(0.15)));
      const tongue = tnoise(vec2(x.mul(0.11), t.mul(0.4).add(7)));
      const zf = float(FIELD.z0 - FIELD_D).add(this.uFront).add(band.sub(0.5).mul(16)).add(tongue.sub(0.5).mul(5));
      const depth = r[1].mul(r[1]).mul(14);
      const z = zf.sub(depth);
      const heat = smoothstep(0.18, 0.75, band.mul(0.7).add(tongue.mul(0.5)));
      const life = fract(t.mul(r[2].mul(0.8).add(0.7)).add(r[3]));
      const y = terrainH(vec2(x, z)).add(life.mul(r[2].mul(5).add(1.5)).mul(heat.mul(1.4).add(0.3)));
      const flick = tnoise(vec2(x.mul(0.3), t.mul(3))).mul(0.6).add(0.4);
      const size = float(1).sub(life).mul(5).add(1.5).mul(flick).mul(heat.mul(0.9).add(0.25)).mul(float(1).sub(depth.div(16)));
      const col = mix(V3(5.5, 2.0, 0.4), V3(1.4, 0.22, 0.04), life).mul(heat.mul(0.8).add(0.35));
      return { pos: V3(x, y, z), size, alpha: float(1).sub(life).mul(0.75).mul(heat.mul(0.8).add(0.2)), color: col };
    }, true);
    this.fx.smoke = particles(2500, (_id, r, t) => {
      const life = fract(t.mul(0.12).add(r[3]));
      const x0 = float(fieldX0 - 40).add(r[0].mul(fieldW + 80));
      // billowing columns that lean downwind and merge into a brown-grey pall
      const col = tnoise(vec2(x0.mul(0.03), t.mul(0.05)));
      const x = x0.add(life.mul(70));
      const z = float(FIELD.z0 - FIELD_D).add(this.uFront).sub(r[1].mul(24)).add(life.mul(-24));
      const y = terrainH(vec2(x, z)).add(life.mul(life.mul(40).add(90))).add(3);
      const size = life.mul(80).add(8);
      const dens = smoothstep(0.2, 0.8, col).mul(0.75).add(0.25);
      const lowLit = float(1).sub(smoothstep(0.0, 0.25, life));
      const c = mix(V3(0.2, 0.17, 0.14), V3(0.12, 0.105, 0.095), life).add(V3(0.9, 0.35, 0.08).mul(lowLit).mul(0.6));
      return { pos: V3(x, y, z), size, alpha: float(1).sub(life).mul(smoothstep(0, 0.12, life)).mul(0.42).mul(dens), color: c };
    }, false);
    // ---- tornado funnel: dust ring spiralling up a leaning cone, debris flung outward
    this.fx.funnel = particles(14000, (_id, r, t) => {
      const h = r[0];
      const y = h.mul(h).mul(420);
      const rad = h.mul(h).mul(70).add(6).add(sin(t.mul(2).add(h.mul(9))).mul(2));
      const ang = r[1].mul(6.283).add(t.mul(float(3.5).sub(h.mul(2))));
      const lean = V3(sin(t.mul(0.4).add(h.mul(3))).mul(h.mul(25)), 0, h.mul(-40));
      const c = V3(this.uCenter).add(lean);
      const pos = V3(c.x.add(cos(ang).mul(rad)), terrainH(c.xz).add(y), c.z.add(sin(ang).mul(rad)));
      const size = h.mul(24).add(5);
      const n = tnoise(vec2(ang.mul(3), h.mul(40).sub(t.mul(2))));
      return { pos, size: size.mul(n.mul(0.8).add(0.5)), alpha: float(0.07).mul(float(1).sub(h.mul(0.5))).mul(n.mul(1.4).add(0.2)), color: mix(V3(0.08, 0.07, 0.06), V3(0.3, 0.28, 0.26), h.mul(0.7).add(n.mul(0.3))) };
    }, false);
    this.fx.debris = particles(1200, (_id, r, t) => {
      const life = fract(t.mul(0.35).add(r[3]));
      const ang = r[1].mul(6.283).add(t.mul(4));
      const rad = life.mul(40).add(8);
      const c = V3(this.uCenter);
      const pos = V3(c.x.add(cos(ang).mul(rad)), terrainH(c.xz).add(life.mul(60)).add(r[0].mul(8)), c.z.add(sin(ang).mul(rad)));
      return { pos, size: r[2].mul(0.8).add(0.2), alpha: float(0.9), color: V3(0.06, 0.05, 0.04) };
    }, false);
    // ---- grasshoppers: a dense humming swarm sweeping over the crops
    this.fx.hoppers = particles(30000, (_id, r, t) => {
      const base = V3(float(FIELD.x0 + 140).add(r[0].sub(0.5).mul(160)), 0, float(FIELD.z0 - 40).add(r[1].sub(0.5).mul(120)));
      const hop = fract(t.mul(r[2].mul(0.8).add(0.6)).add(r[3]));
      const drift = V3(t.mul(-6), 0, t.mul(4));
      const p = base.add(drift).add(V3(sin(t.mul(3).add(r[3].mul(30))).mul(1.5), 0, cos(t.mul(2.6).add(r[2].mul(30))).mul(1.5)));
      const y = terrainH(p.xz).add(hop.mul(float(1).sub(hop)).mul(r[2].mul(6).add(1))).add(0.3).add(r[3].greaterThan(0.7).select(r[2].mul(14), float(0)));
      return { pos: V3(p.x, y, p.z), size: float(0.22), alpha: float(0.95), color: V3(0.05, 0.045, 0.02) };
    }, false);
    // the swarm overhead: a drifting brown-grey cloud of millions of insects that dims the sun
    this.fx.swarm = particles(6000, (_id, r, t) => {
      const c = V3(float(FIELD.x0 + 110).add(r[0].sub(0.5).mul(260)).add(t.mul(-5)), 0, float(FIELD.z0 - 60).add(r[1].sub(0.5).mul(220)).add(t.mul(3)));
      const swirl = V3(sin(t.mul(0.7).add(r[3].mul(20))).mul(6), 0, cos(t.mul(0.6).add(r[2].mul(20))).mul(6));
      const y = terrainH(c.xz).add(r[2].mul(r[2]).mul(55)).add(4);
      return { pos: c.add(swirl).add(V3(0, y, 0)), size: r[3].mul(5).add(2.5), alpha: float(0.16), color: V3(0.09, 0.08, 0.05) };
    }, false);
    // ---- hail: ice pellets streaking down and bouncing
    this.fx.hail = particles(9000, (_id, r, t) => {
      const life = fract(t.mul(1.1).add(r[3]));
      // over the claim (seen from the field camera, ~300 m away: pellets drawn large enough to read as streaks)
      const p = V3(float(FIELD.x0 + 75).add(r[0].sub(0.5).mul(220)), 0, float(FIELD.z0 - 75).add(r[1].sub(0.5).mul(200)));
      const gy = terrainH(p.xz);
      const y = gy.add(float(1).sub(life).mul(40)).max(gy.add(sin(life.mul(40)).abs().mul(0.3)));
      return { pos: V3(p.x, y, p.z), size: r[2].mul(0.25).add(0.35), alpha: float(0.9), color: V3(1.4, 1.45, 1.5) };
    }, false);
    // ---- drought: dust devils and blowing dust
    this.fx.dust = particles(4000, (_id, r, t) => {
      const life = fract(t.mul(0.15).add(r[3]));
      const cx = float(HOME.x - 60).add(t.mul(8)).add(r[0].mul(20));
      const ang = r[1].mul(6.283).add(t.mul(5));
      const rad = life.mul(10).add(1);
      const pos = V3(cx.add(cos(ang).mul(rad)), terrainH(vec2(cx, -60)).add(life.mul(35)), float(-60).add(sin(ang).mul(rad)));
      return { pos, size: life.mul(6).add(1), alpha: float(1).sub(life).mul(0.25), color: V3(0.42, 0.33, 0.22) };
    }, false);
    for (const f of Object.values(this.fx)) this.group.add(f.mesh);
    this.fireLight.castShadow = false;
    this.group.add(this.fireLight);
    // flood water: muddy standing water spreading over the low ground. Silty brown body, sky reflection from the
    // low roughness, rain rings and wind ripples in the normal, scum and foam where it is shallow
    const water = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.06, metalness: 0, transparent: true });
    const wp = positionWorld.xz;
    const rip = (o: number, f: number, sp: number) => tnoise(wp.mul(f).add(vec2(uTime.mul(sp), uTime.mul(sp * 0.7))).add(o));
    const nx = rip(0, 0.9, 0.35).sub(0.5).mul(0.22).add(rip(3.1, 3.7, 1.1).sub(0.5).mul(0.12));
    const nz = rip(7.3, 0.8, 0.3).sub(0.5).mul(0.22).add(rip(1.7, 4.1, 1.3).sub(0.5).mul(0.12));
    water.normalNode = transformNormalToView(normalize(vec3(nx, 1, nz)));
    const depth = float(this.uFloodLevel).sub(terrainH(wp));
    const silt = tnoise(wp.mul(0.05)).mul(0.25).add(0.75);
    water.colorNode = mix(V3(0.3, 0.25, 0.17), V3(0.13, 0.11, 0.08), smoothstep(0.0, 0.5, depth)).mul(silt);
    // pooled over the claim and the swale around it, fading out well inside the frame of the field camera
    const fc = vec2(FIELD.x0 + FIELD.square + FIELD.gap, FIELD.z0 - FIELD_D / 2);
    const reach = smoothstep(260, 140, wp.sub(fc).length().add(tnoise(wp.mul(0.02)).sub(0.5).mul(70)));
    water.opacityNode = smoothstep(0.0, 0.12, depth).mul(0.94).mul(reach);
    // seen from ~300 m at a grazing angle, a full-strength sky reflection whites the sheet out
    water.specularIntensityNode = float(0.12);
    water.roughnessNode = mix(float(0.4), float(0.12), smoothstep(0.0, 0.3, depth));
    this.flood = new THREE.Mesh(new THREE.PlaneGeometry(560, 560, 1, 1), water);
    this.flood.renderOrder = 2;
    this.flood.rotation.x = -Math.PI / 2;
    this.flood.position.set(FIELD.x0 + FIELD.square + FIELD.gap, -6, FIELD.z0 - FIELD_D / 2);
    this.flood.visible = false;
    this.group.add(this.flood);
  }

  get playing(): boolean {
    return this.active !== null;
  }

  update(t: number, dt: number): void {
    for (const f of Object.values(this.fx)) f.uT.value = t;
    const a = this.active;
    if (!a) return;
    a.t += dt;
    a.tick(Math.min(1, a.t / a.dur));
    if (a.t >= a.dur) this.finish();
  }

  skip(): void {
    if (this.active) {
      this.active.tick(1);
      this.finish();
    }
  }

  private finish(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.end();
    for (const f of Object.values(this.fx)) f.mesh.visible = false;
    this.fireLight.intensity = 0;
    this.flood.visible = false;
    this.host.envOverride(null);
    a.resolve();
  }

  /** the plated view each disaster plays in */
  static placeFor(kind: DisasterKind): Place {
    return kind === 'drought' || kind === 'blizzard' ? 'homestead' : 'field';
  }

  play(kind: DisasterKind): Promise<void> {
    this.skip();
    const h = this.host;
    const n = h.squares();
    const pitch = FIELD.square + FIELD.gap;
    const fieldW = (n > 8 ? 4 : 2) * pitch;
    const fc = new THREE.Vector3(FIELD.x0 + fieldW / 2, 0, FIELD.z0 - FIELD_D / 2);
    let dur = 8;
    let tick: (k: number) => void = () => {};
    let end = () => {};
    switch (kind) {
      case 'fire': {
        dur = 9;
        h.envOverride({ weather: 'clear', hour: 18.6, darken: 0.35, wind: 0.8 });
        this.fx.flames.mesh.visible = this.fx.smoke.mesh.visible = true;
        this.fireLight.intensity = 0;
        const burnt = new Set<number>();
        tick = (k) => {
          const front = k * (FIELD_D + 60) - 20;
          this.uFront.value = front;
          this.fireLight.position.set(fc.x, terrainHeight(fc.x, FIELD.z0 - FIELD_D + front) + 20, FIELD.z0 - FIELD_D + front);
          this.fireLight.intensity = 6000 * Math.sin(Math.min(1, k * 1.2) * Math.PI);
          for (let i = 0; i < n; i++) {
            const row = (i & 7) >> 1;
            const rowZ = FIELD.z0 - row * pitch - FIELD.square * 0.5;
            if (!burnt.has(i) && FIELD.z0 - FIELD_D + front > rowZ) {
              burnt.add(i);
              h.setSquareStage(i, 7);
            }
          }
        };
        end = () => {
          for (let i = 0; i < n; i++) h.setSquareStage(i, 7);
        };
        break;
      }
      case 'tornado': {
        dur = 10;
        h.envOverride({ weather: 'storm', darken: 0.25, wind: 1 });
        this.fx.funnel.mesh.visible = this.fx.debris.mesh.visible = true;
        // the funnel tracks across the claim's squares toward the farmyard, tearing up every square it crosses
        const p0 = new THREE.Vector3(FIELD.x0 + 190, 0, FIELD.z0 - 340);
        const p1 = new THREE.Vector3(BARN.x - 40, 0, BARN.z + 30);
        tick = (k) => {
          const c = this.uCenter.value as THREE.Vector3;
          c.lerpVectors(p0, p1, k);
          for (let i = 0; i < n; i++) {
            const q = squareCenter(i);
            if (Math.hypot(q.x - c.x, q.z - c.z) < FIELD.square * 0.6) h.setSquareStage(i, 1);
          }
        };
        break;
      }
      case 'grasshoppers': {
        dur = 9;
        h.envOverride({ weather: 'overcast', darken: 0.45, hour: 15 });
        this.fx.hoppers.mesh.visible = true;
        this.fx.swarm.mesh.visible = true;
        tick = (k) => {
          for (let i = 0; i < n; i++) if (k > 0.3 + (i / n) * 0.6) h.setSquareStage(i, 1);
        };
        break;
      }
      case 'drought': {
        dur = 8;
        this.fx.dust.mesh.visible = true;
        tick = (k) => h.envOverride({ weather: 'clear', hour: 14, drought: Math.min(1, k * 1.6), wind: 0.5 });
        break;
      }
      case 'hail': {
        dur = 7;
        h.envOverride({ weather: 'storm', darken: 0.15, wind: 0.8 });
        this.fx.hail.mesh.visible = true;
        tick = (k) => {
          for (let i = 0; i < n; i++) if (k > 0.35 + (i / n) * 0.4) h.setSquareStage(i, 1);
        };
        break;
      }
      case 'blizzard': {
        dur = 8;
        tick = (k) => h.envOverride({ weather: 'snow', snow: Math.min(1, 0.3 + k), wind: 1, darken: 0.2 });
        break;
      }
      case 'flood': {
        dur = 8;
        h.envOverride({ weather: 'rain', wind: 0.6 });
        this.flood.visible = true;
        // low, from beside the barn across the drowning squares
        tick = (k) => {
          const y = THREE.MathUtils.lerp(-1.2, -0.12, Math.min(1, k * 1.3));
          this.flood.position.y = y;
          this.uFloodLevel.value = y;
        };
        break;
      }
    }
    return new Promise((resolve) => {
      this.active = { kind, t: 0, dur, resolve, tick, end };
    });
  }
}
