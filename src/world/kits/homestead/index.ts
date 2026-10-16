// Homestead asset kit (photoreal): sod house (camp / first / furnished), frame house, barn, windmill,
// fences, yard props and house interiors. All loaders return THREE.Object3D in metres, +Y up, front +Z,
// ground contact at y = 0. See README.md in this folder for exports, origins and suggested placements.
import * as THREE from 'three/webgpu';
import { loadGLB, byName } from './loader';
import { lookdev as buildingsLook } from './buildings';
import { lookdev as windmillLook } from './windmill';
import { lookdev as fencesLook } from './fences';
import { lookdev as yardLook } from './yard';
import { lookdev as interiorsLook } from './interiors';

export * from './buildings';
export * from './windmill';
export * from './fences';
export * from './yard';
export * from './interiors';

export { loadGLB, byName, LOD_DIST, plantMaterial, upgradeMaterial } from './loader';

export type SodState = 'sod' | 'sodFurnished';

export interface SodHouse {
  root: THREE.Object3D;
  /** door leaf: origin on the hinge axis, rotate about local Y to open (negative = inward) */
  door: THREE.Object3D;
  setState(s: SodState): void;
}

/** Sod house, 6.6 x 5.0 m footprint (+0.38 m eaves), origin at the footprint centre, door on the +Z face. */
export async function loadSodHouse(state: SodState = 'sod'): Promise<SodHouse> {
  const root = await loadGLB('sod_house', [30, 90]); // LOD1 (~75k tris incl. plants) serves the 35-55 m gameplay camera
  const plain = byName(root, 'Plain')!;
  const fur = byName(root, 'Furnished')!;
  const house: SodHouse = {
    root,
    door: byName(root, 'Door_plain')!,
    setState(s: SodState) {
      plain.visible = s === 'sod';
      fur.visible = s === 'sodFurnished';
      house.door = byName(root, s === 'sod' ? 'Door_plain' : 'Door_furnished')!;
    },
  };
  house.setState(state);
  return house;
}

/** Where the covered wagon stands in the camp (camp-local, metres; camp origin = house footprint centre). */
export const WAGON_SPOT = { x: -9.6, z: 7.4, rotY: 0.95 };

export interface WagonCamp {
  root: THREE.Object3D;
  /** campfire centre (for the renderer's fire / smoke / light) */
  fireAnchor: THREE.Object3D;
  /** the covered wagon (null if the wagon asset failed to load) */
  wagon: THREE.Object3D | null;
}

/** The claim before the sod house is built: camp.glb (same origin as the sod house) + the covered wagon. */
export async function loadWagonCamp(): Promise<WagonCamp> {
  const root = await loadGLB('camp');
  let wagon: THREE.Object3D | null = null;
  try {
    const yard = (await import('./yard')) as Record<string, unknown>;
    const load = yard.loadWagon as ((o?: { covered?: boolean }) => Promise<{ root: THREE.Object3D }>) | undefined;
    if (load) {
      wagon = (await load({ covered: true })).root;
      wagon.position.set(WAGON_SPOT.x, 0, WAGON_SPOT.z);
      wagon.rotation.y = WAGON_SPOT.rotY;
      wagon.name = 'Wagon';
      root.add(wagon);
    }
  } catch (e) {
    console.warn('[homestead] wagon unavailable for camp', e);
  }
  return { root, fireAnchor: byName(root, 'FireAnchor') ?? root, wagon };
}

/** Items reviewable in lookdev.html?kit=homestead&item=<name> */
export const lookdev: Record<string, () => Promise<THREE.Object3D>> = {
  sod_house: async () => (await loadSodHouse('sod')).root,
  sod_house_furnished: async () => (await loadSodHouse('sodFurnished')).root,
  wagon_camp: async () => (await loadWagonCamp()).root,
  ...buildingsLook,
  ...windmillLook,
  ...fencesLook,
  ...yardLook,
  ...interiorsLook,
};
