// The homestead's LIVE layer over its pre-rendered plates (docs/world/sets.md "Plates"): the houses, barn, yard, pen,
// windmill tower and stock tank are baked into the plate (layers per game state); what stays live here is what moves
// or what the plate cannot know: the turning windmill head (both eras), stove / chimney smoke, the campfire, the
// mailbox flag, the barbed / rail field fence, invisible pick proxies (house, barn, pen, mailbox) and the pen fence
// (only as the source of the "build fence" ghost). Positions are the kit's, measured once (see ANCHORS).
import * as THREE from 'three/webgpu';
import { float, vec3, sin, mix, smoothstep, uniform } from 'three/tsl';
import { particles } from '../engine/particles';
import { uWind, uWindDir, uSnow, uSkyAmbient } from '../engine/tsl';
import { BARN, FIELD, FIELD_D, WINDMILL, terrainHeight } from '../env/layout';
import type { WorldView } from '../api';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const V3 = vec3 as N;
type Kit = typeof import('../kits/homestead');

const atGround = (o: THREE.Object3D, x: number, z: number, ry = 0, dy = 0) => {
  o.position.set(x, terrainHeight(x, z) + dy, z);
  o.rotation.y = ry;
};

/** Pen in front of the barn (world xz), gate on the first span. */
const PEN_POLY: [number, number][] = [
  [BARN.x - 6.4, BARN.z + 4.6],
  [BARN.x - 8.5, BARN.z + 19],
  [BARN.x + 9, BARN.z + 21],
  [BARN.x + 11.5, BARN.z + 5.2],
];

/** Live anchors measured from the kit models in place (houses at HOME rot 0.26, barn at BARN): world space. */
const ANCHORS = {
  stovepipeSod: new THREE.Vector3(11.918, 3.5, -6.841),
  chimneyFrame: new THREE.Vector3(10.601, 8.674, -6.473),
  campfire: new THREE.Vector3(6.955, -0.2, 1.226),
  flag: new THREE.Vector3(1.439, 0.596, 5.429),
  flagRotY: 0.5,
};
/** pick-proxy boxes (world AABBs of the kit models) */
const PROXY: Record<'sod' | 'frame' | 'wagon' | 'barn' | 'mailbox', [[number, number, number], [number, number, number]]> = {
  sod: [[4.94, -0.58, -10.43], [15.28, 3.71, -1.1]],
  frame: [[4.44, -0.71, -10.96], [16.01, 8.62, 0.92]],
  wagon: [[2.5, -1, -4], [11.5, 2.43, 6.23]],
  barn: [[23.87, -0.56, -45.1], [38.39, 7.34, -27.11]],
  mailbox: [[0.9, -0.84, 5.15], [1.6, 0.9, 5.95]],
};

export class KitHomestead {
  /** containers toggled by the view: invisible pick proxies (house/barn/pen/mailbox), live windmill, fences */
  parts: Record<'sod' | 'frame' | 'wagon' | 'barn' | 'windmill' | 'pen' | 'mailbox' | 'fieldFence', THREE.Group>;
  group = new THREE.Group();
  ready: Promise<void>;
  /** kit objects (sources for the blueprint ghosts), filled as they load */
  loaded: Partial<Record<'windmill' | 'pen', THREE.Object3D>> = {};
  /** meshes that only serve picking (never drawn: the plate shows the building) */
  proxies = new Set<THREE.Object3D>();
  private kit: Kit | null = null;
  private mills: Partial<Record<'halladay' | 'aermotor', { root: THREE.Object3D; update(dt: number, w: number, d: number): void }>> = {};
  /** the mailbox's signal flag (the box itself is baked into the homestead plate) */
  flag = new THREE.Group();
  private flagArm: THREE.Object3D | null = null;
  private flagUp = 0;
  private fenceKey = '';
  private era: 'halladay' | 'aermotor' = 'halladay';
  private smoke: { mesh: THREE.Mesh; uT: N };
  private fire: { mesh: THREE.Mesh; uT: N }[] = [];
  /** the wagon camp's fire (flames + smoke): live over the plate's baked fire ring */
  private campfire = new THREE.Group();
  /** campfire light: the world adds it to the scene root (never region-culled: the light set must stay the same
   *  everywhere, or every lit material rebuilds its render state at each place) */
  readonly fireLight = new THREE.PointLight(0xff8a3a, 0, 9, 2);
  private smokePosNode: N = uniform(new THREE.Vector3(0, -999, 0));
  private smokeOnNode: N = uniform(0);
  private view: WorldView | null = null;

