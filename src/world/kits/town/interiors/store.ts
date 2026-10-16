// General store interior (Longview, Kansas, 1880s-1890s): photoreal set built in Blender by
// tools/blender/town/build_store_interior.py -> public/world/assets/town/interiors/store.glb.
// Plank floor and board walls with baked vertex AO, floor-to-ceiling shelving of labelled tins/boxes/jars/bottles
// (period label atlas tex/store_labels.webp), bolts of cloth, burlap sacks (tex/store_sacks.webp), tools hanging on
// the wall, pickle + cracker barrels, a pot-bellied stove with a checkers barrel, the counter with a brass beam scale,
// candy jars, coffee mill, catalogue and (from 1890) a National-style cash register. CC0 Poly Haven + CC-BY
// Sketchfab scans keep their own textures (materials `emb_*`); everything else is bound here (`st_*`).
// Room space (three.js): floor y=0, x -5.3..5.3, back wall z=-5, front windows z=+5 behind the camera.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { texture, uv, vec2, vec3, float, mix, smoothstep, attribute, normalMap, fract, floor, sin, clamp, luminance, uniform, positionWorld, max } from 'three/tsl';
import { InteriorSet, windowSun, oilLamp } from '../../../interiors/base';
import { pending } from '../../../engine/tex';
import { registerTownMaterial, townMaterial, townTex, texSet, U, UC } from '../materials';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const BASE = `${import.meta.env.BASE_URL}world/assets/town/`;
const vcol = (): N => attribute('color', 'vec4');
const hash = (x: N): N => fract(sin(x.mul(127.1).add(311.7)).mul(43758.5453));
/** Lamp flame brightness (flicker) shared by shades, chimneys and the stove's mica window. */
const uFlame = uniform(1);
/** Brightness of the daylight seen through the windows (setHour). */
const uWindow = uniform(1);

// ------------------------------------------------------------------ materials (interior: no rain/snow weathering)
interface IOpts {
  tex: string;
  tile?: number;
  swap?: boolean;
  tint?: THREE.ColorRepresentation;
  sat?: number;
  roughMul?: number;
  roughAdd?: number;
  metal?: number;
  normalScale?: number;
  vary?: number;
  /** darken albedo in occluded corners (cheap bounce-light falloff) */
  aoAlbedo?: number;
  dust?: number;
  side?: THREE.Side;
}
function ist(o: IOpts): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: o.side ?? THREE.FrontSide });
  const s = texSet(o.tex);
  const v = vcol();
  const u0 = uv();
  const u = mix(u0, vec2(u0.y, u0.x), U(o.swap ? 1 : 0)).mul(U(1 / (o.tile ?? 1.2)));
  let base: N = texture(s.c, u).rgb;
  base = mix(vec3(luminance(base)), base, U(o.sat ?? 1));
  base = base.mul(UC(o.tint ?? 0xffffff)).mul(float(1).add(v.b.sub(0.5).mul(U((o.vary ?? 0.2) * 2))));
  // dust settles in corners / under shelves: a dull, slightly lighter film over the wood
  base = mix(base, base.mul(0.75).add(vec3(0.012, 0.009, 0.006)), v.g.mul(U(o.dust ?? 0.25)));
  base = base.mul(mix(float(1), v.r, U(o.aoAlbedo ?? 0.35)));
  m.colorNode = base;
  const arm = texture(s.r, u);
  m.roughnessNode = arm.g.mul(U(o.roughMul ?? 1)).add(U(o.roughAdd ?? 0)).clamp(0.05, 1);
  m.metalnessNode = U(o.metal ?? 0);
  const ns = U(o.normalScale ?? 1);
  m.normalNode = normalMap(texture(s.n, u), vec2(ns, ns));
  m.aoNode = v.r.pow(1.4).mul(mix(float(1), arm.r, 0.5));
  return m;
}

function flat(color: THREE.ColorRepresentation, rough: number, metal = 0, o: { emissive?: N; noise?: number } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const v = vcol();
  const n: N = U(o.noise ?? 0.15);
  const nz = hash(floor(positionWorld.x.mul(37)).add(floor(positionWorld.y.mul(41)).mul(7.1)).add(floor(positionWorld.z.mul(29)).mul(3.3)));
  m.colorNode = UC(color).mul(float(1).add(v.b.sub(0.5).mul(0.2))).mul(float(1).sub(n.mul(0.5)).add(nz.mul(n)));
  m.roughnessNode = U(rough).add(nz.sub(0.5).mul(0.12)).clamp(0.04, 1);
  m.metalnessNode = U(metal);
  m.aoNode = v.r.pow(1.4);
  if (o.emissive) m.emissiveNode = o.emissive;
  return m;
}

