// House interiors from the homestead kit (sod / furnished sod / frame) as InteriorSets: the kit's room + its light
// rig (window sun, sky fill, oil lamp), plus a soft volumetric shaft through the sun window and lamp flicker.
// No outdoor HDRI here: the open-sky IBL tinted up-faces blue-white, so the room gets a dim warm neutral env.
import * as THREE from 'three/webgpu';
import { Fn, float, vec3, uv, smoothstep, positionWorld, abs, normalFlat, normalize, cameraPosition, uniform } from 'three/tsl';
import { InteriorSet } from './base';
import { tnoise } from '../engine/tsl';

type State = 'sod' | 'sodFurnished' | 'frame';

export class HomesteadInteriorSet extends InteriorSet {
  ready: Promise<void>;
  private lamp: THREE.PointLight | null = null;
  private lampBase = 1.6;
  private setX: ((e: string[]) => void) | null = null;
  private pendingExtras: string[] = [];
  private uShaftT = uniform(0);

  constructor(state: State) {
    super();
    // a lamp-and-one-window room reads near black at the outdoor exposure: expose for the room (the frame house's
    // bigger rooms need the most), plus a warm bounce fill so corners keep detail
    this.exposure = state === 'frame' ? 2.6 : 1.9;
    this.envIntensity = 0;
    this.scene.environment = null;
    this.scene.background = new THREE.Color(0x000000);
    // warm, very dim ambient bounce (no sky IBL)
    this.scene.add(new THREE.HemisphereLight(0xffe2c0, 0x6a4a30, state === 'frame' ? 0.9 : 0.6));
    this.ready = this.load(state);
  }

  private async load(state: State): Promise<void> {
    const k = await import('../kits/homestead');
    const it = await k.loadInterior(state);
    this.scene.add(it.root);
    const rig = k.addInteriorLights(it);
    rig.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight && (o as THREE.PointLight).castShadow) {
        this.lamp = o as THREE.PointLight;
        this.lampBase = this.lamp.intensity;
      }
    });
    for (const [id, o] of it.props) this.prop(id, o);
    this.shot = { pos: it.shot.pos.clone(), look: it.shot.look.clone(), fov: it.shot.fov };
    this.setX = (e) => it.setExtras(e);
    this.setX(this.pendingExtras);
    this.addShaft(it.lights.window.pos, it.lights.window.dir);
  }

  /** nested additive prisms from the sun window along the light: a soft god-ray */
  private addShaft(win: THREE.Vector3, toSun: THREE.Vector3): void {
    const L = toSun.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(L.x, 0, L.z).normalize()).normalize();
    for (const k of [0.85, 0.95, 1.05, 1.17]) {
      const w = 0.72 * k;
      const h = 0.72 * k;
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => win.clone().add(right.clone().multiplyScalar((a * w) / 2)).add(up.clone().multiplyScalar((b * h) / 2)));
      const f = c.map((p) => p.clone().sub(L.clone().multiplyScalar(5.5)));
      const pos: number[] = [];
      const uvs: number[] = [];
      for (let i = 0; i < 4; i++) {
        const a = c[i];
        const b = c[(i + 1) % 4];
        pos.push(...a.toArray(), ...b.toArray(), ...f[(i + 1) % 4].toArray(), ...a.toArray(), ...f[(i + 1) % 4].toArray(), ...f[i].toArray());
        uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const along = uv().y;
      const n = tnoise(positionWorld.xz.mul(0.9).add(positionWorld.y.mul(0.7)).add(this.uShaftT.mul(0.05))).mul(0.6).add(tnoise(positionWorld.xy.mul(1.7)).mul(0.4));
      const facing = abs(normalFlat.dot(normalize(cameraPosition.sub(positionWorld)))).pow(1.5);
      m.colorNode = Fn(() => vec3(1.0, 0.8, 0.55).mul(float(0.012 / k)).mul(smoothstep(1.0, 0.15, along)).mul(smoothstep(0.0, 0.06, along)).mul(n.mul(0.7).add(0.5)).mul(facing))();
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 20;
      this.scene.add(mesh);
    }
  }

  setEnvironment(_t: THREE.Texture): void {
    // intentionally ignore the outdoor sky (see header)
  }

  setExtras(extras: string[]): void {
    this.pendingExtras = extras;
    this.setX?.(extras);
  }

  update(t: number, dt: number, idle: boolean): void {
    this.uShaftT.value = t;
    if (this.lamp) this.lamp.intensity = this.lampBase * (1 + Math.sin(t * 13.1) * 0.035 + Math.sin(t * 23.7 + 1.3) * 0.025 + Math.sin(t * 7.3) * 0.04);
    super.update(t, dt, idle);
  }
}
