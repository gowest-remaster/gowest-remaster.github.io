// Town kit interiors: the Farmers State Bank (1890s) and the grain elevator office.
// Geometry is built in Blender (tools/blender/town/build_bank_interior.py, build_elevator_office.py) and ships as
// interiors/bank.glb and interiors/elevator_office.glb. Materials bind by semantic name (see ../materials.ts plus
// the kinds registered here). Each set exports empties: light_* (lamp flames), sun_* (window centres) and pick proxies.
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, float, mix, smoothstep, normalMap, clamp, positionWorld, uniform, max } from 'three/tsl';
import { InteriorSet, windowSun, oilLamp } from '../../../interiors/base';
import { pending } from '../../../engine/tex';
import { tnoise } from '../../../engine/tsl';
import { registerTownMaterial, surface, townTex, vcol, townTexturesReady } from '../materials';
import { loadTownGLB } from '../loader';

/** Lamp glow on shades/chimneys of the interior lamps (1 = lit). */
export const uInteriorLamps = uniform(1);

// ------------------------------------------------------------------------------------------------ materials
function std(o: { color?: THREE.ColorRepresentation; rough?: number; metal?: number; side?: THREE.Side } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: o.color ?? 0xffffff, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, side: o.side ?? THREE.FrontSide });
  m.aoNode = vcol().r;
  return m;
}

/** Texture with 0..1 UVs (paper, dials, atlases). */
function mapped(path: string, rough = 0.85, clampEdges = true): THREE.MeshStandardNodeMaterial {
  const t = townTex(path, true);
  if (clampEdges) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const m = std({ rough });
  m.colorNode = texture(t, uv()).rgb;
  return m;
}