function glassMat(color: THREE.ColorRepresentation, rough = 0.02, transmission = 1): THREE.MeshPhysicalNodeMaterial {
  return new THREE.MeshPhysicalNodeMaterial({ color, roughness: rough, metalness: 0, transmission, ior: 1.5, thickness: 0.004, specularIntensity: 1, side: THREE.DoubleSide });
}

function goodsMat(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const v = vcol();
  const c = texture(townTex('tex/store_labels.webp', true), uv());
  const paper = c.a;
  m.colorNode = mix(c.rgb, vec3(0.2, 0.16, 0.11), v.g.mul(0.2)).mul(mix(float(1), v.r, 0.3));
  m.metalnessNode = float(1).sub(paper).mul(0.9);
  m.roughnessNode = mix(float(0.32), float(0.62), paper).add(hash(v.b.mul(91)).mul(0.12));
  m.aoNode = v.r.pow(1.3);
  return m;
}

function sackMat(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const v = vcol();
  const h = texSet('hessian_230');
  m.colorNode = texture(townTex('tex/store_sacks.webp', true), uv()).rgb.mul(mix(float(1), v.r, 0.4)).mul(float(0.9).add(v.b.mul(0.2)));
  m.normalNode = normalMap(texture(h.n, uv().mul(9)), vec2(1.2, 1.2));
  m.roughnessNode = float(0.92);
  m.aoNode = v.r.pow(1.3);
  return m;
}

function clothMat(hex: string, pattern: string): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const v = vcol();
  const C: N = UC(`#${hex}`);
  const set = texSet(pattern === 'gingham' ? 'gingham_check' : 'rough_linen');
  const t = texture(set.c, uv().mul(pattern === 'gingham' ? 1.6 : 2.4));
  let c: N;
  if (pattern === 'gingham') c = mix(C, vec3(0.86, 0.84, 0.78), smoothstep(0.35, 0.75, luminance(t.rgb)));
  else c = C.mul(luminance(t.rgb).mul(1.8).clamp(0.6, 1.3));
  m.colorNode = c.mul(float(0.92).add(v.b.mul(0.16))).mul(mix(float(1), v.r, 0.45));
  m.normalNode = normalMap(texture(set.n, uv().mul(2.4)), vec2(0.8, 0.8));
  m.roughnessNode = float(0.88);
  m.aoNode = v.r.pow(1.3);
  return m;
}

function checkerMat(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const v = vcol();
  const q = floor(uv().add(0.21).div(0.0525));
  const par = fract(q.x.add(q.y).mul(0.5)).mul(2);
  const inside = smoothstep(0.0, 0.002, uv().x.add(0.21)).mul(smoothstep(0.42, 0.418, uv().x.add(0.21)));
  m.colorNode = mix(vec3(0.42, 0.06, 0.04), vec3(0.03, 0.025, 0.02), par).mul(inside.mul(0.6).add(0.4));
  m.roughnessNode = float(0.4);
  m.aoNode = v.r;
  return m;
}

function emissive(color: [number, number, number], k: N): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = uniform(new THREE.Vector3(...color)).mul(k);
  return m;
}

