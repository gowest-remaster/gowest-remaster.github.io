// Herds and flocks: N animals wandering inside an area with species-specific behaviour
// (cattle/horses graze most of the time and drift together; pigs root; chickens peck and dart; the dog patrols).
import * as THREE from 'three/webgpu';
import { Creature, rand } from './creature';

export type Area =
  | { center: THREE.Vector3 | { x: number; z: number }; radius: number }
  | { x0: number; z0: number; x1: number; z1: number }
  | { polygon: { x: number; z: number }[] };

export function areaSampler(a: Area, r: () => number): () => THREE.Vector3 {
  if ('radius' in a) {
    return () => {
      const t = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * a.radius;
      return new THREE.Vector3(a.center.x + Math.cos(t) * d, 0, a.center.z + Math.sin(t) * d);
    };
  }
  if ('polygon' in a) {
    const P = a.polygon;
    const xs = P.map((p) => p.x);
    const zs = P.map((p) => p.z);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if (P[i].z > z !== P[j].z > z && x < ((P[j].x - P[i].x) * (z - P[i].z)) / (P[j].z - P[i].z) + P[i].x) c = !c;
      }
      return c;
    };
    return () => {
      for (let k = 0; k < 40; k++) {
        const x = x0 + r() * (x1 - x0);
        const z = z0 + r() * (z1 - z0);
        if (inside(x, z)) return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    };
  }
  return () => new THREE.Vector3(a.x0 + r() * (a.x1 - a.x0), 0, a.z0 + r() * (a.z1 - a.z0));
}

interface Behaviour {
  graze: [number, number]; // seconds
  idle: [number, number];
  walk: [number, number]; // metres per leg
  pGraze: number; // chance to graze (vs idle) after arriving
  pWalk: number; // chance to walk after a graze/idle bout
  cohesion: number; // 0..1 pull toward the herd centre when choosing a target
  extra?: string; // occasional extra clip (Stomp for horses)
  speed?: [number, number]; // walk speed multiplier range
}
const BEHAVIOUR: Record<string, Behaviour> = {
  cattle: { graze: [12, 40], idle: [4, 12], walk: [2, 9], pGraze: 0.75, pWalk: 0.35, cohesion: 0.55, speed: [0.75, 1.0] },
  horse: { graze: [10, 30], idle: [4, 10], walk: [3, 12], pGraze: 0.65, pWalk: 0.4, cohesion: 0.5, extra: 'Stomp', speed: [0.8, 1.05] },
  pig: { graze: [6, 20], idle: [3, 8], walk: [1.5, 6], pGraze: 0.7, pWalk: 0.5, cohesion: 0.35, speed: [0.8, 1.1] },
  chicken: { graze: [2, 7], idle: [1, 4], walk: [0.4, 2.5], pGraze: 0.75, pWalk: 0.7, cohesion: 0.25, speed: [0.8, 1.3] },
  dog: { graze: [3, 8], idle: [4, 14], walk: [3, 15], pGraze: 0.3, pWalk: 0.55, cohesion: 0.0, speed: [0.9, 1.2] },
};
export function behaviourOf(kind: string): Behaviour {
  if (kind.startsWith('cow') || kind.startsWith('ox')) return BEHAVIOUR.cattle;
  if (kind.startsWith('horse') || kind === 'mule') return BEHAVIOUR.horse;
  if (kind.startsWith('pig')) return BEHAVIOUR.pig;
  if (kind === 'hen' || kind === 'rooster' || kind.startsWith('chicken')) return BEHAVIOUR.chicken;
  return BEHAVIOUR.dog;
}

export class Herd {
  readonly root = new THREE.Group();
  readonly members: Creature[] = [];
  private timers: number[] = [];
  private sample: () => THREE.Vector3;
  private r: () => number;
  readonly area: Area;
  readonly ground?: (x: number, z: number) => number;
  constructor(area: Area, seed = 1, ground?: (x: number, z: number) => number) {
    this.area = area;
    this.ground = ground;
    this.r = rand(seed * 7919 + 13);
    this.sample = areaSampler(area, this.r);
    this.root.name = 'herd';
  }

  add(c: Creature, at?: THREE.Vector3): void {
    const p = at ?? this.sample();
    c.root.position.set(p.x, this.ground ? this.ground(p.x, p.z) : p.y, p.z);
    c.ground = this.ground;
    c.face(this.r() * Math.PI * 2);
    this.members.push(c);
    this.timers.push(this.r() * 6);
    this.root.add(c.root);
    const b = behaviourOf(c.kind);
    c.play(this.r() < b.pGraze ? 'Graze' : 'Idle', 0);
  }

  private centre(): THREE.Vector3 {
    const c = new THREE.Vector3();
    for (const m of this.members) c.add(m.root.position);
    return c.multiplyScalar(1 / Math.max(1, this.members.length));
  }

  private decide(i: number) {
    const c = this.members[i];
    const b = behaviourOf(c.kind);
    const r = this.r;
    if (r() < b.pWalk) {
      // pick a nearby point, pulled toward the herd centre, kept inside the area
      const here = c.root.position;
      const cen = this.centre();
      let tgt = new THREE.Vector3();
      for (let k = 0; k < 8; k++) {
        const len = b.walk[0] + r() * (b.walk[1] - b.walk[0]);
        const a = r() * Math.PI * 2;
        tgt.set(here.x + Math.cos(a) * len, 0, here.z + Math.sin(a) * len).lerp(new THREE.Vector3(cen.x, 0, cen.z), b.cohesion * r());
        const inside = this.sample(); // cheap containment: snap to a sampled point if we leave a circular area
        if ('radius' in this.area) {
          const ac = this.area.center;
          if (Math.hypot(tgt.x - ac.x, tgt.z - ac.z) > this.area.radius) tgt = inside;
        } else if ('x0' in this.area) {
          const A = this.area;
          tgt.x = Math.min(Math.max(tgt.x, A.x0), A.x1);
          tgt.z = Math.min(Math.max(tgt.z, A.z0), A.z1);
        } else if (k === 7) tgt = inside;
        // keep a little personal space
        if (this.members.every((m, j) => j === i || m.root.position.distanceTo(tgt) > c.height * 0.9)) break;
      }
      const sp = b.speed ?? [1, 1];
      c.moveTo(tgt, () => this.settle(i), c.walkSpeed * (sp[0] + r() * (sp[1] - sp[0])));
      this.timers[i] = 1e9;
    } else this.settle(i);
  }

  private settle(i: number) {
    const c = this.members[i];
    const b = behaviourOf(c.kind);
    const r = this.r;
    if (b.extra && r() < 0.12) {
      c.play(b.extra, 0.3);
      this.timers[i] = 3;
      return;
    }
    const graze = r() < b.pGraze;
    c.play(graze ? 'Graze' : 'Idle', 0.6);
    const [a0, a1] = graze ? b.graze : b.idle;
    this.timers[i] = a0 + r() * (a1 - a0);
  }

  update(dt: number, camera?: THREE.Camera | null, frustum?: THREE.Frustum | null): void {
    for (let i = 0; i < this.members.length; i++) {
      const c = this.members[i];
      if (!c.walking) {
        this.timers[i] -= dt;
        if (this.timers[i] <= 0) this.decide(i);
      }
      c.update(dt, camera, frustum);
    }
  }

  dispose(): void {
    for (const m of this.members) m.dispose();
    this.root.removeFromParent();
  }
}
