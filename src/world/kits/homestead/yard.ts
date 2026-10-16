// Homestead kit: yard props + farm wagon. All objects in metres, +Y up, front +Z, ground contact at y = 0,
// origin at the footprint centre unless noted. See README.md for placements.
import * as THREE from 'three/webgpu';
import { positionLocal, positionWorld, positionView, sin, vec2, vec3, uv, float, mix, smoothstep, fract, max } from 'three/tsl';
import { uTime, uWind, uWindDir } from '../../engine/tsl';
import { loadGLB, byName } from './loader';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface Wagon {
  root: THREE.Object3D;
  /** Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR: origin on the axle centre, roll by rotating about local X */
  wheels: THREE.Object3D[];
  /** tongue: origin on the hound pin, rotate about local X (negative raises the tip) */
  tongue: THREE.Object3D;
  /** the covered-wagon set (bows, Cloth_Cover, ties, keg, bucket, cargo) */
  cover: THREE.Object3D;
  /** roll the wheels for a ground distance travelled (metres, forward = +Z) */
  roll(distance: number): void;
}

const WHEEL_R: Record<string, number> = { Wheel_FL: 0.513, Wheel_FR: 0.521, Wheel_RL: 0.583, Wheel_RR: 0.585 };

/** Farm wagon (museum photoscan running gear + authored box). ~5.4 m long with tongue, 1.85 m wide, box top 1.83 m;
 * covered: canvas crown at ~2.85 m. Origin on the ground midway between the axles; the tongue points to +Z. */
export async function loadWagon(opts: { covered?: boolean } = {}): Promise<Wagon> {
  const root = await loadGLB('wagon');
  thinShadows(root);
  const wheels = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map((n) => byName(root, n)!);
  const cover = byName(root, 'Covered')!;
  cover.visible = !!opts.covered;
  const base = wheels.map((w) => w.rotation.x);
  return {
    root,
    wheels,
    tongue: byName(root, 'Tongue')!,
    cover,
    roll(distance: number) {
      wheels.forEach((w, i) => {
        w.rotation.x = base[i] + distance / (WHEEL_R[w.name.replace(/[._]\d{3}$/, '')] ?? 0.55);
      });
    },
  };
}

/** Thin cloth (wagon sheet, laundry) acnes badly under the CSM sun when it shadows itself. The visible sheet
 * receives but does not cast; a hidden copy shrunk ~12 cm toward its centre casts the ground/box shadow instead. */
function thinShadows(root: THREE.Object3D, useProxy = true): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && /^Cloth/.test(m.name) && !m.userData.thin) meshes.push(m);
  });
  for (const m of meshes) {
    m.userData.thin = true;
    m.castShadow = false;
    // canvas/cotton scatters light through itself: lift the terminator so wrinkles turning from the sun stay soft
    const mat = (m.material as THREE.MeshStandardNodeMaterial).clone();
    if (mat.colorNode) mat.emissiveNode = (mat.colorNode as any).mul(vec3(0.13, 0.11, 0.07)); // warm light through the duck
    m.material = mat;
    if (!useProxy) {
      // single hanging sheets (laundry): render both faces
      mat.side = THREE.DoubleSide;
      m.castShadow = true;
      continue;
    }
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(m.geometry, shadowOnly);
    proxy.name = m.name + '_shadow';
    const k = (d: number) => Math.max(0.5, 1 - 0.24 / Math.max(d, 0.3));
    proxy.scale.set(k(size.x), k(size.y), k(size.z));
    proxy.position.copy(c).multiply(new THREE.Vector3(1 - proxy.scale.x, 1 - proxy.scale.y, 1 - proxy.scale.z));
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.userData.noPick = true;
    m.add(proxy);
  }
}
const shadowOnly = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });

export type YardProp = 'woodpile' | 'washline' | 'pump' | 'plow' | 'outhouse' | 'coop' | 'garden' | 'mailbox';