let registered = false;
function registerStoreMaterials(): void {
  if (registered) return;
  registered = true;
  const kinds: Record<string, (arg: string) => THREE.Material> = {
    st_floor: () => ist({ tex: 'wood_table_worn', tile: 1.6, tint: 0x8a6448, sat: 0.85, roughMul: 0.95, vary: 0.28, aoAlbedo: 0.45, dust: 0.45 }),
    st_wall: () => ist({ tex: 'fine_grained_wood', swap: true, tile: 1.8, tint: 0xb08058, sat: 0.9, vary: 0.22, aoAlbedo: 0.5 }),
    st_paint_red: () => {
      const m = ist({ tex: 'fine_grained_wood', swap: true, tile: 1.8, tint: 0xffffff, vary: 0.15, aoAlbedo: 0.5 });
      const base = m.colorNode as N;
      m.colorNode = mix(base.mul(vec3(1.1, 0.35, 0.28)), vec3(0.32, 0.055, 0.04), 0.7).mul(mix(float(1), vcol().r, 0.4));
      return m;
    },
    st_ceiling: () => ist({ tex: 'dark_wood', tile: 2.0, tint: 0x9a7a5e, aoAlbedo: 0.55 }),
    st_beam: () => ist({ tex: 'rough_wood', swap: true, tile: 1.4, tint: 0xa07850, sat: 0.7, aoAlbedo: 0.45 }),
    st_shelf: () => ist({ tex: 'fine_grained_wood', swap: true, tile: 1.3, tint: 0x8a5c3c, vary: 0.18, aoAlbedo: 0.45, roughMul: 0.85 }),
    st_counter: () => ist({ tex: 'dark_wood', tile: 1.4, tint: 0xc09070, roughMul: 0.7, aoAlbedo: 0.4 }),
    st_top: () => ist({ tex: 'wood_table_worn', tile: 1.3, tint: 0xb88a62, roughMul: 0.65, aoAlbedo: 0.3, dust: 0.1 }),
    st_iron: () => flat(0x22201e, 0.42, 0.55, { noise: 0.12 }),
    st_carton: () => {
      const m = flat(0x8a6a48, 0.85, 0, { noise: 0.1 });
      const v = vcol();
      m.colorNode = mix(vec3(0.34, 0.24, 0.15), vec3(0.62, 0.52, 0.38), v.b).mul(mix(float(1), v.r, 0.45));
      return m;
    },
    st_sign: () => {
      const m = new THREE.MeshStandardNodeMaterial();
      const t = townTex('tex/store_sign.webp', true);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      const c = texture(t, uv());
      m.colorNode = c.rgb;
      // gilt letters: metallic where the texture is gold
      const gold = smoothstep(0.25, 0.45, c.r.sub(c.b));
      m.metalnessNode = gold.mul(0.9);
      m.roughnessNode = mix(float(0.85), float(0.32), gold);
      m.aoNode = vcol().r;
      return m;
    },
    st_nickel: () => flat(0xc4c0b6, 0.16, 1, { noise: 0.08 }),
    st_brass: () => flat(0xc89848, 0.28, 1, { noise: 0.25 }),
    st_tin: () => flat(0x9a9a96, 0.32, 0.85, { noise: 0.2 }),
    st_red_iron: () => flat(0x6e0f0a, 0.32, 0.1, { noise: 0.15 }),
    st_goods: () => goodsMat(),
    st_glass: () => glassMat(0xeef4ee, 0.02),
    st_amber: () => glassMat(0x8a4a10, 0.06, 0.85),
    st_bottle_green: () => glassMat(0x2f5a32, 0.06, 0.85),
    st_bottle_clear: () => glassMat(0xd8e4dc, 0.04, 0.95),
    st_lamp_glass: () => glassMat(0xfff4e0, 0.02),
    st_shade: () => {
      const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
      m.colorNode = vec3(0.86, 0.84, 0.8);
      m.roughnessNode = float(0.25);
      m.emissiveNode = vec3(1.0, 0.62, 0.3).mul(uFlame.mul(0.9));
      return m;
    },
    st_flame: () => emissive([9, 4.2, 1.2], uFlame),
    st_window: () => {
      const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      m.colorNode = mix(vec3(1.0, 0.9, 0.76), vec3(0.75, 0.85, 1.0), uv().y.clamp(0, 1)).mul(uWindow.mul(0.75));
      return m;
    },
    st_sack: () => sackMat(),
    st_cloth: (arg) => {
      const [hex, pattern] = arg.split(':');
      return clothMat(hex ?? '888888', pattern ?? 'plain');
    },
    st_paper: () => flat(0x8a6a44, 0.85, 0, { noise: 0.1 }),
    st_checker: () => checkerMat(),
    st_cracker: () => flat(0xc8a46c, 0.85, 0, { noise: 0.35 }),
    st_sand: () => ist({ tex: 'brown_mud_02', tile: 0.8, tint: 0xc8a882, sat: 0.6, aoAlbedo: 0.3 }),
    st_twine: () => flat(0x9a8058, 0.9, 0, { noise: 0.2 }),
    st_apple: () => {
      const m = flat(0x7a1410, 0.38, 0, { noise: 0.5 });
      const v = vcol();
      m.colorNode = mix(vec3(0.42, 0.05, 0.03), vec3(0.45, 0.32, 0.06), smoothstep(0.7, 0.95, v.b)).mul(float(0.8).add(v.a.mul(0.4))).mul(v.r);
      return m;
    },
    st_potato: () => flat(0x7a5a38, 0.9, 0, { noise: 0.6 }),
  };
  for (const [k, f] of Object.entries(kinds)) registerTownMaterial(k, (arg) => f(arg));
}

