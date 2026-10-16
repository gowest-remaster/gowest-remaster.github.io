// Homestead kit: windmills + stock tank.
//  - Halladay Standard (wooden sectional wheel, wooden tower) for years before 1888
//  - Aermotor (galvanized steel wheel + angle-iron tower) from 1888
// Assets: public/world/assets/homestead/windmill_{halladay,aermotor}.glb, stock_tank.glb
// (authored in tools/blender/homestead/windmill.py). Metres, +Y up, tower centred on the origin at ground level.
import * as THREE from 'three/webgpu';
import { float, vec3, positionWorld, sin, normalMap, vec2 } from 'three/tsl';
import { loadGLB, byName } from './loader';
import { uTime, weatherRough } from '../../engine/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export type WindmillEra = 'halladay' | 'aermotor';

export interface WindmillRig {
  root: THREE.Object3D;
  /** yaws about +Y toward the wind (origin on the yaw axis at the tower top) */
  head: THREE.Object3D;
  /** spins about its local +Z (the shaft; origin at the hub) */
  wheel: THREE.Object3D;
  /** furls about the head's yaw axis in storms */
  tail: THREE.Object3D;
  /** strokes up/down with the crank */
  pumpRod: THREE.Object3D | undefined;
  /** current wheel speed in rad/s (read-only) */
  readonly omega: number;
  /**
   * Advance the animation.
   * @param dt seconds
   * @param wind 0..1 (the engine's uWind; ~0.35 is a breeze, 1 a gale)
   * @param windDirRad direction the wind blows TOWARD, as atan2(z, x) in world XZ (uWindDir = (cos, sin))
   */
  update(dt: number, wind: number, windDirRad: number): void;
}

const SPEC: Record<WindmillEra, { radius: number; gear: number; furlAt: number; inertia: number }> = {
  // Halladay: big slow 3.6 m wheel, sections feather (self-governing) in high wind
  halladay: { radius: 1.8, gear: 1, furlAt: 0.75, inertia: 0.45 },
  // Aermotor: 2.5 m steel wheel, back-geared 3.3:1 so the pump strokes slower than the wheel turns
  aermotor: { radius: 1.25, gear: 3.3, furlAt: 0.82, inertia: 0.8 },
};

/** Load a windmill rig. Place `root` at the windmill site (e.g. WINDMILL in env/layout.ts) and call update() per frame. */
export async function loadWindmill(era: WindmillEra): Promise<WindmillRig> {
  const root = await loadGLB(`windmill_${era}`, [60, 170]);
  const head = byName(root, 'Head')!;
  const wheel = byName(root, 'Wheel')!;
  const tail = byName(root, 'Tail')!;
  const pumpRod = byName(root, 'PumpRod');
  const rod0 = pumpRod ? pumpRod.position.y : 0;
  const s = SPEC[era];
  let yaw = head.rotation.y;
  let yawVel = 0;
  let angle = 0;
  let omega = 0;
  let furl = 0;
  let t = Math.random() * 100;
  const rig: WindmillRig = {
    root,
    head,
    wheel,
    tail,
    pumpRod,
    get omega() {
      return omega;
    },
    update(dt: number, wind: number, windDirRad: number) {
      t += dt;
      dt = Math.min(dt, 0.1);
      const gust = 0.5 + 0.3 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);
      const speed = 1.2 + wind * 13 + gust * (1.5 + wind * 5); // m/s at hub height
      // storms: the Aermotor folds its wheel edge-on to the tail; the Halladay feathers its sections (modelled as furl too)
      const furlT = THREE.MathUtils.smoothstep(wind, s.furlAt, s.furlAt + 0.15) * 1.2;
      furl += (furlT - furl) * Math.min(1, dt * 0.8);
      const eff = Math.cos(furl);
      const target = Math.max(0, (speed * eff * 0.95) / s.radius - 0.7);
      omega += (target - omega) * Math.min(1, dt * s.inertia);
      angle += omega * dt;
      wheel.rotation.z = -angle;
      // wheel faces upwind: local +Z must point against the wind; damped spring with a little hunting
      const wx = Math.cos(windDirRad);
      const wz = Math.sin(windDirRad);
      const goal = Math.atan2(-wx, -wz) + Math.sin(t * 0.7) * 0.04 * (1 + wind) + (gust - 0.5) * 0.06;
      let d = goal - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yawVel += (d * 2.6 - yawVel * 2.0) * dt;
      yaw += yawVel * dt;
      head.rotation.y = yaw + furl;
      tail.rotation.y = -furl;
      if (pumpRod) pumpRod.position.y = rod0 + Math.sin(angle / s.gear) * 0.06;
    },
  };
  return rig;
}

let waterMat: THREE.MeshPhysicalNodeMaterial | null = null;
function stockWater(): THREE.MeshPhysicalNodeMaterial {
  if (waterMat) return waterMat;
  const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x18201a, roughness: 0.05, metalness: 0, ior: 1.33 });
  m.name = 'Water';
  // slow wind ripples: perturb the normal with two travelling sine fields
  const p: N = positionWorld.xz;
  const rx: N = sin(p.x.mul(9).add(uTime.mul(1.7))).mul(sin(p.y.mul(7).sub(uTime.mul(1.3))));
  const ry: N = sin(p.y.mul(11).add(uTime.mul(1.1))).mul(sin(p.x.mul(6).add(uTime.mul(0.9))));
  m.normalNode = normalMap(vec3(rx.mul(0.06).add(0.5), ry.mul(0.06).add(0.5), float(1)), vec2(1, 1));
  m.roughnessNode = weatherRough(float(0.05), {});
  waterMat = m;
  return m;
}

export type TankKind = 'wood' | 'galv';
/** Round stock tank (wooden staves 1880s, galvanized corrugated 1890s+), 2.4-2.5 m across, with water. */
export async function loadStockTank(kind: TankKind = 'wood'): Promise<THREE.Object3D> {
  const all = await loadGLB('stock_tank');
  const keep = kind === 'wood' ? 'Tank_wood' : 'Tank_galv';
  const drop = kind === 'wood' ? 'Tank_galv' : 'Tank_wood';
  byName(all, drop)?.removeFromParent();
  all.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && /^Water/.test(m.name)) {
      m.material = stockWater();
      m.castShadow = false;
    }
  });
  all.name = keep;
  return all;
}

async function demo(era: WindmillEra): Promise<THREE.Object3D> {
  const rig = await loadWindmill(era);
  const g = new THREE.Group();
  g.add(rig.root);
  const tank = await loadStockTank(era === 'aermotor' ? 'galv' : 'wood');
  tank.position.set(3.4, 0, 2.6);
  g.add(tank);
  // face the camera's default view and spin in lookdev
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    rig.update((now - last) / 1000, 0.45, Math.atan2(-0.8, -0.6));
    last = now;
    requestAnimationFrame(tick);
  };
  rig.update(0.016, 0.45, Math.atan2(-0.8, -0.6));
  requestAnimationFrame(tick);
  return g;
}

/** Items reviewable in lookdev.html?kit=homestead&item=<name> */
export const lookdev: Record<string, () => Promise<THREE.Object3D>> = {
  windmill_halladay: () => demo('halladay'),
  windmill_aermotor: () => demo('aermotor'),
  stock_tank: async () => {
    const g = new THREE.Group();
    const a = await loadStockTank('wood');
    const b = await loadStockTank('galv');
    a.position.x = -1.5;
    b.position.x = 1.5;
    g.add(a, b);
    return g;
  },
};
