// World layout (metres, Y up, -Z = north/away from the board camera) plus the CPU twin of the
// GPU terrain height function, so objects placed in TS sit exactly on the shader-displaced ground.

export const HOME = { x: 10, z: -6 }; // sod house centre
export const BARN = { x: 31, z: -36 };
export const WINDMILL = { x: -3, z: -19 };
export const MAILBOX = { x: 1.2, z: 5.5 };
const TOWN = { x: -760, z: -1330 };
export const TREE = { x: 40, z: -420 };

// Field: 8 squares per claim, laid out 2 wide x 4 deep like the original FIELD screen; the 1909 second claim adds
// a block to the east. Squares are drawn at 80 m (not the true ~284 m of 20 acres): at survey scale the field only
// reads from the air like a map, at 80 m it reads from a photographer's vantage at the claim's edge. Squares are
// separated by 4 m grass headlands. Index i: claim = i>>3, row = (i&7)>>1, col = i&1.
export const FIELD = {
  x0: 64,
  z0: -46, // south-west corner, just east of the barn; squares extend +x (east) and -z (north)
  square: 80,
  gap: 4,
  cols: 4, // 2 per claim
  rows: 4,
};
export const FIELD_W = FIELD.cols * FIELD.square + (FIELD.cols - 1) * FIELD.gap;
export const FIELD_D = FIELD.rows * FIELD.square + (FIELD.rows - 1) * FIELD.gap;
const FIELD_CENTER = { x: FIELD.x0 + FIELD_W / 2, z: FIELD.z0 - FIELD_D / 2 };
export const MAX_SQUARES = 16;
/** Centre (x, z) of square i. */
export function squareCenter(i: number): { x: number; z: number } {
  const claim = i >> 3;
  const row = (i & 7) >> 1;
  const col = (i & 1) + claim * 2;
  const pitch = FIELD.square + FIELD.gap;
  return { x: FIELD.x0 + col * pitch + FIELD.square / 2, z: FIELD.z0 - row * pitch - FIELD.square / 2 };
}
/** Railroad: straight east-west line through town. */
export const RAIL_Z = -1440;

// Road centreline from the house door, down-left toward the viewer, then winding off to town.
const ROAD_POINTS: [number, number][] = [
  [8.5, -1.5],
  [6, 3],
  [1.5, 7.5],
  [-5, 10.5],
  [-12, 10],
  [-17, 4],
  [-19, -6],
  [-17, -20],
  [-21, -40],
  [-34, -66],
  [-45, -100],
  [-43, -140],
  [-60, -200],
  [-92, -270],
  [-110, -350],
  [-170, -460],
  [-230, -560],
  [-262, -660],
  [-330, -780],
  [-430, -900],
  [-500, -1010],
  [-560, -1120],
  [-640, -1180],
  [-720, -1212],
  [-760, -1235],
  [-760, -1250],
];
/** Main Street runs north from the end of the road to the depot on the railroad. */
export const STREET = { x: -760, z0: -1250, z1: -1425, halfWidth: 10 };

// ---------- integer hash + value noise (bit-identical to the GLSL in glsl.ts) ----------
function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}
function hash2i(x: number, y: number): number {
  return pcg((Math.imul(x >>> 0, 1597334677) ^ pcg(y >>> 0)) >>> 0) / 4294967295;
}
function vnoise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2i(ix, iy);
  const b = hash2i(ix + 1, iy);
  const c = hash2i(ix, iy + 1);
  const d = hash2i(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Must match terrainHeight() in glsl.ts. */
/** Creek (with cottonwoods) meandering ~2 km north of the homestead, past the town. */
export const CREEK: [number, number][] = [
  [3400, -1650], [2600, -1980], [1900, -1820], [1250, -2150], [600, -1980], [0, -2260], [-560, -1840], [-1050, -1980], [-1700, -2280], [-2500, -2120], [-3400, -2350],
];
/** distance (m) from (x, z) to the creek centreline */
function creekDistance(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < CREEK.length - 1; i++) {
    const [ax, az] = CREEK[i];
    const [bx, bz] = CREEK[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function terrainHeight(x: number, z: number): number {
  let h = (vnoise(x / 520, z / 520) - 0.5) * 22;
  h += (vnoise(x / 190 + 17.3, z / 190 + 17.3) - 0.5) * 7;
  h += (vnoise(x / 60 + 3.1, z / 60 + 3.1) - 0.5) * 1.4;
  const dHome = Math.hypot(x - 14, z + 14);
  // long swells beyond a kilometre give the skyline gentle rises instead of a ruler-straight horizon
  h += (vnoise(x / 2600 + 41.7, z / 2600 + 41.7) - 0.5) * 46 * smooth(700, 2600, dHome);
  // creek valley: a shallow swale with a steeper channel
  if (Math.abs(z + 2000) < 700) {
    const cd = creekDistance(x, z);
    h -= 7 * (1 - smooth(10, 160, cd)) + 2.5 * (1 - smooth(2, 14, cd));
  }
  h *= 0.1 + 0.9 * smooth(60, 300, dHome);
  const qx = Math.max(Math.abs(x - FIELD_CENTER.x) - FIELD_W / 2, 0);
  const qz = Math.max(Math.abs(z - FIELD_CENTER.z) - FIELD_D / 2, 0);
  const fd = Math.hypot(qx, qz);
  h *= 1 - 0.7 * (1 - smooth(0, 160, fd));
  // town site and railroad grade are flat
  const dTown = Math.hypot(x - TOWN.x, z - TOWN.z);
  h *= smooth(160, 420, dTown);
  h *= 0.15 + 0.85 * smooth(6, 60, Math.abs(z - RAIL_Z));
  return h;
}

/** Catmull-Rom resample of the road polyline. */
export function roadSamples(step: number): { x: number; z: number }[] {
  const P = ROAD_POINTS;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[Math.min(P.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0[0], p1[0], p2[0], p3[0]), z: cr(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  const last = P[P.length - 1];
  out.push({ x: last[0], z: last[1] });
  return out;
}

// Region covered by the mask + height textures (homestead, road to town and the field).
// Mask: R = wheel ruts, G = bare/trampled yard, B = road corridor.
export const REGION = { x0: -1200, z0: -1700, size: 2600 };
export const HEIGHT_RES = 1024;
