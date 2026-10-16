// Field work made visible during playFieldWork: a crew working the square currently being turned over.
//   plow    -> a pair of draft horses in harness (Pull) on the walking plow, the farmer behind the handles
//   plant   -> the farmer broadcasting seed from a sack, walking the rows ('Sow' clip when the life kit has it)
//   harvest -> a team on the farm wagon hauling sheaves, the farmer walking alongside
// The crew walks real passes (back and forth along the square, at walking pace) across whichever square is in
// progress; squares still flip whole as the work's timer advances. Kits load lazily on first use.
import * as THREE from 'three/webgpu';
import { FIELD, squareCenter, terrainHeight } from '../env/layout';

type Kind = 'plow' | 'plant' | 'harvest';
type LifeKit = typeof import('../kits/life');
type Creature = Awaited<ReturnType<LifeKit['loadPerson']>>;

interface Crew {
  root: THREE.Group;
  movers: Creature[];
  /** world-space offsets (crew-local, +z = forward) for each mover */
  offsets: THREE.Vector3[];
  props: { o: THREE.Object3D; off: THREE.Vector3 }[];
  speed: number;
  tick?: (dt: number, speed: number) => void;
}

const ground = (x: number, z: number) => terrainHeight(x, z);

export class FieldCrew {
  group = new THREE.Group();
  private crews = new Map<Kind, Promise<Crew | null>>();
  private cur: Crew | null = null;
  private kind: Kind | null = null;
  private square = -1;
  private s = 0; // metres walked along the current pass line
  /** 0..1: where the work front is across the square (the crew works along it) */
  front = 0;
  private _p = new THREE.Vector3();

  constructor() {
    this.group.name = 'field-crew';
  }

  preload(): void {
    for (const k of ['plow', 'plant', 'harvest'] as Kind[]) void this.crew(k);
  }

  private crew(kind: Kind): Promise<Crew | null> {
    let p = this.crews.get(kind);
    if (!p) {
      p = this.build(kind).catch((e) => {
        console.warn('field crew failed', kind, e);
        return null;
      });
      this.crews.set(kind, p);
    }
    return p;
  }

  private async build(kind: Kind): Promise<Crew> {
    const life = await import('../kits/life');
    const hs = await import('../kits/homestead');
    const root = new THREE.Group();
    root.visible = false;
    const movers: Creature[] = [];
    const offsets: THREE.Vector3[] = [];
    const props: Crew['props'] = [];
    const addC = (c: Creature, off: THREE.Vector3, clip: string) => {
      c.play(clip, 0);
      root.add(c.root);
      movers.push(c);
      offsets.push(off);
    };
    let speed = 1.0;
    // in-place walk cycles: scale the clip to the crew's ground speed so the feet don't skate
    const pace = (c: Creature, clip: string, v: number) => {
      const a = (c as unknown as { actions: Record<string, THREE.AnimationAction> }).actions[clip];
      if (a) a.timeScale = v / 1.45;
    };
    let tick: Crew['tick'] = undefined;
    if (kind === 'plow' || kind === 'harvest') {
      // the implement sits at the crew origin (travel +Z); a draft horse's centreline over each trace hook, its
      // shoulders ~2.2 m ahead of the hook (root ~1.4 m ahead: the model's origin is mid-body)
      const imp = await hs.loadImplement(kind === 'plow' ? 'plow' : 'binder');
      imp.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      root.add(imp.root);
      props.push({ o: imp.root, off: new THREE.Vector3(0, 0, 0) });
      imp.root.updateMatrixWorld(true);
      const hooks = imp.traces.length === 2 ? imp.traces.map((t) => t.getWorldPosition(new THREE.Vector3())) : [new THREE.Vector3(-0.55, 0, 1.5), new THREE.Vector3(0.55, 0, 1.5)];
      for (const [i, h] of hooks.entries()) {
        const horse = await life.loadAnimal('horse_draft', { seed: 31 + i, autoUpdate: false, ground });
        addC(horse, new THREE.Vector3(h.x, 0, h.z + 1.45), 'Pull');
      }
      speed = 0.9;
      tick = (dt, v) => imp.update(dt, v);
      if (kind === 'plow') {
        const hn = imp.root.getObjectByName('Handles');
        const handles = hn ? hn.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(-0.2, 0.34, -0.92);
        const f = await life.loadPerson('farmer', { seed: 5, autoUpdate: false, ground });
        addC(f, new THREE.Vector3(handles.x, 0, handles.z - 0.55), 'Plowman');
        pace(f, 'Plowman', speed);
      } else {
        const seat = imp.seat ? imp.seat.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(-0.05, 1.32, -1.13);
        const f = await life.loadPerson('farmer', { seed: 6, autoUpdate: false });
        addC(f, new THREE.Vector3(seat.x, seat.y - 0.47, seat.z), 'Drive');
      }
    } else {
      const f = await life.loadPerson('farmer', { seed: 7, autoUpdate: false, ground });
      addC(f, new THREE.Vector3(0, 0, 0), 'Sow');
      speed = 0.9;
      pace(f, 'Sow', speed);
    }
    this.group.add(root);
    return { root, movers, offsets, props, speed, tick };
  }

  /** Start (or switch) the crew working `square`. */
  async work(kind: Kind, square: number): Promise<void> {
    if (this.kind !== kind) {
      if (this.cur) this.cur.root.visible = false;
      this.cur = null;
      this.kind = kind;
      const c = await this.crew(kind);
      if (this.kind !== kind) return;
      this.cur = c;
    }
    if (square !== this.square) {
      this.square = square;
      this.s = 0;
    }
    if (this.cur) this.cur.root.visible = true;
  }

  stop(): void {
    this.kind = null;
    this.square = -1;
    if (this.cur) this.cur.root.visible = false;
    this.cur = null;
  }

  update(dt: number, camera: THREE.Camera): void {
    const c = this.cur;
    if (!c || this.square < 0 || !c.root.visible) return;
    this.s += c.speed * dt;
    // the crew walks north-south passes along the work front (x), turning at the headlands
    const sq = squareCenter(this.square);
    const half = FIELD.square / 2 - 3;
    const len = 2 * half;
    const pass = Math.floor(this.s / len);
    const along = this.s - pass * len;
    const dir = pass % 2 === 0 ? -1 : 1; // first pass heads north (-z)
    const x = sq.x - half + this.front * 2 * half;
    const z = dir < 0 ? sq.z + half - along : sq.z - half + along;
    const yaw = dir < 0 ? Math.PI : 0;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const place = (o: THREE.Object3D, off: THREE.Vector3) => {
      const p = this._p.set(x, 0, z).addScaledVector(right, off.x).addScaledVector(fwd, off.z);
      o.position.set(p.x, ground(p.x, p.z) + off.y, p.z);
      o.rotation.y = yaw;
    };
    c.movers.forEach((m, i) => {
      place(m.root, c.offsets[i]);
      m.face(yaw);
      m.update(dt, camera);
    });
    for (const p of c.props) place(p.o, p.off);
    c.tick?.(dt, c.speed);
  }
}
