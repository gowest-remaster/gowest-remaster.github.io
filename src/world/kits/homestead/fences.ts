// Homestead kit: fences laid along polylines from baked pieces in public/world/assets/homestead/fences.glb
// (tools/blender/homestead/fences.py). Posts/rails/boards/barbs are InstancedMeshes with per-instance jitter;
// barbed-wire strands are thin sagging tubes. Metres, +Y up; points are world (or parent-local) XZ.
import * as THREE from 'three/webgpu';
import { loadGLB } from './loader';
import { weatherColor, weatherRough } from '../../engine/tsl';
import { float, vec3 } from 'three/tsl';

export type FenceKind = 'rail' | 'barbed' | 'pen';

export interface FenceOpts {
  /** connect the last point back to the first */
  closed?: boolean;
  /** RNG seed for variant choice + jitter */
  seed?: number;
  /** span index (0-based, counted along the whole polyline) that becomes a swinging gate (pen fences) */
  gate?: number;
  /** ground height at (x, z); default 0 */
  heightAt?: (x: number, z: number) => number;
  /** post spacing in metres (defaults: rail 2.6, pen 2.4, barbed 4.6) */
  spacing?: number;
  /** barbed wire: number of strands (3 or 4, default 3) */
  strands?: number;
  /** barbed wire: instance barbs every 0.3 m (default: only when the fence is shorter than 400 m) */
  barbs?: boolean;
}

interface Piece {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

let piecesP: Promise<Map<string, Piece>> | null = null;
function pieces(): Promise<Map<string, Piece>> {
  if (!piecesP) {
    piecesP = loadGLB('fences').then((root) => {
      const map = new Map<string, Piece>();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // bake the node transform (meshopt dequantisation) into a standalone geometry
        // (quantised int16 positions would clamp to +-1 m when transformed: go through Float32 first)
        const geo = m.geometry.clone();
        for (const key of ['position', 'normal', 'uv'] as const) {
          const a = geo.getAttribute(key) as THREE.BufferAttribute | undefined;
          if (!a || a.array instanceof Float32Array) continue;
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
          geo.setAttribute(key, new THREE.BufferAttribute(f, a.itemSize));
        }
        geo.applyMatrix4(m.matrixWorld);
        const name = (m.name || m.parent?.name || '').replace(/[._]\d{3}$/, '');
        map.set(name, { geo, mat: m.material as THREE.Material });
      });
      return map;
    });
  }
  return piecesP;
}

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

class Batch {
  mats = new Map<string, THREE.Matrix4[]>();
  add(name: string, m: THREE.Matrix4): void {
    const a = this.mats.get(name) ?? [];
    a.push(m);
    this.mats.set(name, a);
  }
  build(lib: Map<string, Piece>, g: THREE.Group): void {
    for (const [name, list] of this.mats) {
      const p = lib.get(name);
      if (!p) continue;
      const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
      im.name = name;
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true;
      im.receiveShadow = true;
      g.add(im);
    }
  }
}

const Y = new THREE.Vector3(0, 1, 0);
function compose(pos: THREE.Vector3, yaw: number, roll = 0, pitch = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(sx, sy, sz));
}

let wireMat: THREE.MeshStandardNodeMaterial | null = null;
function wireMaterial(): THREE.MeshStandardNodeMaterial {
  if (!wireMat) {
    wireMat = new THREE.MeshStandardNodeMaterial();
    wireMat.name = 'BarbedWire';
    wireMat.colorNode = weatherColor(vec3(0.2, 0.16, 0.13), { porosity: 0.2 });
    wireMat.roughnessNode = weatherRough(float(0.72), {});
    wireMat.metalnessNode = float(0.3);
  }
  return wireMat;
}

