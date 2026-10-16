// Homestead kit: house interiors for the three house states (first sod house, furnished sod house, frame house).
// Each state is public/world/assets/homestead/interior_<state>.glb (baked room + authored furniture + clickables) plus
// the shared prefab library interior_props.glb (Poly Haven + Sketchfab furniture, stove, gramophone), cloned into
// the placement empties (glTF extras.prefab). Room origin = floor centre, +Y up, camera/door side +Z.
import * as THREE from 'three/webgpu';
import { float, vec3, mix, positionWorld, normalWorld, smoothstep } from 'three/tsl';
import { loadGLB, byName } from './loader';
import { tnoise } from '../../engine/tsl';

export type InteriorState = 'sod' | 'sodFurnished' | 'frame';

/** Clickable prop ids (separate named nodes; `userData.pickId` set like interiors/base.ts does). */
export const INTERIOR_PROPS = ['ledger', 'album', 'savings', 'newspaper', 'gramophone'] as const;
export type InteriorPropId = (typeof INTERIOR_PROPS)[number];

export interface InteriorShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export interface HomesteadInterior {
  root: THREE.Object3D;
  /** id -> clickable object (ledger, album, savings, newspaper, gramophone when present) */
  props: Map<string, THREE.Object3D>;
  /** game camera (same as the old InteriorSet shots) */
  shot: InteriorShot;
  lights: {
    /** window centre + unit direction TOWARD the sun through that window (aim a shadowed directional light along -dir) */
    window: { pos: THREE.Vector3; dir: THREE.Vector3 };
    /** oil-lamp flame position (warm point light, ~1-2 intensity, flicker) */
    lamp: THREE.Vector3;
  };
  /** inner room size in metres (x width, z depth, y ceiling) */
  size: THREE.Vector3;
  /** show/hide optional extras: 'gramophone' (furnished + frame) */
  setExtras(extras: string[]): void;
}

interface Spec {
  shot: InteriorShot;
  window: { pos: THREE.Vector3; dir: THREE.Vector3 };
  lamp: THREE.Vector3;
  size: THREE.Vector3;
}
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const SPECS: Record<InteriorState, Spec> = {
  sod: {
    shot: { pos: v3(1.75, 1.5, 1.45), look: v3(-0.55, 0.95, -1.05), fov: 50 },
    window: { pos: v3(-1.2, 1.485, -2.2), dir: v3(-0.22, 0.52, -1).normalize() },
    lamp: v3(0.0, 1.12, -0.55),
    size: v3(5.2, 2.36, 3.8),
  },
  sodFurnished: {
    shot: { pos: v3(1.75, 1.5, 1.45), look: v3(-0.55, 0.95, -1.05), fov: 50 },
    window: { pos: v3(-1.2, 1.485, -2.2), dir: v3(-0.22, 0.52, -1).normalize() },
    lamp: v3(0.0, 1.15, -0.55),
    size: v3(5.2, 2.36, 3.8),
  },
  frame: {
    shot: { pos: v3(0.6, 1.62, 3.6), look: v3(-0.3, 1.05, -1.6), fov: 54 },
    window: { pos: v3(-0.4, 1.68, -3.0), dir: v3(-0.25, 0.55, -1).normalize() },
    lamp: v3(1.15, 1.15, 0.85),
    size: v3(7.2, 3.1, 6.0),
  },
};

const FILE: Record<InteriorState, string> = { sod: 'interior_sod', sodFurnished: 'interior_sodFurnished', frame: 'interior_frame' };

let daylight: THREE.MeshBasicNodeMaterial | null = null;
/** window panes: bright overcast-to-sunny daylight with a little old-glass waviness (the interior scene has no sky) */
function daylightMaterial(): THREE.MeshBasicNodeMaterial {
  if (daylight) return daylight;
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = 'WindowDaylight';
  const wav = tnoise(positionWorld.xy.mul(9)).mul(0.18).add(0.91);
  const sky = mix(vec3(2.0, 2.1, 2.3), vec3(2.6, 2.4, 2.0), smoothstep(-0.3, 0.6, normalWorld.y.add(positionWorld.y.mul(0.2))));
  m.colorNode = sky.mul(wav).mul(float(0.85));
  daylight = m;
  return m;
}