/** Gold-leaf sign: metal where the texture is gold-coloured, glossy black lacquer elsewhere. */
function gilt(path: string): THREE.MeshStandardNodeMaterial {
  const t = townTex(path, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const m = std();
  const c = texture(t, uv());
  const gold = smoothstep(0.08, 0.2, c.r.sub(c.b));
  m.colorNode = mix(c.rgb, c.rgb.mul(1.25), gold);
  m.metalnessNode = gold;
  m.roughnessNode = mix(float(0.18), float(0.3), gold);
  return m;
}

/** Overexposed street/sky seen through the windows (interior photography look), never lit. */
function outside(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const p = positionWorld;
  // across the street: sunlit false fronts (warm, a little darker) under a bright hazy sky, all slightly out of focus
  const along = p.x.add(p.z);
  const roof = float(3.3).add(tnoise(vec2(along.mul(0.35), 3.1)).mul(1.6)).add(tnoise(vec2(along.mul(1.7), 7.3)).step(0.55).mul(0.5));
  const sky = vec3(2.5, 2.45, 2.35).mul(float(0.92).add(tnoise(p.xy.mul(0.4)).mul(0.12)));
  const bldg = mix(vec3(1.25, 1.05, 0.8), vec3(1.6, 1.42, 1.15), tnoise(vec2(along.mul(0.9), p.y.mul(0.6))));
  const street = vec3(1.5, 1.3, 1.0);
  const k = smoothstep(roof.sub(0.15), roof.add(0.15), p.y);
  const c = mix(mix(street, bldg, smoothstep(1.0, 1.4, p.y)), sky, k);
  m.colorNode = c.mul(float(0.9).add(tnoise(p.xz.mul(2.3).add(p.y)).mul(0.15)));
  return m;
}

function glassPhys(rough: number, tint: THREE.ColorRepresentation = 0xffffff, transmission = 1): THREE.MeshPhysicalNodeMaterial {
  return new THREE.MeshPhysicalNodeMaterial({ color: tint, roughness: rough, metalness: 0, transmission, ior: 1.5, thickness: 0.003, side: THREE.DoubleSide });
}

function lampShade(): THREE.MeshStandardNodeMaterial {
  const m = std({ color: 0xf4eee2, rough: 0.3, side: THREE.DoubleSide });
  m.emissiveNode = vec3(1.0, 0.62, 0.3).mul(uInteriorLamps.mul(1.6));
  return m;
}

let registered = false;
function registerMaterials(): void {
  if (registered) return;
  registered = true;
  const I = { grime: 0, exposure: 0 } as const;
  registerTownMaterial('mahog', () => surface({ tex: 'lacquered_cherry_wood', tile: 1.1, tint: 0xe0906a, roughMul: 0.45, vary: 0.08, ...I }));
  registerTownMaterial('bank_floor', () => surface({ tex: 'old_wood_floor', tile: 2.4, tint: 0xb48a66, roughMul: 0.55, vary: 0.06, ...I }));
  registerTownMaterial('iplaster', () => surface({ tex: 'painted_plaster', tile: 2.0, tint: 0xe2d6bc, vary: 0.04, ...I }));
  registerTownMaterial('marble', () => surface({ tex: 'marble', tile: 1.3, roughMul: 0.2, vary: 0.04, ...I }));
  registerTownMaterial('marble_dark', () => surface({ tex: 'marble_dark', tile: 1.0, roughMul: 0.25, vary: 0.04, ...I }));
  registerTownMaterial('leather', () => surface({ tex: 'brown_leather', tile: 0.5, tint: 0xa07050, ...I }));
  registerTownMaterial('leather_green', () => surface({ tex: 'brown_leather', tile: 0.4, tint: 0x6a9a58, saturation: 0.35, ...I }));
  registerTownMaterial('bentwood', () => surface({ tex: 'dark_wood', tile: 0.5, tint: 0x7a4a30, roughMul: 0.55, ...I }));
  registerTownMaterial('cane', () => surface({ tex: 'hessian_230', tile: 0.2, tint: 0xd8b070, ...I }));
  registerTownMaterial('wallpaper', () => {
    const m = std({ rough: 0.82 });
    const t = townTex('tex/bank_wallpaper_c.webp', true);
    m.colorNode = texture(t, uv().mul(1 / 0.53)).rgb.mul(float(1).add(vcol().b.sub(0.5).mul(0.06)));
    m.aoNode = mix(float(1), vcol().r, 0.8);
    return m;
  });
  registerTownMaterial('tin', () => {
    const m = std({ rough: 0.42, metal: 0.15 });
    const u = uv().mul(1 / 0.61);
    m.colorNode = texture(townTex('tex/bank_tin_c.webp', true), u).rgb;
    m.normalNode = normalMap(texture(townTex('tex/bank_tin_n.webp', false), u), vec2(1.4, 1.4));
    return m;
  });
  registerTownMaterial('bledger', () => mapped('tex/bank_ledgers_c.webp', 0.6, false));
  registerTownMaterial('bpaper', (arg) => mapped(`tex/${arg}.webp`, 0.88));
  registerTownMaterial('epaper', (arg) => mapped(`tex/${arg}.webp`, 0.9));
  registerTownMaterial('gsign', (arg) => gilt(`tex/${arg}.webp`));
  registerTownMaterial('paper_edge', () => std({ color: 0xd9cdb0, rough: 0.92 }));
  registerTownMaterial('pen', () => std({ color: 0x141210, rough: 0.35 }));
  registerTownMaterial('coin', () => std({ color: 0xcfcfc6, rough: 0.32, metal: 1 }));
  registerTownMaterial('nickel', () => std({ color: 0xa4a49e, rough: 0.32, metal: 1 }));
  registerTownMaterial('gilt_frame', () => std({ color: 0xb8903e, rough: 0.35, metal: 1 }));
  registerTownMaterial('castiron', () => surface({ tex: 'rusty_metal_02', tile: 0.6, tint: 0x3a3a3c, saturation: 0.2, metal: 0.6, roughMul: 0.7, ...I }));
  registerTownMaterial('bclock_back', () => std({ color: 0x2a160c, rough: 0.5 }));
  registerTownMaterial('glass_ink', () => glassPhys(0.04, 0x334038, 0.6));
  registerTownMaterial('frost', () => glassPhys(0.55, 0xf0f0ea, 0.85));
  registerTownMaterial('lamp_chimney', () => glassPhys(0.02, 0xffffff, 1));
  registerTownMaterial('lamp_shade', () => lampShade());
  registerTownMaterial('bwin_out', () => outside());
  registerTownMaterial('pick', () => new THREE.MeshBasicNodeMaterial({ visible: false }));
  registerTownMaterial('xpbr', (arg) => surface({ tex: arg, tile: 1, ...I, vary: 0, ao: 1 }));
  // elevator office
  registerTownMaterial('iwood', () => surface({ tex: 'rough_wood', swap: true, tile: 1.3, tint: 0xc0aa8c, saturation: 0.7, vary: 0.22, ...I }));
  registerTownMaterial('iplanks', () => surface({ tex: 'weathered_brown_planks', tile: 2.2, tint: 0xf0d8b0, saturation: 0.75, ...I }));
  registerTownMaterial('ifloor', () => surface({ tex: 'old_wood_floor', tile: 2.2, tint: 0xa89070, roughMul: 1.1, ...I }));
  registerTownMaterial('grain', () => {
    const m = surface({ tex: 'hessian_230', tile: 0.06, tint: 0xc8a468, saturation: 0.6, roughMul: 1.1, ...I });
    return m;
  });
  registerTownMaterial('dust', () => {
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 1 });
    const n = tnoise(positionWorld.xz.mul(2.2)).mul(0.6).add(tnoise(positionWorld.xz.mul(9.0)).mul(0.4));
    const u = uv();
    const edge = smoothstep(0.0, 0.35, u.x.min(u.x.oneMinus()).min(u.y).min(u.y.oneMinus()));
    m.colorNode = vec3(0.56, 0.47, 0.32);
    m.opacityNode = clamp(n.sub(0.3).mul(1.2), 0, 0.32).mul(edge);
    return m;
  });
  registerTownMaterial('chalk', () => mapped('tex/elev_chalk_c.webp', 0.95));
  registerTownMaterial('iwood_dark', () => surface({ tex: 'rough_wood', swap: true, tile: 1.2, tint: 0x8a6a4c, saturation: 0.8, vary: 0.15, ...I }));
  registerTownMaterial('glass_dusty', () => {
    const m = glassPhys(0.12, 0xe8e2d0, 0.75);
    const gm = texture(townTex('tex/grime_m.webp', false), positionWorld.zy.mul(0.6));
    m.roughnessNode = float(0.1).add(gm.g.mul(0.35)).add(gm.b.mul(0.1));
    return m;
  });
  registerTownMaterial('chalk_stick', () => std({ color: 0xf2f0e8, rough: 0.95 }));
  registerTownMaterial('felt', () => std({ color: 0x3a3a3a, rough: 1 }));
  registerTownMaterial('zinc', () => std({ color: 0x9a9a94, rough: 0.5, metal: 0.8 }));
  registerTownMaterial('coal', () => std({ color: 0x101010, rough: 0.6 }));
  registerTownMaterial('sack', () => surface({ tex: 'hessian_230', tile: 0.35, tint: 0xc8b48c, saturation: 0.5, ...I }));
  registerTownMaterial('twine', () => std({ color: 0xa08a60, rough: 0.9 }));
  registerTownMaterial('tinware', () => std({ color: 0xb0b0aa, rough: 0.35, metal: 0.9 }));
  registerTownMaterial('basket', () => surface({ tex: 'hessian_230', tile: 0.12, tint: 0xb08850, ...I }));
  registerTownMaterial('broomstraw', () => surface({ tex: 'hessian_230', tile: 0.1, tint: 0xd8b878, ...I }));
  const grainMat = (tint: number, tile: number) => () => surface({ tex: 'hessian_230', tile, tint, saturation: 0.9, roughMul: 1.1, ...I });
  registerTownMaterial('grain_oats', grainMat(0xe6d6a0, 0.05));
  registerTownMaterial('grain_corn', grainMat(0xe0a838, 0.09));
  registerTownMaterial('grain_barley', grainMat(0xd8c080, 0.05));
  registerTownMaterial('ebeam', () => {
    const m = mapped('tex/elev_beam_c.webp', 0.35);
    m.metalnessNode = float(0.85);
    return m;
  });
}

