// Homestead kit: frame house + barn (photoreal glb, baked PBR). See README.md.
// Both: metres, +Y up, front +Z, origin at the footprint centre on the ground.
import * as THREE from 'three/webgpu';
import { texture, uv, attribute, float } from 'three/tsl';
import { weatherColor } from '../../engine/tsl';
import { loadGLB, byName } from './loader';

export interface FrameHouse {
  root: THREE.Object3D;
  /** front door leaf: origin on the hinge axis (left jamb), rotate about local Y to swing it (negative = inward) */
  door: THREE.Object3D;
  /** back door leaf, same convention */
  backDoor: THREE.Object3D;
}

/** Two-storey 1890s farmhouse: 7.6 x 6.2 m walls (+0.4 m eaves, 2.05 m front porch), ridge 8 m, chimney top 9 m. */
export async function loadFrameHouse(): Promise<FrameHouse> {
  const root = await loadGLB('frame_house', [45, 140]);
  return { root, door: byName(root, 'Door')!, backDoor: byName(root, 'DoorBack')! };
}

export type BarnPaint = 'red' | 'grey';

export interface Barn {
  root: THREE.Object3D;
  /** big front doors (two hinged leaves, origins on their hinges) */
  doors: THREE.Object3D[];
  /** hayloft door (origin on its hinge), shown swung open */
  hayloftDoor: THREE.Object3D;
  setPaint(p: BarnPaint): Promise<void>;
}

const greyCache = new Map<string, Promise<THREE.Texture>>();
function greyMap(file = 'barn_walls_grey_col.webp'): Promise<THREE.Texture> {
  let p = greyCache.get(file);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}world/assets/homestead/${file}`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.anisotropy = 8;
      return t;
    });
    greyCache.set(file, p);
  }
  return p;
}

let strawMat: THREE.MeshStandardNodeMaterial | null = null;
function strawMaterial(): THREE.MeshStandardNodeMaterial {
  if (!strawMat) {
    strawMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    strawMat.name = 'Straw';
    strawMat.colorNode = weatherColor(attribute('color', 'vec4').rgb, { porosity: 0.6 });
    strawMat.roughnessNode = float(0.75);
  }
  return strawMat;
}

/** Board-and-batten barn, 9 x 13 m walls (gable end with doors faces +Z), ridge 7.6 m (hay hood 0.95 m over the front), with loose hay inside. */
export async function loadBarn(paint: BarnPaint = 'red'): Promise<Barn> {
  const root = await loadGLB('barn', [55, 160]);
  const doors: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (/^Door[LR]$/.test(o.name)) doors.push(o);
  });
  // loose straw stalks + hay rope carry their colour per vertex (COLOR_0)
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && /^Straw/.test(m.name)) m.material = strawMaterial();
  });
  let redMat: THREE.Material | null = null;
  let greyMat: Promise<THREE.Material> | null = null;
  let redDoorMat: THREE.Material | null = null;
  let greyDoorMat: Promise<THREE.Material> | null = null;
  const barn: Barn = {
    root,
    doors,
    hayloftDoor: byName(root, 'HayloftDoor')!,
    async setPaint(p: BarnPaint) {
      const walls = byName(root, 'Walls') as THREE.Mesh | undefined;
      const leaves = [...doors, byName(root, 'HayloftDoor')].filter((o): o is THREE.Mesh => !!o && (o as THREE.Mesh).isMesh);
      if (!walls || !walls.isMesh) return;
      redMat ??= walls.material as THREE.Material;
      redDoorMat ??= leaves[0]?.material as THREE.Material;
      if (p === 'red') {
        walls.material = redMat;
        for (const l of leaves) l.material = redDoorMat!;
        return;
      }
      // same node graph as the baked red materials (shared ORM + normal), only the base colour differs
      const variant = (src: THREE.Material, file: string, name: string) =>
        greyMap(file).then((g) => {
          const m = (src as THREE.MeshStandardNodeMaterial).clone();
          m.colorNode = weatherColor(texture(g, uv()).rgb, { porosity: 0.8 });
          m.name = name;
          return m;
        });
      greyMat ??= variant(redMat, 'barn_walls_grey_col.webp', 'M_BarnWalls_grey');
      if (redDoorMat) greyDoorMat ??= variant(redDoorMat, 'barn_doors_grey_col.webp', 'M_BarnWood_grey');
      walls.material = await greyMat;
      if (greyDoorMat) {
        const gm = await greyDoorMat;
        for (const l of leaves) l.material = gm;
      }
    },
  };
  if (paint === 'grey') await barn.setPaint('grey');
  return barn;
}

/** Items reviewable in lookdev.html?kit=homestead&item=<name> */
export const lookdev: Record<string, () => Promise<THREE.Object3D>> = {
  frame_house: async () => (await loadFrameHouse()).root,
  barn: async () => (await loadBarn('red')).root,
  barn_grey: async () => (await loadBarn('grey')).root,
};
