// Shared scaffolding for interior sets: own scene + camera + shot, clickable props, idle camera drift.
import * as THREE from 'three/webgpu';
import { Fn as _Fn, vec3 as _vec3, float as _float, uv as _uv, smoothstep as _sm, positionWorld as _pw, abs as _abs, normalFlat as _nf, normalize as _nz, cameraPosition as _cp, mrt as _mrt, vec4 as _v4, uniform as _uniform } from 'three/tsl';
import { tnoise } from '../engine/tsl';

export interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export abstract class InteriorSet {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
  shot: Shot = { pos: new THREE.Vector3(0, 1.6, 3), look: new THREE.Vector3(0, 1, 0), fov: 50 };
  /** id -> object to raycast/outline (ledger, album, savings, newspaper, gramophone, counter, teller...) */
  props = new Map<string, THREE.Object3D>();
  /** tone-mapping exposure for this set */
  exposure = 1.2;
  envIntensity = 0.45;
  protected time = 0;
  fovScale = 1;

  constructor() {
    this.scene.background = new THREE.Color(0x000000);
  }

  setEnvironment(t: THREE.Texture): void {
    this.scene.environment = t;
    this.scene.environmentIntensity = this.envIntensity;
  }

  /** register a clickable prop */
  protected prop(id: string, o: THREE.Object3D): THREE.Object3D {
    o.userData.pickId = id;
    this.props.set(id, o);
    return o;
  }

  setExtras(_extras: string[]): void {}

  update(t: number, _dt: number, idle: boolean): void {
    this.time = t;
    const p = this.shot.pos.clone();
    if (idle) p.add(new THREE.Vector3(Math.sin(t * 0.21) * 0.05, Math.sin(t * 0.33) * 0.02, Math.cos(t * 0.17) * 0.04));
    this.camera.position.copy(p);
    this.camera.fov = this.shot.fov * this.fovScale;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.shot.look);
  }
}







/** Sun through a window: shadowed directional light + soft volumetric shaft. */
export function windowSun(scene: THREE.Scene, winCenter: THREE.Vector3, toSun: THREE.Vector3, w: number, h: number, wallNormal: THREE.Vector3, intensity = 6): THREE.DirectionalLight {
  const L = toSun.clone().normalize();
  const sun = new THREE.DirectionalLight(0xffd7a0, intensity);
  sun.position.copy(winCenter).add(L.clone().multiplyScalar(12));
  sun.target.position.copy(winCenter).sub(L.clone().multiplyScalar(2));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -6;
  sc.right = sc.top = 6;
  sc.near = 1;
  sc.far = 30;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, wallNormal).normalize();
  const shaftT = _uniform(0);
  for (const k of [0.85, 0.95, 1.05, 1.17]) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => winCenter.clone().add(right.clone().multiplyScalar((a * w * k) / 2)).add(up.clone().multiplyScalar((b * h * k) / 2)));
    const far = corners.map((c) => c.clone().sub(L.clone().multiplyScalar(6)));
    const pos: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      pos.push(...a.toArray(), ...b.toArray(), ...far[(i + 1) % 4].toArray(), ...a.toArray(), ...far[(i + 1) % 4].toArray(), ...far[i].toArray());
      uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const along = _uv().y;
    const n = tnoise(_pw.xz.mul(0.9).add(_pw.y.mul(0.7)).add(shaftT.mul(0.05))).mul(0.6).add(tnoise(_pw.xy.mul(1.7)).mul(0.4));
    const facing = _abs(_nf.dot(_nz(_cp.sub(_pw)))).pow(1.5);
    m.colorNode = _Fn(() => _vec3(1.0, 0.8, 0.55).mul(_float(0.012 / k)).mul(_sm(1.0, 0.15, along)).mul(_sm(0.0, 0.06, along)).mul(n.mul(0.7).add(0.5)).mul(facing))();
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 20;
    scene.add(mesh);
  }
  return sun;
}

/** Warm oil-lamp point light with a glowing chimney core. Returns a flicker updater. */
export function oilLamp(scene: THREE.Scene, pos: THREE.Vector3, intensity = 1.6, shadow = true): (t: number) => void {
  const light = new THREE.PointLight(0xff9a48, intensity, 10, 2);
  light.position.copy(pos);
  light.castShadow = shadow;
  light.shadow.mapSize.set(256, 256);
  light.shadow.bias = -0.002;
  light.shadow.radius = 4;
  scene.add(light);
  const u = _uniform(1);
  const core = new THREE.MeshBasicNodeMaterial();
  core.colorNode = _vec3(9, 4.2, 1.2).mul(u);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), core);
  flame.scale.y = 2;
  flame.position.copy(pos).add(new THREE.Vector3(0, -0.05, 0));
  scene.add(flame);
  const seed = Math.random() * 10;
  return (t: number) => {
    const f = 1 + Math.sin(t * 13.1 + seed) * 0.035 + Math.sin(t * 23.7 + 1.3 + seed) * 0.025 + Math.sin(t * 7.3 + seed) * 0.04;
    light.intensity = intensity * f;
    u.value = f;
  };
}