// ------------------------------------------------------------------ loading
/** Photoscan fix-ups: scans bake lighting-free albedo but some come without PBR metal/rough or with stray emissive. */
function tuneScan(m: THREE.MeshStandardMaterial): THREE.Material {
  if (m.name.startsWith('emb_register')) {
    // nickel-plated brass National register: metallic, a little tarnish
    m.metalness = 0.85;
    m.roughness = 0.38;
    m.color.setRGB(0.55, 0.5, 0.42);
  }
  if (m.name.startsWith('emb_scale')) {
    m.emissiveMap = null;
    m.emissive.setRGB(0, 0, 0);
  }
  return m;
}

const gltf = new GLTFLoader();
gltf.setMeshoptDecoder(MeshoptDecoder);
let roomPromise: Promise<THREE.Object3D> | null = null;

/** The store room (fresh clone each call). Embedded scan materials (`emb_*`) are kept as authored. */
export function loadStoreRoom(): Promise<THREE.Object3D> {
  registerStoreMaterials();
  if (!roomPromise)
    roomPromise = gltf.loadAsync(`${BASE}interiors/store.glb`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const bound = mats.map((s) => (s.name.startsWith('emb_') ? tuneScan(s as THREE.MeshStandardMaterial) : townMaterial(s.name)));
        m.material = Array.isArray(m.material) ? bound : bound[0];
        const glassy = mats.some((s) => /glass|window|flame|shade/.test(s.name));
        m.castShadow = !glassy;
        m.receiveShadow = true;
      });
      return g.scene;
    });
  return roomPromise.then((r) => r.clone(true));
}

// ------------------------------------------------------------------ room environment
/** Warm interior reflection/bounce environment (equirect HDR): dark ceiling, wood walls and shelving, oiled floor,
 *  bright front display windows (+z) and the side window (+x). Replaces the sky IBL, which would light the room
 *  as if it had no walls. */
