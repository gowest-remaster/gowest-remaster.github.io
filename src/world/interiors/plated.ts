// A pre-rendered room (docs/world/sets.md "Plates"): the plate draws everything, so the kit room (models, textures,
// light rig: ~30 MB for the store) is never loaded. Only the clickable props remain, as invisible meshes built from
// the kit props' own triangles (public/world/plates/<view>/props.json, world space), so picking and label anchors
// are identical to the kit room. The camera is the plate's camera, fixed (no drift over a photograph).
import * as THREE from 'three/webgpu';
import { InteriorSet } from './base';

const BASE = `${import.meta.env.BASE_URL}world/plates/`;

interface PropsJson {
  version: number;
  exposure?: number;
  props: Record<string, number[]>;
}

export class PlatedInterior extends InteriorSet {
  ready: Promise<void>;
  readonly view: string;

  constructor(view: string) {
    super();
    this.view = view;
    this.envIntensity = 0;
    this.ready = this.load();
  }

  /** true when the view has a plate with pick geometry (else the kit room is needed) */
  static async available(view: string): Promise<boolean> {
    try {
      const r = await fetch(`${BASE}${view}/props.json`, { method: 'HEAD' });
      return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
    } catch {
      return false;
    }
  }

  private async load(): Promise<void> {
    const [pj, pl] = await Promise.all([
      fetch(`${BASE}${this.view}/props.json`).then((r) => r.json() as Promise<PropsJson>),
      fetch(`${BASE}${this.view}/plate.json`).then((r) => r.json() as Promise<{ camera: { pos: number[]; look: number[]; fovY: number }; overscan?: number }>),
    ]);
    if (pj.exposure) this.exposure = pj.exposure;
    const c = pl.camera;
    this.shot = { pos: new THREE.Vector3().fromArray(c.pos), look: new THREE.Vector3().fromArray(c.look), fov: c.fovY / (pl.overscan ?? 1) };
    this.update(0, 0, false); // the camera is valid before the first frame (labels, picking)
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    for (const [id, tri] of Object.entries(pj.props)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = `prop:${id}`;
      this.scene.add(this.prop(id, m));
    }
  }

  setEnvironment(_t: THREE.Texture): void {
    // unlit: the plate carries the room's light
  }

  update(t: number, _dt: number, _idle: boolean): void {
    this.time = t;
    this.camera.position.copy(this.shot.pos);
    this.camera.fov = this.shot.fov * this.fovScale;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.shot.look);
  }
}