/** Laundry sway: each Cloth_* node has its origin on the line (top centre) and hangs down -Y, so the sway weight
 * grows with distance below the origin. Wind comes from the engine uniforms (uWind 0..1, uWindDir, uTime). */
function laundryWind(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !/^Cloth/.test(m.name)) return;
    const mat = m.material as THREE.MeshStandardNodeMaterial;
    const drop: N = positionLocal.y.negate().clamp(0, 1.4).div(1.4);
    const w: N = drop.mul(drop);
    const ph: N = positionWorld.x.mul(1.7).add(positionWorld.z.mul(0.9));
    const gust: N = sin(uTime.mul(0.7).add(ph.mul(0.3))).mul(0.5).add(0.5);
    const amp: N = uWind.mul(0.35).add(0.03).mul(gust.mul(0.7).add(0.3));
    const flap: N = sin(uTime.mul(5.3).add(ph).add(positionLocal.y.mul(4.0))).mul(0.25).add(0.75);
    // displacement in world XZ along the wind, converted to the node's local frame by ignoring its yaw (props are yawed only)
    const yaw = new THREE.Euler().setFromQuaternion(m.getWorldQuaternion(new THREE.Quaternion())).y;
    const c = Math.cos(-yaw);
    const s = Math.sin(-yaw);
    const dx: N = uWindDir.x.mul(c).sub(uWindDir.y.mul(s));
    const dz: N = uWindDir.x.mul(s).add(uWindDir.y.mul(c));
    const off: N = w.mul(amp).mul(flap);
    mat.positionNode = positionLocal.add(vec3(dx.mul(off), off.mul(off).mul(0.6), dz.mul(off)));
  });
}

/** Load one yard prop (each is its own glb, lazy-loaded and cached). Origins/footprints: see README.md. */
export async function loadYardProp(name: YardProp): Promise<THREE.Object3D> {
  const root = await loadGLB(name);
  if (name === 'washline') {
    thinShadows(root, false);
    laundryWind(root);
  }
  if (name === 'mailbox') setMailboxYear(root, 1896);
  if (name === 'coop') {
    const wire = byName(root, 'Wire') as THREE.Mesh | undefined;
    if (wire) wire.material = wireMaterial(wire.material as THREE.Material);
    if (wire) wire.castShadow = false;
  }
  return root;
}

/** Chicken wire without MSAA: alpha-tested hex lines vanish once a strand is thinner than a pixel. Instead blend:
 * up close the hex texture's own alpha; with distance (and in the mip tail) fade to a faint grey haze panel whose
 * opacity matches the wire's real coverage (~22%), so the run stays readable at 25-50 m. */
const wireMats = new Map<THREE.Material, THREE.Material>();
function wireMaterial(src: THREE.Material): THREE.Material {
  const hit = wireMats.get(src);
  if (hit) return hit;
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  m.name = 'Wire';
  // procedural twisted-hex (diamond) mesh in the card UVs (5 tiles/m x 8 cells = 2.5 cm openings)
  const p: N = uv().mul(vec2(8.0, 9.3));
  const d1: N = fract(p.x.add(p.y.mul(0.5))).sub(0.5).abs();
  const d2: N = fract(p.x.sub(p.y.mul(0.5))).sub(0.5).abs();
  const a: N = smoothstep(0.4, 0.46, max(d1, d2));
  const dist: N = positionView.z.negate();
  const far: N = smoothstep(4.0, 18.0, dist);
  m.colorNode = vec3(0.36, 0.36, 0.34);
  m.opacityNode = mix(a.mul(0.9), float(0.22), far);
  m.roughnessNode = float(0.5);
  m.metalnessNode = float(0.6);
  wireMats.set(src, m);
  return m;
}

