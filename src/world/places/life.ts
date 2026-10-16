// Adapters from the world's view-driven API (counts per species, family size, town crowd) to the life kit
// (photoreal skinned animals and period people). Lazy: the kit loads on first use.
import * as THREE from 'three/webgpu';
import { BARN, HOME, MAILBOX, STREET, WINDMILL, terrainHeight } from '../env/layout';

type LifeKit = typeof import('../kits/life');
let kitP: Promise<LifeKit> | null = null;
let kitNow: LifeKit | null = null;
const kit = () => (kitP ??= import('../kits/life').then((k) => (kitNow = k)));

const PEN = { x0: BARN.x - 6.5 + 1.5, x1: BARN.x + 9.5 - 1.5, z0: BARN.z + 7 + 1.5, z1: BARN.z + 19.5 - 1.5 };
const STY = { x0: BARN.x - 5, x1: BARN.x - 1, z0: BARN.z + 8.5, z1: BARN.z + 12.5 };
const YARD = { center: { x: HOME.x - 1, z: HOME.z + 6 }, radius: 5.5 };

interface Disposable {
  root: THREE.Object3D;
  dispose(): void;
}

export class LifeLivestock {
  group = new THREE.Group();
  private key = '';
  private gen = 0;
  private live: Disposable[] = [];

  setCounts(c: { cows: number; horses: number; pigs: number; chickens: number }, penAvailable: boolean): void {
    const want = { cows: penAvailable ? Math.min(c.cows, 9) : 0, horses: Math.min(c.horses, 5), pigs: penAvailable ? Math.min(c.pigs, 6) : 0, chickens: Math.min(c.chickens, 14), dog: c.chickens > 0 || c.cows > 0 ? 1 : 0 };
    const key = JSON.stringify(want);
    if (key === this.key) return;
    this.key = key;
    const gen = ++this.gen;
    void kit().then(async (k) => {
      const ground = terrainHeight;
      const made = await Promise.all([
        want.cows ? k.spawnHerd(['cow_hereford', 'cow_hereford', 'cow_brown', 'cow'], want.cows, PEN, { seed: 11, ground }) : null,
        want.horses ? k.spawnHerd(['horse_bay', 'horse_grey', 'horse_bay'], want.horses, PEN, { seed: 12, ground }) : null,
        want.pigs ? k.spawnHerd('pig', want.pigs, STY, { seed: 13, ground }) : null,
        want.chickens ? k.spawnHerd(['hen', 'hen', 'hen', 'rooster'], want.chickens, YARD, { seed: 14, ground }) : null,
        want.dog ? k.spawnHerd('dog', 1, { center: { x: HOME.x + 1.5, z: HOME.z + 4.5 }, radius: 3 }, { seed: 15, ground }) : null,
      ]);
      const ok = made.filter(Boolean) as Disposable[];
      if (gen !== this.gen) {
        ok.forEach((h) => h.dispose());
        return;
      }
      for (const h of this.live) {
        this.group.remove(h.root);
        h.dispose();
      }
      this.live = ok;
      for (const h of ok) this.group.add(h.root);
    });
  }

  update(): void {}
}

const CHORES = (): THREE.Vector3[] =>
  [
    [HOME.x - 1, HOME.z + 4.5],
    [WINDMILL.x + 1.5, WINDMILL.z + 2.5],
    [BARN.x - 4, BARN.z + 6],
    [HOME.x + 4, HOME.z + 3],
    [MAILBOX.x + 1, MAILBOX.z + 0.5],
    [HOME.x - 6, HOME.z + 1.5],
  ].map(([x, z]) => new THREE.Vector3(x, terrainHeight(x, z), z));

/** The family doing chores: walk between house, well, barn, woodpile, garden; chat when two meet. */
export class LifeFamily {
  group = new THREE.Group();
  private n = -1;
  private gen = 0;
  private members: { c: import('../kits/life').Creature; timer: number; busy: boolean; goal?: THREE.Vector3 }[] = [];

  setCount(n: number, kidsAges: number[] = [10, 6, 3]): void {
    n = Math.max(0, Math.min(6, n));
    if (n === this.n) return;
    this.n = n;
    const gen = ++this.gen;
    const roles: string[] = ['father', 'mother'];
    for (const age of kidsAges) roles.push(age < 6 ? 'toddler' : age < 10 ? 'girl' : 'boy');
    void kit().then(async (k) => {
      const spots = CHORES();
      const made = await Promise.all(roles.slice(0, n).map((r, i) => k.loadPerson(r as never, { seed: 100 + i })));
      if (gen !== this.gen) {
        made.forEach((c) => c.dispose());
        return;
      }
      for (const m of this.members) {
        this.group.remove(m.c.root);
        m.c.dispose();
      }
      this.members = made.map((c, i) => {
        const p = spots[i % spots.length];
        const a = (i / Math.max(1, made.length)) * Math.PI * 2;
        c.root.position.copy(p).add(new THREE.Vector3(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2));
        c.root.position.y = terrainHeight(c.root.position.x, c.root.position.z);
        c.face(Math.random() * Math.PI * 2);
        this.group.add(c.root);
        return { c, timer: 2 + i * 3, busy: false };
      });
    });
  }

