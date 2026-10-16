// Main Street live extras over the plate: label / pick anchors (measured from the town kit's layout: door, 2.2 m up,
// on the boardwalk) and saddle horses tied at the hitching rails (life-kit horses, Idle clip).
import * as THREE from 'three/webgpu';
import { instantiate } from '../engine/gltf';
import { rng } from '../engine/geo';
import { RAIL_Z, STREET, terrainHeight } from '../env/layout';

export class TownExtras {
  group = new THREE.Group();
  anchors: Record<string, THREE.Vector3> = {
    store: new THREE.Vector3(-771.4, 2.2, -1284.8),
    bank: new THREE.Vector3(-771.4, 2.2, -1275),
    elevator: new THREE.Vector3(STREET.x - 34, 6, RAIL_Z + 16),
    depot: new THREE.Vector3(-736, 4, -1427.1),
    freightOffice: new THREE.Vector3(-774, 5.8, -1421.5),
    'business:0': new THREE.Vector3(-748.6, 2.2, -1312.3),
    'business:1': new THREE.Vector3(-748.6, 2.2, -1328.9),
    'business:2': new THREE.Vector3(-771.4, 2.2, -1325.2),
    'business:3': new THREE.Vector3(-748.6, 2.2, -1275.5),
  };
  private horses: THREE.AnimationMixer[] = [];
  private roots: { o: THREE.Object3D; on: boolean }[] = [];

  constructor() {
    const r = rng(9);
    const rails = [-1266, -1280, -1295, -1309, -1322, -1266, -1314];
    for (let i = 0; i < rails.length; i++) {
      const side = i < 5 ? -1 : 1;
      const x = STREET.x + side * (STREET.halfWidth - 1.2);
      const z = rails[i] + (r() - 0.5) * 4;
      const ry = (side < 0 ? Math.PI / 2 : -Math.PI / 2) + (r() - 0.5) * 0.3;
      const file = r() < 0.7 ? 'world/assets/life/horse_bay.glb' : 'world/assets/life/horse_grey.glb';
      const t0 = r() * 10;
      instantiate(file)
        .then(({ root, clips }) => {
          root.position.set(x, terrainHeight(x, z), z);
          root.rotation.y = ry; // facing the boardwalk rail
          const mixer = new THREE.AnimationMixer(root);
          const idle = clips.find((c) => c.name === 'Idle') ?? clips[0];
          if (idle) mixer.clipAction(idle).play();
          mixer.setTime(t0);
          this.group.add(root);
          this.horses.push(mixer);
          this.roots.push({ o: root, on: true });
        })
        .catch(() => undefined);
    }
  }

  update(_t: number, dt: number, camera?: THREE.Camera): void {
    for (const m of this.horses) m.update(dt);
    // far horses skip the shadow passes (several skinned parts each, per cascade)
    if (camera)
      for (const r of this.roots) {
        const on = r.o.position.distanceTo(camera.position) < 40;
        if (on !== r.on) {
          r.on = on;
          r.o.traverse((m) => {
            if ((m as THREE.Mesh).isMesh) m.castShadow = on;
          });
        }
      }
  }
}
