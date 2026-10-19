// Life kit glb loading: Draco + WebP glTF from public/world/assets/life, cached per asset and cloned per
// instance with SkeletonUtils (geometry, textures and materials are shared; each clone has its own skeleton).
// glTF PBR materials are upgraded to node materials with the engine's rain darkening / snow weathering.
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { texture, uv, float, vec3, positionLocal, smoothstep, mix, uniform } from 'three/tsl';
import { weatherColor } from '../../engine/tsl';
import { getSharedDraco, shrinkTextures } from '../../engine/gltf';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export const BASE = `${import.meta.env.BASE_URL}world/assets/life/`;
// one Draco decoder pool for the whole game (engine/gltf.ts): a second pool doubled the decoder workers, each with
// its own WASM heap (rendering lead, memory pass 2026-10-18)
const gltfLoader = new GLTFLoader();
let dracoSet = false;
const withDraco = () => {
  if (dracoSet) return;
  const shared = getSharedDraco();
  const draco = shared ?? new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}world/libs/draco/`);
  gltfLoader.setDRACOLoader(draco);
  dracoSet = true;
};

export interface Template {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** in-place walk speed of the Walk clip at timeScale 1 (m/s), from the glb scene extras */
  walkSpeed: number;
  /** standing height of the person / withers-or-head height of the animal (m) */
  height: number;
}

const cache = new Map<string, Promise<Template>>();

/** Load (once) and prepare an asset; `path` is relative to public/world/assets/life/ without .glb */
export function loadTemplate(path: string, opts: { fur?: boolean } = {}): Promise<Template> {
  let p = cache.get(path);
  if (!p) {
    withDraco();
    p = gltfLoader.loadAsync(`${BASE}${path}.glb`).then(async (g: GLTF) => {
      await shrinkTextures(g.scene); // (phones: model textures capped at 512 px)
      const extras = (g.scene.userData ?? {}) as { walkSpeed?: number; height?: number };
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // only LOD0/LOD1 cast shadows (LOD2 is beyond the shadow distance anyway); one caster per creature
        m.castShadow = !/_LOD2/.test(m.name);
        m.receiveShadow = true;
        m.frustumCulled = false; // skinned bounds are bind-pose only; the LOD switch culls by distance instead
        m.material = Array.isArray(m.material) ? m.material.map((x) => upgrade(x, opts.fur)) : upgrade(m.material, opts.fur);
      });
      const box = new THREE.Box3().setFromObject(g.scene);
      return { scene: g.scene, clips: g.animations, walkSpeed: extras.walkSpeed ?? 1.2, height: extras.height ?? box.max.y };
    });
    cache.set(path, p);
  }
  return p;
}

/** Fresh instance of a template (own skeleton, shared GPU resources). */
export function instance(t: Template): THREE.Object3D {
  return cloneSkinned(t.scene);
}

const upgraded = new Map<THREE.Material, THREE.Material>();
// 1x1 flat normal + white albedo so every life material has the same node graph (=> one shared shader program)
const FLAT_N = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
FLAT_N.needsUpdate = true;
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.colorSpace = THREE.SRGBColorSpace;
WHITE.needsUpdate = true;

/**
 * glTF material -> the kit's single shared material graph (MeshStandardNodeMaterial): atlas albedo x tint,
 * height-based hem/hoof grime, engine weathering (rain darkening, snow). Everything that differs per asset is a
 * texture or a uniform, so all people and animals compile to one program (plus one alpha-cutout variant).
 */
export function upgrade(src: THREE.Material, fur = false): THREE.Material {
  const hit = upgraded.get(src);
  if (hit) return hit;
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = s.name;
  m.side = THREE.FrontSide;
  const cutout = !!s.map && (s.alphaTest > 0 || s.transparent) && !/body|low-poly|eyes|LOD/.test(s.name ?? '');
  const mapTex = s.map ?? WHITE;
  const tint = uniform(new THREE.Color().copy(s.color ?? new THREE.Color(1, 1, 1)));
  const grimeH = uniform(fur ? 0.3 : 0.4);
  const rough = uniform(Math.max(0.55, s.roughness ?? 0.85));
  const tex: N = texture(mapTex, uv());
  const lift: N = smoothstep(float(0.0), grimeH, positionLocal.y);
  const base: N = tex.rgb.mul(tint).mul(mix(vec3(0.66, 0.6, 0.53), vec3(1, 1, 1), lift));
  m.colorNode = weatherColor(base, { porosity: 0.5, exposure: 0.7 });
  m.normalMap = s.normalMap ?? FLAT_N;
  m.roughnessNode = rough;
  m.metalnessNode = float(0);
  if (cutout) {
    m.opacityNode = tex.a;
    m.alphaTest = 0.4;
    m.alphaToCoverage = true;
  }
  upgraded.set(src, m);
  return m;
}

/** Group the skinned meshes of an instance by LOD level from their names (*_LOD0[_part], *_LOD1, *_LOD2). */
export function lodLevels(root: THREE.Object3D): THREE.Object3D[][] {
  const levels: THREE.Object3D[][] = [[], [], []];
  root.traverse((o) => {
    const m = /_LOD(\d)/.exec(o.name);
    if (m && (o as THREE.Mesh).isMesh) levels[Number(m[1])].push(o);
  });
  return levels;
}
