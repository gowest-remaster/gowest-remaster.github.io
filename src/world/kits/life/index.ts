// Life kit (photoreal farm animals and 1880s people). Exports:
//   loadAnimal(kind, opts)                -> Creature   (skinned glb, clips Idle / Walk / Graze [+ Stomp])
//   spawnHerd(kind | kinds[], count, area, opts) -> Herd (wandering, grazing, cohesive group)
//   loadPerson(role, opts)                -> Creature   (clips Idle / Walk / Talk)
//   crowd(count, area, opts)              -> Crowd      (townsfolk walking paths, pausing, talking)
//   updateLife(dt, camera)                -> call once per frame: ticks every live herd / crowd / creature
// Units: metres, +Y up, ground contact y = 0, models face +Z (Creature.face(yaw) rotates about +Y).
// See README.md in this folder for sizes, walk speeds, LOD distances and placement notes.
import * as THREE from 'three/webgpu';
import { loadTemplate } from './loader';
import { Creature, LIFE_LOD, LIFE_FREEZE, rand, type CreatureOpts } from './creature';
import { Herd, type Area } from './herd';
import { Crowd, type Path } from './crowd';

export { Creature, Herd, Crowd, LIFE_LOD, LIFE_FREEZE };
export type { Area, Path, CreatureOpts };

export const ANIMALS = ['cow_hereford', 'cow', 'cow_brown', 'horse_bay', 'horse_grey', 'horse_draft', 'pig', 'hen', 'rooster', 'dog'] as const;
export type AnimalKind = (typeof ANIMALS)[number];
export const ROLES = ['father', 'mother', 'boy', 'girl', 'toddler', 'merchant', 'banker', 'farmer', 'townswoman', 'oldwoman'] as const;
export type Role = (typeof ROLES)[number];
/** Townsfolk mix used by crowd() when no roles are given (weights). */
export const TOWN_MIX: Partial<Record<Role, number>> = { farmer: 3, townswoman: 3, merchant: 1, banker: 1, oldwoman: 2, boy: 1.5, girl: 1.5 };

const FUR = new Set<string>(['cow_hereford', 'cow', 'cow_brown', 'horse_bay', 'horse_grey', 'horse_draft', 'pig', 'dog', 'hen', 'rooster']);

/** Things updateLife() ticks. Herds/crowds/creatures register themselves; call .dispose() to remove. */
const live = new Set<{ update(dt: number, cam?: THREE.Camera | null, fr?: THREE.Frustum | null): void }>();
let lastCamera: THREE.Camera | null = null;
const frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();

/** Per-frame hook: advance all animal and people animation + behaviour. Pass the render camera for LOD. */
export function updateLife(dt: number, camera?: THREE.Camera | null): void {
  if (camera) lastCamera = camera;
  const cam = camera ?? lastCamera;
  let fr: THREE.Frustum | null = null;
  if (cam) {
    cam.updateMatrixWorld();
    _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    fr = frustum.setFromProjectionMatrix(_pv);
  }
  for (const l of live) l.update(dt, cam, fr);
}

function track<T extends { update(dt: number, cam?: THREE.Camera | null, fr?: THREE.Frustum | null): void; dispose(): void }>(x: T): T {
  live.add(x);
  const d = x.dispose.bind(x);
  x.dispose = () => {
    live.delete(x);
    d();
  };
  return x;
}

/** One animal. `opts.autoUpdate` (default true) registers it with updateLife(); herds manage their own members. */
export async function loadAnimal(kind: AnimalKind, opts: CreatureOpts & { autoUpdate?: boolean } = {}): Promise<Creature> {
  const t = await loadTemplate(kind, { fur: FUR.has(kind) });
  const c = new Creature(kind, t, opts);
  if (opts.autoUpdate !== false) track(c);
  return c;
}

/** One person. Roles: father, mother, boy (12), girl (8), toddler (4), merchant, banker, farmer, townswoman, oldwoman. */
export async function loadPerson(role: Role, opts: CreatureOpts & { autoUpdate?: boolean } = {}): Promise<Creature> {
  const t = await loadTemplate(`people/${role}`);
  const c = new Creature(role, t, opts);
  if (opts.autoUpdate !== false) track(c);
  return c;
}

/**
 * A herd/flock wandering inside `area` (circle, rectangle or polygon in world x/z).
 * `kinds` may be one kind or a weighted list, e.g. spawnHerd(['cow_hereford','cow_hereford','cow'], 6, pen).
 */
