// Blueprint ghosts for buildable items: chalk-line drawings (feature edges of the real model) with a barely
// visible fill and a soft pulse, so the planned building reads as a sketch on the land, not a white box.
import * as THREE from 'three/webgpu';
import { float, vec3, sin, uniform, normalView, positionViewDirection, dot, abs } from 'three/tsl';
import { uTime } from '../engine/tsl';

export const uGhostHover = uniform(0);
let lineMat: THREE.LineBasicNodeMaterial | null = null;
let fillMat: THREE.MeshBasicNodeMaterial | null = null;

function mats() {
  if (!lineMat) {
    const pulse = sin(uTime.mul(2.2)).mul(0.2).add(0.8).add(uGhostHover.mul(0.5));
    lineMat = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    lineMat.colorNode = vec3(0.92, 0.9, 0.82).mul(pulse);
    lineMat.opacityNode = float(0.3).add(uGhostHover.mul(0.45));
    fillMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const fres = float(1).sub(abs(dot(normalView, positionViewDirection.negate()))).pow(3);
    fillMat.colorNode = vec3(0.85, 0.88, 0.9);
    fillMat.opacityNode = fres.mul(0.12).add(0.03).mul(pulse).add(uGhostHover.mul(0.05));
  }
  return { line: lineMat!, fill: fillMat! };
}


/** Chalk-line copy of `src`: feature edges (> 28°) of every regular mesh + faint fill; instanced/foliage skipped. */
export function makeGhost(src: THREE.Object3D): THREE.Object3D {
  const { line, fill } = mats();
  const root = new THREE.Group();
  src.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) return;
    if (!m.geometry.attributes.position || m.geometry.attributes.position.count > 400000) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), line);
    edges.applyMatrix4(rel);
    edges.renderOrder = 13;
    root.add(edges);
    if (m.geometry.attributes.position.count < 3000) {
      const f = new THREE.Mesh(m.geometry, fill);
      f.applyMatrix4(rel);
      f.renderOrder = 12;
      root.add(f);
    }
  });
  root.position.copy(src.position);
  root.quaternion.copy(src.quaternion);
  root.scale.copy(src.scale);
  return root;
}

/** Clean massing ghost: rectangular walls + gable roof (ridge along X), origin at the ground centre. */
export function massingGhost(W: number, D: number, H: number, ridge: number, over = 0.3): THREE.Object3D {
  const { line, fill } = mats();
  const g = new THREE.Group();
  const walls = new THREE.BoxGeometry(W, H, D).translate(0, H / 2, 0);
  const roof = new THREE.BufferGeometry();
  const w = W / 2 + over;
  const d = D / 2 + over;
  const eave = H - over * ((ridge - H) / (D / 2));
  const v = [-w, eave, d, w, eave, d, w, ridge, 0, -w, ridge, 0, -w, eave, -d, w, eave, -d];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.setIndex([0, 1, 2, 0, 2, 3, 4, 3, 2, 4, 2, 5, 0, 3, 4, 1, 5, 2]);
  roof.computeVertexNormals();
  for (const geo of [walls, roof]) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 10), line);
    e.renderOrder = 13;
    const f = new THREE.Mesh(geo, fill);
    f.renderOrder = 12;
    g.add(e, f);
  }
  // door + windows sketched on the front wall
  const sketch: number[] = [];
  const rect = (cx: number, y0: number, ww: number, hh: number) => {
    const z = D / 2 + 0.01;
    const x0 = cx - ww / 2;
    const x1 = cx + ww / 2;
    const y1 = y0 + hh;
    sketch.push(x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z);
  };
  rect(0.15 * (W / 7), 0, 0.95, Math.min(1.95, H * 0.85));
  rect(-W * 0.3, H * 0.38, 0.75, H * 0.32);
  rect(W * 0.32, H * 0.38, 0.75, H * 0.32);
  const sk = new THREE.BufferGeometry();
  sk.setAttribute('position', new THREE.Float32BufferAttribute(sketch, 3));
  const skl = new THREE.LineSegments(sk, line);
  skl.renderOrder = 13;
  g.add(skl);
  return g;
}