function roomEnvironment(): THREE.DataTexture {
  const w = 256;
  const h = 128;
  const data = new Float32Array(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI;
    for (let i = 0; i < w; i++) {
      const a = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      const d = new THREE.Vector3(Math.cos(a) * Math.cos(lat), Math.sin(lat), Math.sin(a) * Math.cos(lat));
      let c: [number, number, number];
      if (d.y > 0.55) c = [0.05, 0.034, 0.022];
      else if (d.y < -0.35) c = [0.075, 0.048, 0.028];
      else {
        const n = 0.8 + rnd() * 0.4;
        c = [0.11 * n, 0.07 * n, 0.04 * n];
        if (d.z < -0.6) c = [0.13 * n, 0.08 * n, 0.045 * n]; // packed shelving, lamp-lit
      }
      // front display windows (sun-lit street) and the side window
      if (d.z > 0.78 && d.y > -0.12 && d.y < 0.42 && Math.abs(d.x) > 0.08) c = [3.2, 2.7, 2.0];
      if (d.x > 0.85 && d.z > 0.15 && d.z < 0.5 && d.y > -0.05 && d.y < 0.4) c = [2.4, 2.2, 1.9];
      // lamp glow up high
      if (d.y > 0.3 && d.y < 0.5 && Math.abs(d.x) < 0.25 && d.z > -0.3 && d.z < 0.2) c = [1.6, 0.9, 0.4];
      const k = (j * w + i) * 4;
      data[k] = c[0];
      data[k + 1] = c[1];
      data[k + 2] = c[2];
      data[k + 3] = 1;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ the interior set
/** Blender (x, y, z) -> three.js (x, z, -y) */
const B = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export class TownStoreInterior extends InteriorSet {
  private lamps: ((t: number) => void)[] = [];
  private counterGroup = new THREE.Group();
  private register: THREE.Object3D | null = null;
  private year = 1893;
  private roomEnv: THREE.DataTexture;
  private suns: THREE.DirectionalLight[] = [];
  private lampLights: THREE.PointLight[] = [];
  private lampScale = 1;
  /** resolves when the glb is in the scene */
  readonly ready: Promise<void>;

  constructor() {
    super();
    // stand inside the front door, looking down the aisle at the counter and the back shelving
    this.shot = { pos: new THREE.Vector3(-0.15, 1.62, 3.95), look: new THREE.Vector3(0.3, 1.28, -4.5), fov: 58 };
    this.exposure = 1.35;
    this.envIntensity = 1.0;
    this.roomEnv = roomEnvironment();
    this.scene.environment = this.roomEnv;
    const s = this.scene;
    this.counterGroup.name = 'counter';
    s.add(this.prop('counter', this.counterGroup));
    // hanging kerosene lamps, the counter lamp and the stove's fire
    for (const [x, y, z] of [[-1.3, 0.6, 2.82], [1.5, 0.6, 2.82], [-0.2, 3.6, 2.87]]) this.lamps.push(oilLamp(s, B(x, y, z), 7, true));
    this.lamps.push(oilLamp(s, B(-2.45, 3.0, 1.5), 2.2, false));
    this.lampLights = s.children.filter((o): o is THREE.PointLight => (o as THREE.PointLight).isPointLight);
    const fire = new THREE.PointLight(0xff6a20, 0.9, 3.5, 2);
    fire.position.copy(B(2.3, -1.45, 0.6));
    s.add(fire);
    this.lamps.push((t) => {
      fire.intensity = 0.9 * (1 + Math.sin(t * 9.1) * 0.08 + Math.sin(t * 15.3 + 1) * 0.06);
      uFlame.value = 1 + Math.sin(t * 13.1) * 0.035 + Math.sin(t * 23.7 + 1.3) * 0.025;
    });
    // late-afternoon sun through the two front display windows (behind the camera)
    const toSun = new THREE.Vector3(0.55, 0.42, 1).normalize();
    this.suns.push(windowSun(s, B(-2.85, -5.0, 2.0), toSun, 3.1, 2.25, new THREE.Vector3(0, 0, -1), 5.5));
    this.suns.push(windowSun(s, B(2.85, -5.0, 2.0), toSun, 3.1, 2.25, new THREE.Vector3(0, 0, -1), 5.5));
    this.ready = loadStoreRoom().then((root) => {
      const c = root.getObjectByName('counter');
      if (c) {
        c.parent?.remove(c);
        this.counterGroup.add(c);
      }
      this.register = root.getObjectByName('cash_register') ?? null;
      s.add(root);
      this.setYear(this.year);
    });
    pending.push(this.ready.catch(() => null));
  }

  /** The world hands every interior the sky IBL; a closed room uses its own warm environment instead. */
  setEnvironment(_t: THREE.Texture): void {
    this.scene.environment = this.roomEnv;
    this.scene.environmentIntensity = this.envIntensity;
  }

  /** The cash register arrives with the 1890s (National-style brass register). */
  setYear(year: number): void {
    this.year = year;
    if (this.register) this.register.visible = year >= 1890;
  }

  /** Time of day: golden afternoon sun + lit lamps (default), bright midday with lamps turned low, or night. */
  setHour(hour: number): void {
    const night = hour < 6 || hour > 20;
    const golden = hour >= 16.5 && !night;
    const morning = hour < 10 && !night;
    const [col, sun, lamps, win] = night ? [0xffd7a0, 0, 1.25, 0.04] : golden ? [0xffc480, 5.5, 1, 1] : morning ? [0xffe0b8, 5.0, 0.55, 1.1] : [0xfff2e0, 7.5, 0.2, 1.4];
    for (const s of this.suns) {
      s.color.set(col);
      s.intensity = sun;
      s.visible = sun > 0;
    }
    this.lampScale = lamps;
    uWindow.value = win;
  }

  update(t: number, dt: number, idle: boolean): void {
    for (const l of this.lamps) l(t);
    if (this.lampScale !== 1) for (const p of this.lampLights) p.intensity *= this.lampScale;
    uFlame.value *= Math.max(0.25, this.lampScale);
    super.update(t, dt, idle);
  }
}

export const storeLookdev: Record<string, () => Promise<THREE.Object3D>> = {
  store_interior: () => loadStoreRoom(),
};
void max;
void clamp;
