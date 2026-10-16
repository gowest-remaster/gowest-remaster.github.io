// Shared glTF loading for kit assets: Draco + meshopt + KTX2 (decoders served from public/world/libs),
// cached per URL; skinned assets are cloned with SkeletonUtils so every instance animates independently.
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { pending } from './tex';

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<GLTF>>();

/** Must be called once with the renderer (KTX2 needs it to pick a transcode target). */
export function initGltf(renderer: THREE.WebGPURenderer): void {
  if (loader) return;
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}world/libs/draco/`);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(`${base}world/libs/basis/`);
  ktx2.detectSupport(renderer);
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);
  // meshopt decoding off the main thread (the decoder singleton is shared by every kit's loader)
  (MeshoptDecoder as unknown as { useWorkers?: (n: number) => void }).useWorkers?.(Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2)));
  loader.setMeshoptDecoder(MeshoptDecoder);
}

/** Load (once) a glb under public/ — `path` relative to public, e.g. 'world/assets/life/cow.glb'. */
export function loadGltf(path: string): Promise<GLTF> {
  if (!loader) throw new Error('initGltf(renderer) first');
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}${path}`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      return g;
    });
    cache.set(path, p);
    pending.push(p.catch(() => null));
  }
  return p;
}

/** An independent, animatable instance of a (possibly skinned) glb. */
export async function instantiate(path: string): Promise<{ root: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  const g = await loadGltf(path);
  const root = skeletonClone(g.scene);
  return { root, clips: g.animations };
}