// ------------------------------------------------------------------------------------------------ set loading
interface Loaded {
  root: THREE.Object3D;
  lights: THREE.Vector3[];
  suns: THREE.Vector3[];
  picks: Map<string, THREE.Object3D>;
}

async function loadSet(path: string): Promise<Loaded> {
  registerMaterials();
  const root = await loadTownGLB(path, 0.2);
  root.updateMatrixWorld(true);
  const lights: THREE.Vector3[] = [];
  const suns: THREE.Vector3[] = [];
  const picks = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name.startsWith('light_')) lights.push(o.getWorldPosition(new THREE.Vector3()));
    else if (o.name.startsWith('sun_')) suns.push(o.getWorldPosition(new THREE.Vector3()));
    else if (o.name.startsWith('pick_')) picks.set(o.name.slice(5), o);
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const name = (m.material as THREE.Material).name ?? '';
      m.castShadow = !/glass|chimney|frost|bwin_out|dust|pick/.test(name);
      m.receiveShadow = true;
    }
  });
  await townTexturesReady();
  return { root, lights, suns, picks };
}

/** Procedural warm room environment (equirect, HDR) so glossy wood, brass and marble reflect a lamp-lit room and
 *  bright windows instead of the outdoor sky HDRI (which turns every interior blue-grey). */
