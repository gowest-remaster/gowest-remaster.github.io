// Selection / hover marks over STANDING CROPS only: the terrain shows its own soft warm wash + thin chalk edge on
// bare / young squares, which crop cards hide once they grow. Here: a thin warm low-alpha edge glow draped at
// crop-top height, only for squares tall enough to hide the ground marks. No geometry rails.
import * as THREE from 'three/webgpu';
import { uv, min, float, smoothstep, vec3 } from 'three/tsl';
import { FIELD, squareCenter, terrainHeight } from '../env/layout';

const LIFT = 1.05; // crop-top height (ripe wheat ~1.0-1.2 m)
export class SquareMarks {
  group = new THREE.Group();
  private geos = new Map<number, THREE.BufferGeometry>();
  private selMat = SquareMarks.glow(new THREE.Color(1.0, 0.72, 0.36), 0.015, 0.22);
  private hovMat = SquareMarks.glow(new THREE.Color(1.0, 0.9, 0.7), 0.0, 0.1);
  private pool: THREE.Object3D[] = [];
  private key = '';

  /** additive warm wash: `fill` over the square, rising to `edge` within ~4 m of its border */
  private static glow(col: THREE.Color, fill: number, edge: number): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // additive: fog would mix its (bright) colour in and wash whole squares out from the distant field camera
    m.fog = false;
    const u = uv();
    const d = min(min(u.x, u.y), min(float(1).sub(u.x), float(1).sub(u.y))).mul(FIELD.square);
    const e = float(1).sub(smoothstep(0.0, 1.2, d));
    m.colorNode = vec3(col.r, col.g, col.b).mul(e.mul(edge).add(fill));
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    return m;
  }

  constructor() {
    this.group.name = 'square-marks';
  }

  private mark(i: number, kind: 'sel' | 'hov'): THREE.Object3D {
    let geo = this.geos.get(i);
    if (!geo) {
      // draped on the ground (world-space heights), so it never floats or sinks into the gentle swells
      const c = squareCenter(i);
      geo = new THREE.PlaneGeometry(FIELD.square, FIELD.square, 20, 20).rotateX(-Math.PI / 2);
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k) + c.x;
        const z = p.getZ(k) + c.z;
        p.setXYZ(k, x, terrainHeight(x, z) + LIFT, z);
      }
      geo.computeBoundingSphere();
      this.geos.set(i, geo);
    }
    const g = new THREE.Mesh(geo, kind === 'sel' ? this.selMat : this.hovMat);
    g.renderOrder = 5;
    return g;
  }

  /** `visible`: only shown at the field place */
  set(selected: Set<number>, hover: number | null, visible: boolean, tall: (i: number) => boolean = () => true): void {
    const key = `${visible}|${[...selected].filter(tall).sort().join(',')}|${hover !== null && hover >= 0 && tall(hover) ? hover : -1}`;
    if (key === this.key) return;
    this.key = key;
    for (const g of this.pool) this.group.remove(g);
    this.pool = [];
    if (!visible) return;
    for (const i of selected) if (tall(i)) this.pool.push(this.mark(i, 'sel'));
    if (hover !== null && hover >= 0 && !selected.has(hover) && tall(hover)) this.pool.push(this.mark(hover, 'hov'));
    for (const g of this.pool) this.group.add(g);
  }
}
