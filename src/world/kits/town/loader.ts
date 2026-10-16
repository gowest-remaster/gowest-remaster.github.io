// Town kit GLB loading: meshopt-compressed glTF from public/world/assets/town, materials bound by name,
// *_LOD0/1/2 children turned into THREE.LOD. Buildings ship their far LODs in <id>.glb (~100 KB) and the full-detail
// LOD0 in <id>_lod0.glb, which StreamingLOD fetches the first time the camera comes within range.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { bindTownMaterials } from './materials';
import { mergeKit } from './kitmat';

const BASE = `${import.meta.env.BASE_URL}world/assets/town/`;
const gltf = new GLTFLoader();
gltf.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Object3D>>();
/** ?kitmerge=0 disables merging (A/B). */
const MERGE = typeof location === 'undefined' || new URLSearchParams(location.search).get('kitmerge') !== '0';

/** LOD switch distances (metres): LOD1 beyond [0], LOD2 beyond [1]. */
export const LOD_DIST: [number, number] = [55, 170];
/** Start streaming a building's LOD0 when the camera is closer than this (metres). */
export const DETAIL_FETCH_DIST = 110;

async function raw(path: string, wear: number): Promise<THREE.Object3D> {
  const key = `${path}|${wear}`;
  let p = cache.get(key);
  if (!p) {
    p = gltf.loadAsync(BASE + path).then((g) => {
      bindTownMaterials(g.scene, wear);
      // collapse the per-material primitives into one uber-material mesh per node (draw calls + programs)
      if (MERGE) mergeKit(g.scene);
      g.scene.updateMatrixWorld(true);
      return g.scene;
    });
    cache.set(key, p);
  }
  return p;
}

/** THREE.LOD that fetches its LOD0 detail glb on demand. */
export class StreamingLOD extends THREE.LOD {
  detailPath = '';
  wear = 0.3;
  detailState: 'none' | 'loading' | 'ready' = 'none';
  private readonly _p = new THREE.Vector3();

  /** Fetch and attach LOD0 now (e.g. before cutting to a close-up). */
  loadDetail(): Promise<void> {
    if (this.detailState !== 'none' || !this.detailPath) return Promise.resolve();
    this.detailState = 'loading';
    return raw(this.detailPath, this.wear)
      .then((src) => {
        const lod0 = src.getObjectByName(src.children[0]?.name ?? '') ?? src;
        // keep the node transform: meshopt/quantization stores the dequantization scale + offset there
        this.addLevel(lod0.clone(true), 0);
        this.detailState = 'ready';
      })
      .catch((e) => {
        console.warn('town detail failed', this.detailPath, e);
        this.detailState = 'ready';
      });
  }

  update(camera: THREE.Camera): void {
    if (this.detailState === 'none' && this.detailPath) {
      this._p.setFromMatrixPosition(this.matrixWorld);
      if (this._p.distanceTo(camera.position) < DETAIL_FETCH_DIST) void this.loadDetail();
    }
    super.update(camera);
  }

  copy(source: this, recursive?: boolean): this {
    super.copy(source, recursive);
    this.detailPath = source.detailPath;
    this.wear = source.wear;
    this.detailState = 'none';
    // a clone re-streams its own LOD0 copy (from the shared cache): drop a copied LOD0 level
    if (source.detailState === 'ready' && this.levels.length > 0 && this.levels[0].distance === 0) {
      const l0 = this.levels.shift()!;
      this.remove(l0.object);
    }
    return this;
  }
}

function toLOD(root: THREE.Object3D, detail?: string, wear = 0.3): THREE.Object3D {
  const groups = new Map<string, THREE.Object3D[]>();
  root.traverse((o) => {
    const m = /^(.*)_LOD(\d)$/.exec(o.name);
    if (m) {
      const arr = groups.get(m[1]) ?? [];
      arr[Number(m[2])] = o;
      groups.set(m[1], arr);
    }
  });
  for (const [name, lods] of groups) {
    const first = lods.find(Boolean);
    const parent = first?.parent;
    if (!parent) continue;
    const lod = detail ? new StreamingLOD() : new THREE.LOD();
    lod.name = name;
    lods.forEach((o, i) => {
      if (!o) return;
      parent.remove(o);
      lod.addLevel(o, i === 0 ? 0 : LOD_DIST[i - 1] ?? 400 * i);
    });
    if (detail) {
      (lod as StreamingLOD).detailPath = detail;
      (lod as StreamingLOD).wear = wear;
    }
    parent.add(lod);
  }
  return root;
}

/** Load a town GLB (path relative to public/world/assets/town/), returning a fresh clone.
 *  `detail`: path of a streamed LOD0 glb for the LOD group(s) in this file. */
export async function loadTownGLB(path: string, wear = 0.3, detail?: string): Promise<THREE.Object3D> {
  const src = await raw(path, wear);
  const c = src.clone(true);
  return toLOD(c, detail, wear);
}