export async function spawnHerd(
  kinds: AnimalKind | AnimalKind[],
  count: number,
  area: Area,
  opts: { seed?: number; ground?: (x: number, z: number) => number } = {},
): Promise<Herd> {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  const seed = opts.seed ?? 1;
  const h = new Herd(area, seed, opts.ground);
  const r = rand(seed);
  const made = await Promise.all(Array.from({ length: count }, (_, i) => loadAnimal(list[i % list.length], { seed: Math.floor(r() * 1e9), autoUpdate: false })));
  made.forEach((c) => h.add(c));
  return track(h);
}

/**
 * Townsfolk: `count` people on `paths` (polylines in world x/z, e.g. the boardwalks) or wandering `area`.
 * opts.roles: explicit role list (cycled) or weights; defaults to TOWN_MIX.
 */
export async function crowd(
  count: number,
  area: Area | null,
  opts: { paths?: Path[]; roles?: Role[] | Partial<Record<Role, number>>; seed?: number; ground?: (x: number, z: number) => number } = {},
): Promise<Crowd> {
  const seed = opts.seed ?? 1;
  const r = rand(seed * 31 + 5);
  const cr = new Crowd(area, opts.paths ?? [], seed, opts.ground);
  let pick: (i: number) => Role;
  if (Array.isArray(opts.roles)) {
    const rl = opts.roles;
    pick = (i) => rl[i % rl.length];
  } else {
    const w = Object.entries(opts.roles ?? TOWN_MIX) as [Role, number][];
    const tot = w.reduce((s, [, v]) => s + v, 0);
    pick = () => {
      let x = r() * tot;
      for (const [k, v] of w) if ((x -= v) <= 0) return k;
      return w[0][0];
    };
  }
  const made = await Promise.all(Array.from({ length: count }, (_, i) => loadPerson(pick(i), { seed: Math.floor(r() * 1e9), autoUpdate: false })));
  made.forEach((c) => cr.add(c));
  return track(cr);
}

/** Preload glbs (e.g. while a place loads) so spawning later is instant. */
export function preloadLife(names: (AnimalKind | Role)[]): Promise<unknown> {
  return Promise.all(names.map((n) => ((ROLES as readonly string[]).includes(n) ? loadTemplate(`people/${n}`) : loadTemplate(n, { fur: FUR.has(n) }))));
}