/** Mailbox variants share the origin: the galvanized RFD box (rural free delivery, from 1896) or a homemade box. */
export function setMailboxYear(mailbox: THREE.Object3D, year: number): void {
  const rfd = byName(mailbox, 'Mailbox_RFD');
  const wood = byName(mailbox, 'Mailbox_wood');
  if (rfd) rfd.visible = year >= 1896;
  if (wood) wood.visible = year < 1896;
}

// ------------------------------------------------------------------------------------------------ field implements

export type ImplementName = 'plow' | 'seeder' | 'binder';

export interface Implement {
  root: THREE.Object3D;
  /** where the evener (doubletree) attaches; Trace_L / Trace_R children of root are the singletree hooks */
  hitch: THREE.Object3D;
  traces: THREE.Object3D[];
  /** front end of the tongue (neck yoke) - seeder, binder */
  tongueTip?: THREE.Object3D;
  /** driver's seat (seeder, binder) or the plow handles (walking plow) */
  seat?: THREE.Object3D;
  wheels: THREE.Object3D[];
  reel?: THREE.Object3D;
  sickle?: THREE.Object3D;
  /** advance moving parts for a ground speed in m/s (forward = +Z) */
  update(dt: number, speedMps: number): void;
}

const WHEEL_RADIUS: Record<string, number> = { Wheel_L: 0.62, Wheel_R: 0.62, Wheel_bull: 0.62, Wheel_grain: 0.32 };

/** Horse-drawn implements, travel direction +Z (team in front). Origin on the ground under the axle / plow body.
 * LOD0/1/2 per part (switch at LOD_DIST). See README.md for anchor positions and team alignment. */
export async function loadImplement(name: ImplementName): Promise<Implement> {
  const root = await loadGLB(`implement_${name}`);
  const get = (n: string) => byName(root, n);
  const wheels = ['Wheel_L', 'Wheel_R', 'Wheel_bull', 'Wheel_grain'].map(get).filter((o): o is THREE.Object3D => !!o);
  const reel = get('Reel');
  const sickle = get('Sickle');
  const sickleX = sickle?.position.x ?? 0;
  let phase = 0;
  return {
    root,
    hitch: get('Hitch')!,
    traces: [get('Trace_L'), get('Trace_R')].filter((o): o is THREE.Object3D => !!o),
    tongueTip: get('Tongue_tip'),
    seat: get('Seat') ?? get('Handles'),
    wheels,
    reel,
    sickle,
    update(dt: number, speedMps: number) {
      const d = speedMps * dt;
      for (const w of wheels) w.rotation.x += d / (WHEEL_RADIUS[w.name.replace(/[._]\d{3}$/, '')] ?? 0.6);
      // reel tip speed ~1.25x ground speed (radius 0.72 m), knife ~7 strokes/s at a walk (1.2 m/s), stroke 76 mm
      if (reel) reel.rotation.x += (d * 1.25) / 0.72;
      if (sickle) {
        phase += dt * Math.PI * 2 * 3.5 * Math.min(1, speedMps / 1.2);
        sickle.position.x = sickleX + Math.sin(phase) * 0.038 * Math.min(1, speedMps * 4);
      }
    },
  };
}

/** Items reviewable in lookdev.html?kit=homestead&item=<name> */
export const lookdev: Record<string, () => Promise<THREE.Object3D>> = {
  wagon: async () => (await loadWagon()).root,
  wagon_covered: async () => (await loadWagon({ covered: true })).root,
  woodpile: () => loadYardProp('woodpile'),
  washline: () => loadYardProp('washline'),
  pump: () => loadYardProp('pump'),
  plow: () => loadYardProp('plow'),
  outhouse: () => loadYardProp('outhouse'),
  coop: () => loadYardProp('coop'),
  garden: () => loadYardProp('garden'),
  mailbox: () => loadYardProp('mailbox'),
  implement_plow: async () => (await loadImplement('plow')).root,
  implement_seeder: async () => (await loadImplement('seeder')).root,
  implement_binder: async () => (await loadImplement('binder')).root,
};