function interiorEnv(o: { floor: [number, number, number]; wall: [number, number, number]; ceil: [number, number, number]; windows: { az: number; el: number; w: number; h: number; k: number }[]; lamps?: number }): THREE.DataTexture {
  const W = 256;
  const H = 128;
  const data = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const el = (v - 0.5) * Math.PI; // -pi/2..pi/2
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      const az = (u - 0.5) * 2 * Math.PI; // three equirect: atan2(dir.z, dir.x)
      const sy = Math.sin(el);
      let c: [number, number, number];
      if (sy < -0.35) c = o.floor;
      else if (sy > 0.55) c = o.ceil;
      else c = o.wall;
      c = [c[0], c[1], c[2]];
      // lamp glow band near the ceiling
      const lk = (o.lamps ?? 0.4) * Math.exp(-((sy - 0.75) ** 2) / 0.02);
      c[0] += lk * 1.0;
      c[1] += lk * 0.62;
      c[2] += lk * 0.3;
      for (const w of o.windows) {
        let d = az - w.az;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) < w.w / 2 && Math.abs(el - w.el) < w.h / 2) {
          c[0] += 2.6 * w.k;
          c[1] += 2.35 * w.k;
          c[2] += 2.0 * w.k;
        }
      }
      const k = (j * W + i) * 4;
      data[k] = c[0];
      data[k + 1] = c[1];
      data[k + 2] = c[2];
      data[k + 3] = 1;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

abstract class TownInterior extends InteriorSet {
  /** own warm environment; the world's sky env is ignored */
  protected roomEnv: THREE.Texture | null = null;
  setEnvironment(_t: THREE.Texture): void {
    if (!this.roomEnv) return;
    this.scene.environment = this.roomEnv;
    this.scene.environmentIntensity = this.envIntensity;
  }

  protected lamps: ((t: number) => void)[] = [];
  ready: Promise<void>;
  private readonly pickIds: string[];
  constructor(path: string, pickIds: string[]) {
    super();
    this.pickIds = pickIds;
    this.ready = loadSet(path).then((l) => this.setup(l));
    pending.push(this.ready.catch((e) => console.warn('town interior failed', path, e)));
  }