/** Thin 4-sided tube along a polyline (cheap enough for kilometres of wire). */
function wireTube(pts: THREE.Vector3[], r: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const sides = 4;
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    t.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    n.crossVectors(t, Y).normalize();
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    b.crossVectors(t, n).normalize();
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      pos.push(pts[i].x + n.x * c + b.x * s, pts[i].y + n.y * c + b.y * s, pts[i].z + n.z * c + b.z * s);
    }
    if (i > 0) {
      const o0 = (i - 1) * sides;
      const o1 = i * sides;
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        idx.push(o0 + k, o1 + k, o1 + k2, o0 + k, o1 + k2, o0 + k2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Lay a fence along `points` ([x, z] pairs). Posts always sit on the polyline vertices (corners) and at even
 * spacing between them. Returns a Group named `Fence_<kind>`; a pen gate (opts.gate) is a child named `Gate`
 * whose origin is on its hinge axis (rotate .rotation.y to swing it).
 */
export async function buildFence(kind: FenceKind, points: [number, number][], opts: FenceOpts = {}): Promise<THREE.Object3D> {
  const lib = await pieces();
  const r = rng(opts.seed ?? 7);
  const h = opts.heightAt ?? (() => 0);
  const spacing = opts.spacing ?? (kind === 'rail' ? 2.6 : kind === 'pen' ? 2.4 : 4.6);
  const pts = points.slice();
  if (opts.closed && pts.length > 2) pts.push(pts[0]);
  const g = new THREE.Group();
  g.name = `Fence_${kind}`;
  const batch = new Batch();
  const pick = (base: string, n: number) => `${base}_${Math.floor(r() * n) % n}`;
  // posts along the line
  const posts: { p: THREE.Vector3; yaw: number }[] = [];
  let total = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    total += len;
    const n = Math.max(1, Math.round(len / spacing));
    const yaw = Math.atan2(-(bz - az), bx - ax);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const jit = i === 0 ? 0 : (r() - 0.5) * 0.08;
      const x = ax + (bx - ax) * (t + jit / len);
      const z = az + (bz - az) * (t + jit / len);
      posts.push({ p: new THREE.Vector3(x, h(x, z), z), yaw });
    }
  }
  const [lx, lz] = pts[pts.length - 1];
  if (!(opts.closed && pts.length > 3)) posts.push({ p: new THREE.Vector3(lx, h(lx, lz), lz), yaw: posts[posts.length - 1]?.yaw ?? 0 });
  else posts.push({ ...posts[0] });
  const postName = kind === 'rail' ? 'RailPost' : kind === 'pen' ? 'PenPost' : 'CedarPost';
  const postN = kind === 'pen' ? 2 : 3;
  posts.forEach((q, i) => {
    if (opts.closed && pts.length > 3 && i === posts.length - 1) return;
    const yaw = kind === 'barbed' ? r() * Math.PI * 2 : q.yaw + (r() - 0.5) * 0.12;
    batch.add(pick(postName, postN), compose(q.p, yaw, (r() - 0.5) * 0.05, (r() - 0.5) * 0.05, 1, 0.94 + r() * 0.1, 1));
  });
  // spans
  const strands = opts.strands ?? 3;
  const wires: THREE.Vector3[][] = Array.from({ length: strands }, () => []);
  const wireH = strands === 4 ? [0.38, 0.66, 0.94, 1.2] : [0.45, 0.78, 1.1];
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i].p;
    const b = posts[i + 1].p;
    const span = a.distanceTo(b);
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const dirX = (b.x - a.x) / span;
    const dirZ = (b.z - a.z) / span;
    // outward normal (left of travel) for nailed boards
    const nx = dirZ;
    const nz = -dirX;
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const slope = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    if (kind === 'rail') {
      [0.38, 0.74, 1.08].forEach((hh) => {
        const p = mid.clone().add(new THREE.Vector3(0, hh + (r() - 0.5) * 0.05, 0));
        batch.add(pick('Rail', 4), compose(p, yaw + (r() - 0.5) * 0.03, slope + (r() - 0.5) * 0.04, (r() - 0.5) * 0.6, (span + 0.25) / 2.8, 1, 1));
      });
    } else if (kind === 'pen') {
      if (opts.gate === i) {
        const gate = lib.get('Gate_0');
        if (gate) {
          const m = new THREE.Mesh(gate.geo, gate.mat);
          m.castShadow = m.receiveShadow = true;
          const pivot = new THREE.Group();
          pivot.name = 'Gate';
          pivot.position.set(a.x + nx * 0.085 + dirX * 0.08, a.y, a.z + nz * 0.085 + dirZ * 0.08);
          pivot.rotation.y = yaw;
          m.scale.x = (span - 0.16) / 2.4;
          pivot.add(m);
          g.add(pivot);
        }
        continue;
      }
      [0.3, 0.62, 0.94, 1.26].forEach((hh) => {
        const p = mid.clone().add(new THREE.Vector3(nx * 0.085, hh + (r() - 0.5) * 0.01, nz * 0.085));
        batch.add(pick('Board', 4), compose(p, yaw, slope + (r() - 0.5) * 0.012, 0, (span + 0.1) / 2.5, 1, 1));
      });
    } else {
      for (let w = 0; w < strands; w++) {
        const hh = wireH[w];
        const sag = 0.012 * span + 0.02;
        const segs = 6;
        for (let k = i === 0 ? 0 : 1; k <= segs; k++) {
          const t = k / segs;
          const p = new THREE.Vector3().lerpVectors(a, b, t);
          // strands are stapled to the post's wind side; a little sag mid-span
          p.x += nx * 0.07;
          p.z += nz * 0.07;
          p.y += hh - sag * 4 * t * (1 - t);
          wires[w].push(p);
        }
      }
    }
  }
  batch.build(lib, g);
  if (kind === 'barbed') {
    const mat = wireMaterial();
    const withBarbs = opts.barbs ?? total < 400;
    for (const wpts of wires) {
      const mesh = new THREE.Mesh(wireTube(wpts, 0.0022), mat);
      mesh.castShadow = true;
      mesh.name = 'Wire';
      g.add(mesh);
    }
    if (withBarbs) {
      const bb = new Batch();
      for (const wpts of wires) {
        let carry = 0;
        for (let i = 0; i + 1 < wpts.length; i++) {
          const a = wpts[i];
          const b = wpts[i + 1];
          const L = a.distanceTo(b);
          const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
          const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
          for (let d = 0.3 - carry; d < L; d += 0.3) {
            const p = new THREE.Vector3().lerpVectors(a, b, d / L);
            bb.add('Barb_0', compose(p, yaw, pitch, r() * Math.PI * 2));
            carry = L - d;
          }
          if (L < 0.3) carry += L;
        }
      }
      bb.build(lib, g);
    }
  }
  return g;
}

const DEMO: [number, number][] = [
  [-6, 3],
  [0, 3],
  [0, -3],
  [5, -4],
];

/** Items reviewable in lookdev.html?kit=homestead&item=<name> */
export const lookdev: Record<string, () => Promise<THREE.Object3D>> = {
  fence_rail: () => buildFence('rail', DEMO, { seed: 3 }),
  fence_barbed: () => buildFence('barbed', DEMO, { seed: 4 }),
  fence_pen: () => buildFence('pen', [[-5, 3], [3, 3], [3, -4], [-5, -4]], { seed: 5, closed: true, gate: 1 }),
};