  constructor() {
    const mk = () => {
      const g = new THREE.Group();
      this.group.add(g);
      return g;
    };
    this.parts = { sod: mk(), frame: mk(), wagon: mk(), barn: mk(), windmill: mk(), pen: mk(), mailbox: mk(), fieldFence: mk() };
    // pick proxies: plain boxes (never rendered: hidden, but the raycaster still tests them)
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const k of ['sod', 'frame', 'wagon', 'barn', 'mailbox'] as const) {
      const [mn, mx] = PROXY[k];
      const box = new THREE.Mesh(new THREE.BoxGeometry(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]), proxyMat);
      box.position.set((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
      box.name = `proxy:${k}`;
      this.parts[k].add(box);
      this.proxies.add(box);
    }
    {
      // pen: the fenced quad, 1.5 m high
      const xs = PEN_POLY.map((p) => p[0]);
      const zs = PEN_POLY.map((p) => p[1]);
      const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(...xs) - Math.min(...xs), 1.5, Math.max(...zs) - Math.min(...zs)), proxyMat);
      box.position.set((Math.max(...xs) + Math.min(...xs)) / 2, terrainHeight(BARN.x, BARN.z + 12) + 0.75, (Math.max(...zs) + Math.min(...zs)) / 2);
      box.name = 'proxy:pen';
      this.parts.pen.add(box);
      this.proxies.add(box);
    }
    this.fireLight.position.copy(ANCHORS.campfire).add(new THREE.Vector3(0, 0.4, 0));
    // stove / chimney smoke + campfire flames (world space particles)
    this.smoke = particles(260, (_id, r, t) => {
      const life = t.mul(r[2].mul(0.05).add(0.09)).add(r[3]).fract();
      const rise = life.mul(3.2).add(life.mul(life).mul(1.6));
      const drift = life.mul(uWind.mul(9).add(2.5));
      const wob = sin(t.mul(0.8).add(r[0].mul(30))).mul(life).mul(0.8);
      const pos = this.smokePosNode.add(V3(uWindDir.x.mul(drift).add(wob), rise, uWindDir.y.mul(drift).add(r[1].sub(0.5).mul(life))));
      const alpha = float(1).sub(life).mul(smoothstep(0, 0.04, life)).mul(0.15).mul(this.smokeOnNode).mul(float(1).sub(uSnow.mul(0.3)));
      return { pos, size: life.mul(2.0).add(0.25), alpha, color: V3(uSkyAmbient).mul(0.7) };
    }, false);
    this.smoke.mesh.visible = true;
    this.group.add(this.smoke.mesh);
    this.fire = this.makeFire(ANCHORS.campfire);
    this.buildFlag();
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const k = await import('../kits/homestead');
    this.kit = k;
    const jobs: Promise<unknown>[] = [];
    const add = (p: Promise<unknown>) => jobs.push(p.catch((e) => console.warn('[homestead kit]', e)));
    // windmills: only the head / wheel / tail render (the tower is a plate layer)
    for (const era of ['halladay', 'aermotor'] as const)
      add(
        k.loadWindmill(era).then((w) => {
          atGround(w.root, WINDMILL.x, WINDMILL.z, 0, -0.05);
          w.root.visible = era === this.era;
          this.parts.windmill.add(w.root);
          this.mills[era] = w;
          if (era === 'aermotor') this.loaded.windmill = w.root;
        }),
      );
    // pen fence: never drawn (the plate's pen layer); it is the outline the "build fence" ghost is made from
    add(
      k.buildFence('pen', PEN_POLY, { closed: false, gate: 0, heightAt: terrainHeight, seed: 3 }).then((f) => {
        f.visible = false;
        this.parts.pen.add(f);
        this.loaded.pen = f;
      }),
    );
    await Promise.all(jobs);
    if (this.view) this.apply(this.view);
  }

  private makeFire(at: THREE.Vector3): { mesh: THREE.Mesh; uT: N }[] {
    const flames = particles(160, (_id, r, t) => {
      const life = t.mul(r[2].mul(0.8).add(1.2)).add(r[3]).fract();
      const p = V3(at.x, at.y, at.z).add(V3(r[0].sub(0.5).mul(0.35), life.mul(r[1].mul(0.5).add(0.45)), r[1].sub(0.5).mul(0.35)));
      return { pos: p, size: float(1).sub(life).mul(0.35).add(0.06), alpha: float(1).sub(life).mul(0.9), color: mix(V3(9, 3.5, 0.7), V3(2.5, 0.4, 0.05), life) };
    }, true);
    const smoke = particles(90, (_id, r, t) => {
      const life = t.mul(r[2].mul(0.05).add(0.1)).add(r[3]).fract();
      const p = V3(at.x, at.y + 0.8, at.z).add(V3(life.mul(3.5).add(sin(t.add(r[0].mul(9))).mul(life).mul(0.6)), life.mul(5), life.mul(1.5)));
      return { pos: p, size: life.mul(2.2).add(0.3), alpha: float(1).sub(life).mul(smoothstep(0, 0.1, life)).mul(0.14), color: V3(uSkyAmbient).mul(1.0) };
    }, false);
    for (const f of [flames, smoke]) {
      f.mesh.visible = true;
      this.campfire.add(f.mesh);
    }
    this.group.add(this.campfire);
    return [flames, smoke];
  }

  apply(v: WorldView): void {
    this.view = v;
    const h = v.house;
    const sodLike = h === 'sod' || h === 'sodFurnished';
    this.parts.sod.visible = sodLike;
    this.parts.frame.visible = h === 'frame';
    this.parts.wagon.visible = h === 'wagon' || h === 'none';
    this.parts.barn.visible = v.barn;
    this.parts.windmill.visible = v.windmill;
    this.era = v.year >= 1888 ? 'aermotor' : 'halladay';
    if (this.mills.halladay) this.mills.halladay.root.visible = this.era === 'halladay';
    if (this.mills.aermotor) this.mills.aermotor.root.visible = this.era === 'aermotor';
    this.parts.pen.visible = v.fence >= 1 || v.barn;
    this.campfire.visible = this.parts.wagon.visible;
    this.fireLight.intensity = this.parts.wagon.visible ? 3 : 0;
    this.flagUp = v.mail ? 1 : 0;
    // field fence: barbed (or the Dev Cut wooden rail) around the owned field
    const wooden = v.extras.includes('woodenFence');
    const on = v.fence === 2 || (v.fence >= 1 && wooden);
    const key = on ? `${v.field.length}:${wooden}` : '';
    if (key !== this.fenceKey && this.kit) {
      this.fenceKey = key;
      this.parts.fieldFence.clear();
      if (on) {
        const pitch = FIELD.square + FIELD.gap;
        const w = (v.field.length > 8 ? 4 : 2) * pitch - FIELD.gap;
        const x0 = FIELD.x0 - 3;
        const x1 = FIELD.x0 + w + 3;
        const z0 = FIELD.z0 + 3;
        const z1 = FIELD.z0 - FIELD_D - 3;
        void this.kit
          .buildFence(wooden ? 'rail' : 'barbed', [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], { closed: true, heightAt: terrainHeight, strands: 4, seed: 9 })
          .then((f) => {
            if (this.fenceKey === key) this.parts.fieldFence.add(f);
          });
      }
    }
    // stove smoke from whichever house stands
    const src = h === 'frame' ? ANCHORS.chimneyFrame : sodLike ? ANCHORS.stovepipeSod : null;
    (this.smokePosNode.value as THREE.Vector3).copy(src ?? new THREE.Vector3(0, -999, 0));
    this.smokeOnNode.value = src ? 1 : 0;
  }

  /** A painted tin flag on a strap arm at the (baked) mailbox's side: up = a letter is waiting. */
  private buildFlag(): void {
    const paint = new THREE.MeshStandardMaterial({ color: 0x9a2a1c, roughness: 0.55, metalness: 0.2 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.6, metalness: 0.6 });
    const arm = new THREE.Group();
    // read at gameplay distance (~30 m): a touch larger than a real RFD flag
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.03), iron);
    strap.position.y = 0.17;
    const tin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.2), paint);
    tin.position.set(0, 0.3, 0.09);
    arm.add(strap, tin);
    arm.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : 0));
    this.flag.position.copy(ANCHORS.flag);
    this.flag.rotation.y = ANCHORS.flagRotY;
    this.flag.add(arm);
    this.flagArm = arm;
    this.group.add(this.flag);
  }

  update(t: number, dt: number, wind: number, windDir: THREE.Vector2): void {
    if (this.flagArm) {
      // lowered swings forward past horizontal below the box top; raised stands upright; eased swing
      const target = (1 - this.flagUp) * (Math.PI * 0.62);
      this.flagArm.rotation.x += (target - this.flagArm.rotation.x) * Math.min(1, dt * 4);
    }
    this.smoke.uT.value = t;
    for (const f of this.fire) f.uT.value = t;
    if (this.fireLight.intensity > 0) this.fireLight.intensity = 3 * (1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 23.7) * 0.05);
    const dir = Math.atan2(windDir.y, windDir.x);
    this.mills[this.era]?.update(dt, wind, dir);
  }
}
