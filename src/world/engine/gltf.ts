// Shared glTF loading for kit assets: Draco + meshopt + KTX2 (decoders served from public/world/libs),
// cached per URL; skinned assets are cloned with SkeletonUtils so every instance animates independently.
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { pending } from './tex';
import { LOW_MEMORY } from '../../lowmem';

let loader: GLTFLoader | null = null;
let sharedDraco: DRACOLoader | null = null;
/** the one Draco decoder (its worker pool), for kit loaders that bring their own GLTFLoader */
export function getSharedDraco(): DRACOLoader | null {
  return sharedDraco;
}
const cache = new Map<string, Promise<GLTF>>();

type Pooled = Worker & { _taskLoad: number };
/** Phones: terminate the decoder worker (and its WASM heap) once decoding has been idle a while. It respawns on the
 *  next decode from the kept worker blob (DRACOLoader.dispose would revoke that, so the pool is trimmed by hand). */
function reapIdleWorkers(draco: DRACOLoader, idleMs = 15000): void {
  const d = draco as unknown as { workerPool: Pooled[]; decodeGeometry: (...a: unknown[]) => Promise<unknown> };
  const decode = d.decodeGeometry.bind(draco);
  let timer = 0;
  const reap = () => {
    timer = 0;
    if (d.workerPool.some((w) => w._taskLoad > 0)) return void (timer = window.setTimeout(reap, idleMs));
    for (const w of d.workerPool) w.terminate();
    d.workerPool.length = 0;
  };
  d.decodeGeometry = (...a: unknown[]) => {
    if (timer) clearTimeout(timer);
    return decode(...a).finally(() => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(reap, idleMs);
    });
  };
}

/** Must be called once with the renderer (KTX2 needs it to pick a transcode target). */
export function initGltf(renderer: THREE.WebGPURenderer): void {
  if (loader) return;
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}world/libs/draco/`);
  // each decoder worker holds its own WASM heap (tens of MB on iOS): phones decode with one
  if (LOW_MEMORY) {
    draco.setWorkerLimit(1);
    reapIdleWorkers(draco);
  }
  sharedDraco = draco;
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(`${base}world/libs/basis/`);
  ktx2.detectSupport(renderer);
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);
  // meshopt decoding off the main thread (the decoder singleton is shared by every kit's loader)
  // (phones: on the main thread; meshopt decodes fast and a worker pool costs memory)
  if (!LOW_MEMORY) (MeshoptDecoder as unknown as { useWorkers?: (n: number) => void }).useWorkers?.(Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2)));
  loader.setMeshoptDecoder(MeshoptDecoder);
}

/** Low-memory profile: the longest side a model texture keeps. Live figures are a few dozen pixels tall on a phone
 *  at DPR 1, and the kit textures (1-2k, with mips) were ~200 MB of the GPU budget. */
const PHONE_TEX = 512;
const shrunk = new WeakSet<THREE.Texture>();
/** Downscale every texture of a loaded model to PHONE_TEX (low-memory profile only; resolves when done). */
export async function shrinkTextures(root: THREE.Object3D): Promise<void> {
  if (!LOW_MEMORY) return;
  const jobs: Promise<void>[] = [];
  root.traverse((o) => {
    const ms = (o as THREE.Mesh).material;
    for (const m of Array.isArray(ms) ? ms : ms ? [ms] : []) {
      for (const v of Object.values(m)) {
        const t = v as THREE.Texture;
        if (!t?.isTexture || shrunk.has(t)) continue;
        const img = t.image as (ImageBitmap | HTMLImageElement) & { width: number; height: number };
        if (!img || !(img.width > PHONE_TEX || img.height > PHONE_TEX) || typeof createImageBitmap !== 'function') continue;
        if (!(img instanceof ImageBitmap || (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement))) continue;
        shrunk.add(t);
        const k = PHONE_TEX / Math.max(img.width, img.height);
        jobs.push(
          createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(img.width * k)), resizeHeight: Math.max(1, Math.round(img.height * k)), resizeQuality: 'medium', premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as ImageBitmapOptions)
            .then((small) => {
              (img as ImageBitmap).close?.();
              t.image = small;
              t.needsUpdate = true;
            })
            .catch(() => undefined),
        );
      }
    }
  });
  await Promise.all(jobs);
}

/** Load (once) a glb under public/ — `path` relative to public, e.g. 'world/assets/life/cow.glb'. */
export function loadGltf(path: string): Promise<GLTF> {
  if (!loader) throw new Error('initGltf(renderer) first');
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}${path}`).then(async (g) => {
      await shrinkTextures(g.scene);
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