/** Load an interior set. Prefab furniture is cloned from the shared interior_props.glb. */
export async function loadInterior(state: InteriorState): Promise<HomesteadInterior> {
  const [room, lib] = await Promise.all([loadGLB(FILE[state]), loadGLB('interior_props')]);
  // fill prefab placements
  const fills: [THREE.Object3D, string][] = [];
  room.traverse((o) => {
    const p = o.userData?.prefab as string | undefined;
    if (p) fills.push([o, p]);
  });
  for (const [slot, name] of fills) {
    const src = byName(lib, name);
    if (!src) {
      console.warn('[homestead] missing interior prefab', name);
      continue;
    }
    // keep the clone's own node transform: meshopt quantisation stores a dequantising offset/scale there
    slot.add(src.clone(true));
  }
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    if (mat && /WindowGlass/.test(mat.name)) {
      m.material = daylightMaterial();
      m.castShadow = false;
    }
  });
  const props = new Map<string, THREE.Object3D>();
  for (const id of INTERIOR_PROPS) {
    const o = byName(room, id);
    if (!o) continue;
    o.userData.pickId = id;
    o.traverse((c) => (c.userData.pickId = id));
    props.set(id, o);
  }
  const s = SPECS[state];
  return {
    root: room,
    props,
    shot: { pos: s.shot.pos.clone(), look: s.shot.look.clone(), fov: s.shot.fov },
    lights: { window: { pos: s.window.pos.clone(), dir: s.window.dir.clone() }, lamp: s.lamp.clone() },
    size: s.size.clone(),
    setExtras(extras: string[]) {
      const g = props.get('gramophone');
      if (g) g.visible = extras.includes('gramophone');
    },
  };
}

/**
 * Reference lighting for an interior (what the old InteriorSets did): shadowed sun through the window, a soft
 * skylight fill just inside it and the warm oil lamp. The rendering lead can use or replace this.
 */
export function addInteriorLights(it: HomesteadInterior, sunIntensity = 6, lampIntensity = 1.6): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'InteriorLights';
  const { pos, dir } = it.lights.window;
  const sun = new THREE.DirectionalLight(0xffd7a0, sunIntensity);
  sun.position.copy(pos).addScaledVector(dir, 12);
  sun.target.position.copy(pos).addScaledVector(dir, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -4;
  sc.right = sc.top = 4;
  sc.near = 2;
  sc.far = 25;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  g.add(sun, sun.target);
  const inward = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
  const sky = new THREE.PointLight(0xcfdcff, 1.2, 6, 2);
  sky.position.copy(pos).addScaledVector(inward, 0.6);
  g.add(sky);
  const lamp = new THREE.PointLight(0xffa860, lampIntensity, 6, 2);
  lamp.position.copy(it.lights.lamp);
  lamp.castShadow = true;
  g.add(lamp);
  it.root.add(g);
  return g;
}

async function lit(state: InteriorState): Promise<THREE.Object3D> {
  const it = await loadInterior(state);
  it.setExtras(['gramophone']);
  addInteriorLights(it);
  return it.root;
}

/** Items reviewable in lookdev.html?kit=homestead&item=<name> (the *_lit variants carry the interior lights) */
export const lookdev: Record<string, () => Promise<THREE.Object3D>> = {
  interior_sod: async () => (await loadInterior('sod')).root,
  interior_sod_furnished: async () => (await loadInterior('sodFurnished')).root,
  interior_frame: async () => (await loadInterior('frame')).root,
  interior_sod_lit: () => lit('sod'),
  interior_sod_furnished_lit: () => lit('sodFurnished'),
  interior_frame_lit: () => lit('frame'),
};
