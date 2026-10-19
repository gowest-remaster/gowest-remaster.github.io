// Camera-facing GPU particle systems whose per-instance placement is a TSL function of (id, randoms, time).
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, int, ivec2, uniform, instanceIndex, positionGeometry, cameraPosition, uv, smoothstep, normalize, cross, varying } from 'three/tsl';
import { hash2i } from './tsl';
import { LOW_MEMORY } from '../../lowmem';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const V3 = vec3 as N;

const quadGeo = (): THREE.InstancedBufferGeometry => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
};

/** Camera-facing particle system whose instance placement is a TSL function of (id, r1..r3, time). */
export function particles(n: number, place: (id: N, r: N[], t: N) => { pos: N; size: N; alpha: N; color: N }, additive: boolean): { mesh: THREE.Mesh; uT: N } {
  const g = quadGeo();
  // phones: a quarter of the particles (the disaster effects stay legible; overdraw is what costs there)
  g.instanceCount = LOW_MEMORY ? Math.ceil(n / 4) : n;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  // fog on an additive particle adds the (bright) fog colour per layer: distant flames turned into a white haze
  if (additive) m.fog = false;
  const uT = uniform(0);
  const vA = varying(float(), 'vPA');
  const vC = varying(V3(), 'vPC') as N;
  m.positionNode = Fn(() => {
    const id = int(instanceIndex);
    const r = [hash2i(ivec2(id, 3)), hash2i(ivec2(id, 7)), hash2i(ivec2(id, 13)), hash2i(ivec2(id, 29))];
    const o = place(id, r, uT);
    const toCam = normalize(cameraPosition.sub(o.pos));
    const right = normalize(cross(V3(0, 1, 0), toCam));
    const up = cross(toCam, right);
    vA.assign(o.alpha);
    vC.assign(o.color);
    const q = positionGeometry.xy.sub(vec2(0, 0.5));
    return o.pos.add(right.mul(q.x.mul(o.size))).add(up.mul(q.y.mul(o.size)));
  })();
  const d = uv().sub(0.5).length().mul(2);
  m.colorNode = vC;
  m.opacityNode = vA.mul(smoothstep(1, 0.15, d));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 15;
  mesh.visible = false;
  return { mesh, uT };
}