  private setup(l: Loaded): void {
    this.scene.add(l.root);
    for (const id of this.pickIds) {
      const o = l.picks.get(id);
      if (o) this.prop(id, o);
    }
    this.dress(l);
  }

  protected abstract dress(l: Loaded): void;

  update(t: number, dt: number, idle: boolean): void {
    for (const f of this.lamps) f(t);
    super.update(t, dt, idle);
  }
}

/** Farmers State Bank interior. Clickable props: 'teller' (cashier window), 'loans' (loan window). */
export class TownBankInterior extends TownInterior {
  constructor() {
    super('interiors/bank.glb', ['teller', 'loans']);
    // west windows on the left (three -x: az = pi), street windows behind the camera (+z: az = pi/2)
    this.roomEnv = interiorEnv({ floor: [0.16, 0.08, 0.045], wall: [0.13, 0.11, 0.06], ceil: [0.5, 0.42, 0.32], windows: [{ az: Math.PI, el: 0.25, w: 0.5, h: 0.9, k: 1 }, { az: Math.PI / 2, el: 0.2, w: 0.7, h: 0.8, k: 0.8 }], lamps: 0.5 });
    this.shot = { pos: new THREE.Vector3(3.05, 1.62, 4.35), look: new THREE.Vector3(-0.9, 1.55, -1.2), fov: 54 };
    this.exposure = 1.35;
    this.envIntensity = 0.9;
    this.setEnvironment(this.roomEnv!);
  }

  protected dress(l: Loaded): void {
    for (const p of l.lights) this.lamps.push(oilLamp(this.scene, p, 9, p.y > 2));
    // afternoon sun through the west (left) windows: three.js -x
    for (const c of l.suns.filter((s) => s.x < -3)) windowSun(this.scene, c, new THREE.Vector3(-1, 0.55, 0.42), 1.05, 2.3, new THREE.Vector3(1, 0, 0), 5);
    // bounce from the warm floor/wainscot (the sky IBL alone turns everything blue-grey indoors)
    const hemi = new THREE.HemisphereLight(0xffe6c4, 0x8a5434, 0.85);
    this.scene.add(hemi);
  }
}

/** Grain elevator office. Clickable props: 'scale' (beam scale), 'prices' (chalkboard). */
export class ElevatorOfficeInterior extends TownInterior {
  constructor() {
    super('interiors/elevator_office.glb', ['scale', 'prices']);
    this.roomEnv = interiorEnv({ floor: [0.14, 0.09, 0.05], wall: [0.16, 0.11, 0.07], ceil: [0.12, 0.08, 0.05], windows: [{ az: Math.PI, el: 0.2, w: 0.45, h: 0.5, k: 1 }, { az: 0, el: 0.2, w: 0.3, h: 0.45, k: 0.7 }], lamps: 0.35 });
    this.shot = { pos: new THREE.Vector3(1.65, 1.62, 1.75), look: new THREE.Vector3(-1.2, 1.25, -0.9), fov: 62 };
    this.exposure = 1.5;
    this.envIntensity = 0.9;
    this.setEnvironment(this.roomEnv!);
  }

  protected dress(l: Loaded): void {
    for (const p of l.lights) this.lamps.push(oilLamp(this.scene, p, 4.5, true));
    for (const c of l.suns) windowSun(this.scene, c, new THREE.Vector3(-0.9, 0.6, 0.5).normalize(), 0.9, 1.1, new THREE.Vector3(1, 0, 0), 6);
    this.scene.add(new THREE.HemisphereLight(0xffe8c8, 0x6a4628, 0.6));
  }
}

async function preview(make: () => TownInterior): Promise<THREE.Object3D> {
  const s = make();
  await s.ready;
  const g = new THREE.Group();
  for (const c of [...s.scene.children]) g.add(c);
  return g;
}

export const bankLookdev: Record<string, () => Promise<THREE.Object3D>> = {
  bank_interior: () => preview(() => new TownBankInterior()),
  elevator_office: () => preview(() => new ElevatorOfficeInterior()),
};
void max;
