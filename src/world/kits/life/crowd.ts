// Townsfolk crowd: people walk along given paths (boardwalks, the street, the depot platform) or wander an
// area, pause to stand, and pair up to talk face to face. Distance LOD per person (merged one-draw-call
// atlas meshes beyond LIFE_LOD[0]) and thinned animation updates keep 30-60 people cheap.
import * as THREE from 'three/webgpu';
import { Creature, rand } from './creature';
import { areaSampler, type Area } from './herd';

export type Path = { x: number; z: number }[];

interface Agent {
  c: Creature;
  path: Path | null;
  seg: number; // index of the next path point
  dir: 1 | -1;
  wait: number;
  partner: number;
  turned?: boolean;
  lane: number;
}

export class Crowd {
  readonly root = new THREE.Group();
  readonly members: Creature[] = [];
  private agents: Agent[] = [];
  private r: () => number;
  private sample: (() => THREE.Vector3) | null;
  readonly area: Area | null;
  readonly paths: Path[];
  readonly ground?: (x: number, z: number) => number;
  constructor(area: Area | null, paths: Path[] = [], seed = 1, ground?: (x: number, z: number) => number) {
    this.area = area;
    this.paths = paths;
    this.ground = ground;
    this.r = rand(seed * 104729 + 7);
    this.sample = area ? areaSampler(area, this.r) : null;
    this.root.name = 'crowd';
  }

  private pointOn(path: Path, t: number): THREE.Vector3 {
    const n = path.length - 1;
    const f = Math.min(n - 1e-6, t * n);
    const i = Math.floor(f);
    const u = f - i;
    return new THREE.Vector3(path[i].x + (path[i + 1].x - path[i].x) * u, 0, path[i].z + (path[i + 1].z - path[i].z) * u);
  }

  add(c: Creature): void {
    const r = this.r;
    const path = this.paths.length ? this.paths[Math.floor(r() * this.paths.length)] : null;
    let p: THREE.Vector3;
    let seg = 0;
    const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
    if (path && path.length > 1) {
      const t = r();
      p = this.pointOn(path, t);
      // lateral offset so walkers don't share one line
      const i = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
      const tx = path[i + 1].x - path[i].x;
      const tz = path[i + 1].z - path[i].z;
      const l = Math.hypot(tx, tz) || 1;
      const off = (r() - 0.5) * 1.2;
      p.x += (-tz / l) * off;
      p.z += (tx / l) * off;
      seg = dir === 1 ? i + 1 : i;
    } else p = this.sample ? this.sample() : new THREE.Vector3();
    c.root.position.set(p.x, this.ground ? this.ground(p.x, p.z) : 0, p.z);
    c.ground = this.ground;
    c.face(r() * Math.PI * 2);
    this.members.push(c);
    this.agents.push({ c, path, seg, dir, wait: r() * 4, partner: -1, lane: (r() - 0.5) * 1.2 });
    this.root.add(c.root);
  }

  private next(i: number) {
    const a = this.agents[i];
    const r = this.r;
    const c = a.c;
    // pause: stand, or talk with someone close by who is also standing
    if (r() < 0.35) {
      const j = this.agents.findIndex((b, k) => k !== i && b.partner < 0 && !b.c.walking && b.c.root.position.distanceTo(c.root.position) < 4);
      if (j >= 0 && r() < 0.6) {
        const b = this.agents[j];
        a.partner = j;
        b.partner = i;
        const pa = c.root.position;
        const pb = b.c.root.position;
        c.turnTo(Math.atan2(pb.x - pa.x, pb.z - pa.z));
        b.c.turnTo(Math.atan2(pa.x - pb.x, pa.z - pb.z));
        c.play('Talk');
        b.c.play('Idle');
        a.wait = b.wait = 6 + r() * 12;
        return;
      }
      c.play('Idle');
      a.wait = 2 + r() * 8;
      return;
    }
    let tgt: THREE.Vector3;
    if (a.path) {
      if (a.seg < 0 || a.seg >= a.path.length) {
        a.dir = a.dir === 1 ? -1 : 1;
        a.seg = a.dir === 1 ? 1 : a.path.length - 2;
        // reached the end of the boardwalk: stop, stand a while, then head back (no instant U-turn)
        if (!a.turned) {
          a.turned = true;
          c.play('Idle');
          a.wait = 3 + r() * 6;
          return;
        }
      }
      a.turned = false;
      const q = a.path[a.seg];
      tgt = new THREE.Vector3(q.x + a.lane, 0, q.z + a.lane * 0.5);
      a.seg += a.dir;
    } else tgt = this.sample ? this.sample() : c.root.position.clone();
    c.moveTo(tgt, () => {
      a.wait = r() < 0.5 ? 0 : 1 + r() * 4;
      if (a.wait > 0) c.play('Idle');
    }, c.walkSpeed * (0.85 + r() * 0.25));
  }

  update(dt: number, camera?: THREE.Camera | null, frustum?: THREE.Frustum | null): void {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.c.walking) {
        a.wait -= dt;
        if (a.wait <= 0) {
          if (a.partner >= 0) {
            const b = this.agents[a.partner];
            b.partner = -1;
            b.wait = 0;
            a.partner = -1;
          }
          this.next(i);
        }
      }
      a.c.update(dt, camera, frustum);
    }
  }

  dispose(): void {
    for (const m of this.members) m.dispose();
    this.root.removeFromParent();
  }
}