// ------------------------------------------------------------------------------------------- lookdev
// lookdev.html?kit=life&item=<name>[&anim=Walk]. Items animate themselves (the page only ticks raw glbs).
let lookdevLoop = false;
function selfDrive(root: THREE.Object3D): THREE.Object3D {
  // capture the render camera through an (invisible) proxy so distance LOD works in lookdev
  const probe = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false }));
  probe.onBeforeRender = (_r, _s, cam) => {
    lastCamera = cam;
  };
  probe.frustumCulled = false;
  root.add(probe);
  if (!lookdevLoop) {
    lookdevLoop = true;
    let t0 = performance.now();
    const tick = () => {
      const t = performance.now();
      updateLife(Math.min(0.1, (t - t0) / 1000), lastCamera);
      t0 = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  return root;
}
const animParam = () => new URLSearchParams(location.search).get('anim');

async function single(c: Promise<Creature>): Promise<THREE.Object3D> {
  const x = await c;
  const a = animParam();
  if (a) x.play(a, 0);
  x.face(0);
  const g = new THREE.Group();
  g.add(x.root);
  return selfDrive(g);
}

async function lineup(names: readonly string[], spacing: (n: string) => number, person: boolean): Promise<THREE.Object3D> {
  const g = new THREE.Group();
  let x = 0;
  const made = await Promise.all(names.map((n, i) => (person ? loadPerson(n as Role, { seed: i + 1, scale: 1 }) : loadAnimal(n as AnimalKind, { seed: i + 1, scale: 1 }))));
  made.forEach((c, i) => {
    const w = spacing(names[i]);
    x += w / 2;
    c.root.position.x = x;
    x += w / 2;
    c.face(0);
    const a = animParam();
    if (a) c.play(a, 0);
    g.add(c.root);
  });
  g.children.forEach((o) => (o.position.x -= x / 2));
  return selfDrive(g);
}

export const lookdev: Record<string, () => Promise<THREE.Object3D>> = {
  ...Object.fromEntries(ANIMALS.map((k) => [k, () => single(loadAnimal(k, { seed: 3, scale: 1 }))])),
  ...Object.fromEntries(ROLES.map((k) => [`person_${k}`, () => single(loadPerson(k, { seed: 3, scale: 1 }))])),
  lineup_animals: () => lineup(ANIMALS, (n) => (n === 'horse_draft' ? 1.2 : n.startsWith('horse') || n.startsWith('cow') ? 1.05 : n === 'pig' ? 0.8 : 0.55), false),
  lineup_people: () => lineup(ROLES, () => 0.85, true),
  herd: async () => {
    const g = new THREE.Group();
    g.add((await spawnHerd(['cow_hereford', 'cow_hereford', 'cow_brown', 'cow_hereford', 'cow'], 9, { center: { x: 0, z: 0 }, radius: 14 }, { seed: 4 })).root);
    return selfDrive(g);
  },
  pen: async () => {
    const g = new THREE.Group();
    const pen = { x0: -12, z0: -8, x1: 12, z1: 8 };
    g.add((await spawnHerd(['cow_hereford', 'cow_hereford', 'cow'], 5, pen, { seed: 2 })).root);
    g.add((await spawnHerd(['horse_bay', 'horse_grey'], 3, pen, { seed: 3 })).root);
    g.add((await spawnHerd('pig', 3, { x0: 6, z0: -8, x1: 12, z1: -2 }, { seed: 5 })).root);
    g.add((await spawnHerd(['hen', 'hen', 'hen', 'rooster'], 10, { center: { x: -8, z: 6 }, radius: 4 }, { seed: 6 })).root);
    return selfDrive(g);
  },
  /** The world's barn + pen (homestead kit, same PEN_POLY as places/homesteadKit.ts) stocked like docs/screens/world/pen-golden.png; frame with
   *  yaw=-28&pitch=6&dist=22&ty=1.3&fov=46 to match the 'pen' place camera. */
  pen_scene: async () => {
    const hs = await import('../homestead');
    const { BARN, terrainHeight } = await import('../../env/layout');
    const g = new THREE.Group();
    const barn = await hs.loadBarn('red');
    barn.root.position.set(BARN.x, terrainHeight(BARN.x, BARN.z) - 0.1, BARN.z);
    barn.root.rotation.y = -0.17;
    const B0 = BARN;
    const fence = await hs.buildFence('pen', [[B0.x - 6.4, B0.z + 4.6], [B0.x - 8.5, B0.z + 19], [B0.x + 9, B0.z + 21], [B0.x + 11.5, B0.z + 5.2]], { gate: 0, heightAt: terrainHeight });
    g.add(barn.root, fence);
    const B = BARN;
    const poly = [
      { x: B.x - 5.2, z: B.z + 6.2 },
      { x: B.x - 7.0, z: B.z + 17.8 },
      { x: B.x + 7.8, z: B.z + 19.6 },
      { x: B.x + 10.0, z: B.z + 6.6 },
    ];
    const ground = (x: number, z: number) => terrainHeight(x, z);
    g.add((await spawnHerd(['cow_hereford', 'cow_hereford', 'cow_brown', 'cow_hereford', 'cow'], 5, { polygon: poly }, { seed: 11, ground })).root);
    g.add((await spawnHerd(['horse_bay', 'horse_grey', 'horse_draft'], 3, { polygon: poly }, { seed: 12, ground })).root);
    g.add((await spawnHerd('pig', 3, { x0: B.x + 4, z0: B.z + 7, x1: B.x + 9, z1: B.z + 11 }, { seed: 13, ground })).root);
    g.add((await spawnHerd(['hen', 'hen', 'hen', 'rooster'], 8, { center: { x: B.x - 9, z: B.z + 10 }, radius: 3 }, { seed: 14, ground })).root);
    g.position.set(-B.x, -terrainHeight(B.x, B.z + 12), -B.z - 12);
    return selfDrive(g);
  },
  family: async () => {
    const g = new THREE.Group();
    const fam: Role[] = ['father', 'mother', 'boy', 'girl', 'toddler'];
    const made = await Promise.all(fam.map((r, i) => loadPerson(r, { seed: 10 + i, scale: 1 })));
    made.forEach((c, i) => {
      c.root.position.set((i - 2) * 0.85, 0, Math.abs(i - 2) * 0.25);
      c.face(0);
      c.play(animParam() ?? (i === 0 ? 'Talk' : 'Idle'), 0);
      g.add(c.root);
    });
    const dog = await loadAnimal('dog', { seed: 2, scale: 1 });
    dog.root.position.set(1.9, 0, 0.9);
    dog.face(-0.6);
    g.add(dog.root);
    return selfDrive(g);
  },
  crowd: async () => {
    const g = new THREE.Group();
    const paths: Path[] = [
      [{ x: -12, z: -2 }, { x: 12, z: -2 }],
      [{ x: -12, z: 2.5 }, { x: 12, z: 2.5 }],
    ];
    g.add((await crowd(16, { x0: -10, z0: -3, x1: 10, z1: 3 }, { paths, seed: 9 })).root);
    return selfDrive(g);
  },
};