  update(_t: number, dt: number): void {
    const spots = CHORES();
    for (const m of this.members) {
      if (m.busy) continue;
      m.timer -= dt;
      if (m.timer > 0) continue;
      // a different chore spot, approached to a free place around it (personal space ~1.1 m from everyone,
      // including where others are heading) so family members never stand inside each other
      const here = m.c.root.position;
      const choices = spots.filter((p) => p.distanceTo(here) > 3);
      const base = (choices.length ? choices : spots)[Math.floor(Math.random() * (choices.length || spots.length))];
      const taken = this.members.filter((o) => o !== m).map((o) => o.goal ?? o.c.root.position);
      let tgt = base.clone();
      for (let k = 0; k < 12; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.6 + Math.random() * 1.2;
        const cand = base.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        if (taken.every((q) => Math.hypot(q.x - cand.x, q.z - cand.z) > 1.1)) {
          tgt = cand;
          break;
        }
      }
      tgt.y = terrainHeight(tgt.x, tgt.z);
      m.busy = true;
      m.goal = tgt;
      m.c.moveTo(tgt, () => {
        m.busy = false;
        m.timer = 6 + Math.random() * 14;
        // pause to chat if someone else is standing nearby: turn to face them
        const near = this.members.find((o) => o !== m && !o.busy && o.c.root.position.distanceTo(m.c.root.position) < 3);
        if (near) {
          const a = m.c.root.position;
          const b = near.c.root.position;
          m.c.turnTo(Math.atan2(b.x - a.x, b.z - a.z));
          near.c.turnTo(Math.atan2(a.x - b.x, a.z - b.z));
        }
        m.c.play(near ? 'Talk' : 'Idle');
      });
    }
  }
}

/** Main Street townsfolk on the boardwalks and crossing the street. */
export class LifeTownCrowd {
  group = new THREE.Group();
  private n = -1;
  private gen = 0;
  private cur: Disposable | null = null;

  setGrowth(g: number): void {
    const n = Math.round(8 + 20 * g);
    if (n === this.n) return;
    this.n = n;
    const gen = ++this.gen;
    const walk = (side: number) => STREET.x + side * (STREET.halfWidth + 1.5);
    const paths = [
      [{ x: walk(-1), z: STREET.z0 - 4 }, { x: walk(-1), z: STREET.z1 + 40 }],
      [{ x: walk(1), z: STREET.z0 - 4 }, { x: walk(1), z: STREET.z1 + 40 }],
      [{ x: walk(-1), z: STREET.z0 - 45 }, { x: STREET.x, z: STREET.z0 - 50 }, { x: walk(1), z: STREET.z0 - 55 }],
      [{ x: walk(1), z: STREET.z0 - 95 }, { x: walk(-1), z: STREET.z0 - 100 }],
    ];
    void kit().then(async (k) => {
      const c = await k.crowd(n, null, { paths, seed: 7, ground: terrainHeight });
      if (gen !== this.gen) {
        c.dispose();
        return;
      }
      if (this.cur) {
        this.group.remove(this.cur.root);
        this.cur.dispose();
      }
      this.cur = c;
      this.group.add(c.root);
      this.casters = null;
    });
  }

  /** Only townsfolk near the camera cast shadows: each is ~10 skinned parts, rendered again per shadow cascade. */
  private casters: { o: THREE.Object3D; meshes: THREE.Mesh[]; on: boolean }[] | null = null;
  private _p = new THREE.Vector3();
  updateShadows(camera: THREE.Camera, near = 32): void {
    if (!this.cur) return;
    if (!this.casters) {
      this.casters = this.cur.root.children.map((o) => {
        const meshes: THREE.Mesh[] = [];
        o.traverse((m) => {
          if ((m as THREE.Mesh).isMesh) meshes.push(m as THREE.Mesh);
        });
        return { o, meshes, on: true };
      });
    }
    for (const c of this.casters) {
      const on = c.o.getWorldPosition(this._p).distanceTo(camera.position) < near;
      if (on === c.on) continue;
      c.on = on;
      for (const m of c.meshes) m.castShadow = on;
    }
  }
}

/** Per-frame: ticks every live kit creature (mixers, behaviour, LOD). */
export function updateLifeKit(dt: number, camera: THREE.Camera): void {
  kitNow?.updateLife(dt, camera);
}
