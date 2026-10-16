// A single animated animal or person: skinned glb instance + AnimationMixer + cross-faded clip playback,
// distance LOD (mesh level and animation update rate) and simple locomotion (moveTo / follow a path).
import * as THREE from 'three/webgpu';
import { instance, lodLevels, type Template } from './loader';

export interface CreatureOpts {
  /** deterministic variation seed (scale jitter, clip phase, playback rate) */
  seed?: number;
  /** extra uniform scale on top of the real-world size (default random ±4%) */
  scale?: number;
  /** clip to start with (default Idle) */
  clip?: string;
  /** ground height sampler (world x,z -> y) used while walking */
  ground?: (x: number, z: number) => number;
}

/** LOD switch distances in metres (mesh LOD1 beyond [0], LOD2 beyond [1]); animation updates thin out beyond [1]. */
export const LIFE_LOD: [number, number] = [28, 70];
/** Beyond this distance (m) mixers stop updating entirely. */
export const LIFE_FREEZE = 200;
const _v = new THREE.Vector3();

export function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Creature {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Record<string, THREE.AnimationAction> = {};
  readonly walkSpeed: number;
  readonly height: number;
  current = '';
  /** desired ground speed while walking (m/s); the Walk clip's timeScale is matched to it */
  speed: number;
  private levels: THREE.Object3D[][];
  private lod = -1;
  private accum = 0;
  private target: THREE.Vector3 | null = null;
  private onArrive: (() => void) | null = null;
  private yaw = 0;
  private yawVel = 0;
  private vel = 0;
  private turnTarget: number | null = null;
  ground?: (x: number, z: number) => number;
  readonly rnd: () => number;

  readonly kind: string;
  constructor(kind: string, t: Template, o: CreatureOpts = {}) {
    this.kind = kind;
    this.rnd = rand(o.seed ?? Math.floor(Math.random() * 1e9));
    this.model = instance(t);
    const s = o.scale ?? 0.96 + this.rnd() * 0.08;
    this.model.scale.setScalar(s);
    this.root.add(this.model);
    this.root.name = kind;
    this.walkSpeed = t.walkSpeed * s;
    this.speed = this.walkSpeed;
    this.height = t.height * s;
    this.ground = o.ground;
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of t.clips) {
      const a = this.mixer.clipAction(c);
      a.enabled = true;
      this.actions[c.name] = a;
    }
    this.levels = lodLevels(this.model);
    this.setLOD(0);
    this.play(o.clip ?? 'Idle', 0);
    // desynchronise herds/crowds
    const a = this.actions[this.current];
    if (a) a.time = this.rnd() * a.getClip().duration;
  }

  /** Cross-fade to a clip by name (Idle, Walk, Graze, Talk, Stomp ...). Unknown names fall back to Idle. */
  play(name: string, fade = 0.45): void {
    if (!this.actions[name]) name = this.actions.Idle ? 'Idle' : Object.keys(this.actions)[0];
    if (name === this.current) return;
    const next = this.actions[name];
    const prev = this.actions[this.current];
    next.reset();
    next.setEffectiveWeight(1);
    next.timeScale = name === 'Walk' ? Math.max(0.35, this.vel / this.walkSpeed) : 0.92 + this.rnd() * 0.16;
    next.play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  /** Walk to a world position (y from the ground sampler), then call `done`. */
  moveTo(p: THREE.Vector3, done?: () => void, speed?: number): void {
    this.target = p.clone();
    this.onArrive = done ?? null;
    if (speed) this.speed = speed;
    this.turnTarget = null;
    this.play('Walk');
    const a = this.actions.Walk;
    if (a) a.timeScale = Math.max(0.35, this.vel / this.walkSpeed);
  }

  stop(clip = 'Idle'): void {
    this.target = null;
    this.play(clip);
  }

  get walking(): boolean {
    return this.target !== null;
  }

  private setLOD(l: number) {
    if (l === this.lod) return;
    this.lod = l;
    // fall back to the nearest existing level (people LOD0 is several meshes; some assets have fewer levels)
    let use = l;
    while (use > 0 && !this.levels[use].length) use--;
    this.levels.forEach((ms, i) => ms.forEach((m) => (m.visible = i === use)));
  }

  update(dt: number, camera?: THREE.Camera | null, frustum?: THREE.Frustum | null): void {
    // distance LOD
    let d = 0;
    if (camera) {
      d = camera.getWorldPosition(_v).distanceTo(this.root.getWorldPosition(new THREE.Vector3()));
      this.setLOD(d > LIFE_LOD[1] ? 2 : d > LIFE_LOD[0] ? 1 : 0);
    }
    // locomotion: eased heading (smoothed angular velocity), ramped ground speed, Walk clip rate matched to the
    // actual ground speed every frame so feet never skate (also while turning, starting and stopping)
    const walk = this.actions.Walk;
    if (this.target) {
      const pos = this.root.position;
      const dx = this.target.x - pos.x;
      const dz = this.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      let dy = Math.atan2(dx, dz) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      // arrive: close enough, or the target is beside/behind us within a step (don't orbit it)
      if (dist < 0.12 || (dist < 0.5 && Math.abs(dy) > 1.2)) {
        this.target = null;
        this.vel = 0;
        this.yawVel = 0;
        const cb = this.onArrive;
        this.onArrive = null;
        if (cb) cb();
        else this.play('Idle');
      } else {
        // critically damped turn toward the target heading (people ~1.2 rad/s max, gentle in/out)
        const k = 3.2;
        const accel = k * k * dy - 2 * k * this.yawVel;
        this.yawVel += accel * dt;
        const maxTurn = 1.4;
        this.yawVel = Math.max(-maxTurn, Math.min(maxTurn, this.yawVel));
        this.yaw += this.yawVel * dt;
        // slow down for sharp turns and on the final approach; ramp speed up/down smoothly
        const align = Math.max(0, Math.cos(dy));
        const approach = Math.min(1, dist / 0.9);
        const want = this.speed * (0.25 + 0.75 * align * align) * (0.45 + 0.55 * approach);
        this.vel += (want - this.vel) * Math.min(1, dt * 3);
        const step = Math.min(dist, this.vel * dt);
        pos.x += Math.sin(this.yaw) * step;
        pos.z += Math.cos(this.yaw) * step;
        if (this.ground) pos.y = this.ground(pos.x, pos.z);
        this.root.rotation.y = this.yaw;
        if (walk) walk.timeScale = Math.max(0.35, this.vel / this.walkSpeed);
      }
    } else if (this.turnTarget !== null) {
      // in-place turn (to face a conversation partner): ease, then stop
      let dy = this.turnTarget - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const step = Math.sign(dy) * Math.min(Math.abs(dy), dt * (0.4 + 1.6 * Math.min(1, Math.abs(dy))));
      this.yaw += step;
      this.root.rotation.y = this.yaw;
      if (Math.abs(dy) < 0.01) this.turnTarget = null;
    }
    // animation: every on-screen creature ticks every frame (mixed cadences read as slow motion next to full-rate
    // actors); frozen only when off-screen or beyond LIFE_FREEZE (pose resumes where it left off)
    this.accum += dt;
    if (d > LIFE_FREEZE || (frustum && !frustum.intersectsSphere(this.bounds()))) {
      this.accum = Math.min(this.accum, 0.1);
      return;
    }
    this.mixer.update(this.accum);
    this.accum = 0;
  }

  private _sphere = new THREE.Sphere();
  private bounds(): THREE.Sphere {
    this.root.getWorldPosition(this._sphere.center);
    this._sphere.center.y += this.height * 0.5;
    this._sphere.radius = Math.max(1, this.height);
    return this._sphere;
  }

  /** Smoothly turn in place to a heading (radians about +Y; 0 = +Z). */
  turnTo(yaw: number): void {
    this.turnTarget = yaw;
  }

  /** Face a heading (radians about +Y; 0 = +Z). */
  face(yaw: number): void {
    this.turnTarget = null;
    this.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
