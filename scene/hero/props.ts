// Japan-specific street props for the hero district, built from code (no asset library has them): a mamachari bicycle,
// a drinks vending machine with real cans and bottles behind its glass, a chalk-menu A-board, an umbrella stand with
// clear plastic umbrellas, beer crates with their bottles, a 50 cc scooter. Each writes triangles into a `Batches`
// (hero/builder.ts) at a ground point, its front turned to `facing`. Lengths in metres; deterministic given the rng.
import { MeshPhysicalMaterial, type MeshStandardMaterial, SurfaceMaterial, Texture } from "@threert/scene";
import { Batches, Frame, add, cross, mul, norm, sub, type V3, type rng } from "./builder.ts";

type Rng = ReturnType<typeof rng>;
type Mat = MeshStandardMaterial;
type UV = [number, number];

import { finishMap } from "./finish.ts";
const HERO = "assets/city/hero/tex";
const tex = (file: string, clamp = true) => {
  const t = new Texture(`${HERO}/${file}`);
  if (clamp) t.wrap = "clamp";
  return t;
};
function finish(id: string, size: number, o: { tint?: [number, number, number]; name?: string } = {}) {
  const map = finishMap(id, "color");
  map.repeat = [1 / size, 1 / size];
  return new SurfaceMaterial({
    name: o.name ?? id, map, color: o.tint ?? [1, 1, 1], roughness: 1,
    normalMap: finishMap(id, "normal"),
    roughnessMap: finishMap(id, "rough"),
  });
}

export type PropMats = ReturnType<typeof propMaterials>;

export function propMaterials(night: boolean) {
  const k = night ? 1 : 0;
  // (MeshPhysicalMaterial throughout: transmission, ior and clearcoat are its fields; MeshStandardMaterial drops them)
  const std = (name: string, color: number, roughness: number, extra: Partial<ConstructorParameters<typeof MeshPhysicalMaterial>[0]> = {}) => new MeshPhysicalMaterial({ name, color, roughness, ...extra });
  const paint = (name: string, color: number, metalness = 0) => std(name, color, 0.32, { metalness, clearcoat: 0.7, clearcoatRoughness: 0.15 });
  const cansTex = tex("cans.png", false);
  return {
    // bicycles
    bikePaint: [paint("bike silver", 0xb9bdc1, 0.85), paint("bike black", 0x16171a), paint("bike white", 0xe6e6e1), paint("bike mint", 0x8fcfbd), paint("bike pink", 0xe3aebb), paint("bike sky", 0x93bde2), paint("bike cream", 0xe8dcc0)],
    chrome: std("chrome", 0xd8dadc, 0.12, { metalness: 1 }),
    steel: std("steel satin", 0x8d9094, 0.35, { metalness: 1 }),
    steelBlack: std("steel black", 0x1c1d20, 0.45, { metalness: 0.7 }),
    rubber: std("rubber", 0x111111, 0.85),
    plasticBlack: std("plastic black", 0x1a1a1b, 0.5),
    saddle: std("saddle", 0x2a1c14, 0.45, { clearcoat: 0.3 }),
    lens: std("lamp lens", 0xf2efe6, 0.05, { metalness: 0, clearcoat: 1 }),
    // vending machine
    vendBody: [paint("vending white", 0xe9ebee), paint("vending red", 0xc4161c), paint("vending blue", 0x1f5fae)],
    vendHeader: std("vending header", 0xffffff, 0.2, { map: tex("vend-header.png"), emissive: 0xffffff, emissiveMap: tex("vend-header.png"), emissiveIntensity: night ? 160 : 45, clearcoat: 1 }),
    vendSide: std("vending side", 0xffffff, 0.35, { map: tex("vend-side.png"), clearcoat: 0.8 }),
    vendBack: std("vending window back", 0xf6f7f8, 0.6, { emissive: 0xf4f8ff, emissiveIntensity: night ? 70 : 18 }),
    vendStrip: std("vending light strip", 0xffffff, 0.3, { emissive: 0xf0f6ff, emissiveIntensity: night ? 900 : 250 }),
    vendShelf: std("vending shelf", 0xd9dce0, 0.4),
    vendPrice: std("vending prices", 0xffffff, 0.4, { map: tex("vend-price.png"), emissive: 0xffffff, emissiveMap: tex("vend-price.png"), emissiveIntensity: night ? 40 : 12 }),
    vendButton: std("vending button", 0x8ef0a0, 0.3, { emissive: 0x6cff8a, emissiveIntensity: night ? 260 : 60 }),
    vendPanel: std("vending coin panel", 0x45494f, 0.35, { metalness: 0.8 }),
    vendSlot: std("vending slot", 0x050505, 0.6),
    vendIC: std("vending IC", 0x2a3a46, 0.2, { emissive: 0x7fd4ff, emissiveIntensity: night ? 18 : 5 }),
    can: std("drink can", 0xffffff, 0.25, { map: cansTex, metalness: 0.45, clearcoat: 0.8 }),
    pet: std("drink bottle", 0xffffff, 0.08, { map: cansTex, clearcoat: 1 }),
    capWhite: std("bottle cap", 0xf2f2ee, 0.4),
    glass: std("vending glass", 0xffffff, 0.02, { transmission: 1, ior: 1.5 }),
    binBody: std("bin plastic", 0xeeeeea, 0.45),
    binLabel: std("bin label", 0xffffff, 0.5, { map: tex("bin-label.png") }),
    // A-boards
    boardWood: finish("planks-dark", 0.6, { name: "board wood" }),
    chalk: std("chalk menu", 0xffffff, 0.92, { map: tex("menus.png") }),
    // umbrellas, crates
    umbrella: std("umbrella vinyl", 0xf4f8fb, 0.18, { transmission: 0.85, ior: 1.4, side: "double" }),
    umbrellaHandle: std("umbrella handle", 0xe8e8e8, 0.35),
    bucket: std("galvanised bucket", 0x9a9fa3, 0.45, { metalness: 0.9 }),
    crate: [std("crate yellow", 0xe8b81a, 0.45), std("crate red", 0xb51d1d, 0.45), std("crate blue", 0x1d4fa0, 0.45)],
    bottleBrown: std("beer bottle", 0x6b3208, 0.04, { transmission: 1, ior: 1.5 }),
    capGold: std("crown cap", 0xc9a640, 0.3, { metalness: 1 }),
    // scooters
    scootPaint: [paint("scooter red", 0xb3141b), paint("scooter cream", 0xe9dfc8), paint("scooter blue", 0x2a5d9c), paint("scooter black", 0x141416), paint("scooter mint", 0x8ccfb9)],
    tail: std("tail light", 0xb01010, 0.15, { clearcoat: 1 }),
    plate: std("number plate", 0xf4f4ee, 0.4),
    darkMetal: std("engine", 0x2e3033, 0.5, { metalness: 0.6 }),
    _k: k,
  };
}

// ---------------------------------------------------------------- local frames and surfaces

/** A prop's own axes: x to the right (seen from its front), y up, z forward (`facing`); an optional lean about z. */
class Local {
  readonly u: V3;
  readonly n: V3;
  readonly at: V3;
  private c: number;
  private s: number;
  constructor(at: V3, facing: V3, lean = 0) {
    this.at = at;
    this.n = norm([facing[0], 0, facing[2]]);
    this.u = [this.n[2], 0, -this.n[0]];
    this.c = Math.cos(lean);
    this.s = Math.sin(lean);
  }
  p(x: number, y: number, z: number): V3 {
    const X = x * this.c + y * this.s, Y = -x * this.s + y * this.c;
    return [this.at[0] + this.u[0] * X + this.n[0] * z, this.at[1] + Y, this.at[2] + this.u[2] * X + this.n[2] * z];
  }
  d(x: number, y: number, z: number): V3 {
    const X = x * this.c + y * this.s, Y = -x * this.s + y * this.c;
    return norm([this.u[0] * X + this.n[0] * z, Y, this.u[2] * X + this.n[2] * z]);
  }
  /** A facade-style frame at local (x, y=0, z) whose `s` runs along local x and `d` along local z. */
  frame(x = 0, z = 0): Frame {
    return new Frame(this.p(x, 0, z), this.u, this.n);
  }
  readonly P = (q: V3): V3 => this.p(q[0], q[1], q[2]);
}

type G = { length: number; v3(x: number, y: number, z: number): void; v2(x: number, y: number): void; push(...v: number[]): void };
type Part = { pos: G; nor: G; uv: G; idx: G };
const part = (B: Batches, m: Mat) => (B as unknown as { part(m: Mat): Part }).part(m);

/** A grid of vertices (rows x cols) with smooth normals; cells wound to face their normals. */
function grid(B: Batches, m: Mat, P: V3[][], N: V3[][], T: UV[][]) {
  const p = part(B, m), base = p.pos.length / 3, cols = P[0].length;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < cols; j++) {
    const q = P[i][j], n = N[i][j], t = T[i][j];
    p.pos.v3(q[0], q[1], q[2]);
    p.nor.v3(n[0], n[1], n[2]);
    p.uv.v2(t[0], t[1]);
  }
  for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j + 1 < cols; j++) {
    const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    const n = N[i][j], g = cross(sub(P[i][j + 1], P[i][j]), sub(P[i + 1][j + 1], P[i][j]));
    if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] >= 0) { p.idx.v3(a, b, d); p.idx.v3(a, d, c); }
    else { p.idx.v3(a, d, b); p.idx.v3(a, c, d); }
    B.triangles += 2;
  }
}

/** A surface of revolution about local axis `ax` through `c`: profile [radius, along] bottom to top; u round in
 *  [u0, u1], v along in [v0, v1] (three.js: v up). `wobble(k)` scales the radius per segment (pleats). */
function lathe(B: Batches, m: Mat, L: Local, c: V3, ax: "x" | "y" | "z", profile: [number, number][], seg = 16, uv: [number, number, number, number] = [0, 0, 1, 1], wobble?: (k: number) => number, cap = false) {
  const basis = (a: number): [V3, V3, V3] => (ax === "y" ? [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]] : ax === "x" ? [[0, Math.cos(a), Math.sin(a)], [1, 0, 0], [0, -Math.sin(a), Math.cos(a)]] : [[Math.cos(a), Math.sin(a), 0], [0, 0, 1], [-Math.sin(a), Math.cos(a), 0]]);
  const P: V3[][] = [], N: V3[][] = [], T: UV[][] = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [r, h] = profile[i];
    const [r0, h0] = profile[Math.max(0, i - 1)], [r1, h1] = profile[Math.min(n - 1, i + 1)];
    const dr = r1 - r0, dh = h1 - h0 || 1e-6;
    const row: V3[] = [], nrow: V3[] = [], trow: UV[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, [radial, along] = basis(a);
      const w = wobble ? wobble(k % seg) : 1;
      const q: V3 = add(add(c, mul(radial, r * w)), mul(along, h));
      row.push(L.P(q));
      // the profile's normal: radial x dh - along x dr
      const nl = norm(add(mul(radial, dh), mul(along, -dr)));
      nrow.push(L.d(nl[0], nl[1], nl[2]));
      trow.push([uv[0] + (uv[2] - uv[0]) * (k / seg), uv[1] + (uv[3] - uv[1]) * (i / (n - 1))]);
    }
    P.push(row); N.push(nrow); T.push(trow);
  }
  grid(B, m, P, N, T);
  if (cap) {
    const [r, h] = profile[n - 1], [, along] = basis(0), top = L.P(add(c, mul(along, h))), nn = L.d(along[0], along[1], along[2]);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      B.tri(m, top, L.P(add(add(c, mul(basis(a0)[0], r)), mul(along, h))), L.P(add(add(c, mul(basis(a1)[0], r)), mul(along, h))), nn);
    }
  }
}

/** A torus about local axis `ax` through `c` (wheels' tyres and rims). */
function torus(B: Batches, m: Mat, L: Local, c: V3, ax: "x" | "y" | "z", R: number, r: number, seg = 40, tseg = 8, squash = 1) {
  const P: V3[][] = [], N: V3[][] = [], T: UV[][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const radial: V3 = ax === "x" ? [0, Math.cos(a), Math.sin(a)] : ax === "y" ? [Math.cos(a), 0, Math.sin(a)] : [Math.cos(a), Math.sin(a), 0];
    const axis: V3 = ax === "x" ? [1, 0, 0] : ax === "y" ? [0, 1, 0] : [0, 0, 1];
    const row: V3[] = [], nrow: V3[] = [], trow: UV[] = [];
    for (let j = 0; j <= tseg; j++) {
      const b = (j / tseg) * Math.PI * 2;
      const nl = add(mul(radial, Math.cos(b)), mul(axis, Math.sin(b)));
      row.push(L.P(add(c, add(mul(radial, R + r * Math.cos(b)), mul(axis, r * squash * Math.sin(b))))));
      nrow.push(L.d(nl[0], nl[1], nl[2]));
      trow.push([i / seg, j / tseg]);
    }
    P.push(row); N.push(nrow); T.push(trow);
  }
  grid(B, m, P, N, T);
}

/** An ellipsoid at local `c` with radii (rx, ry, rz); `ycut` keeps only the part above that height (relative). */
function ellipsoid(B: Batches, m: Mat, L: Local, c: V3, rx: number, ry: number, rz: number, seg = 16, rings = 10, ycut = -1) {
  const P: V3[][] = [], N: V3[][] = [], T: UV[][] = [];
  const p0 = Math.asin(Math.max(-1, Math.min(1, ycut)));
  for (let i = 0; i <= rings; i++) {
    const ph = p0 + (Math.PI / 2 - p0) * (i / rings);
    const row: V3[] = [], nrow: V3[] = [], trow: UV[] = [];
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2, x = Math.cos(ph) * Math.cos(th), y = Math.sin(ph), z = Math.cos(ph) * Math.sin(th);
      row.push(L.p(c[0] + rx * x, c[1] + ry * y, c[2] + rz * z));
      const nl = norm([x / rx, y / ry, z / rz]);
      nrow.push(L.d(nl[0], nl[1], nl[2]));
      trow.push([k / seg, i / rings]);
    }
    P.push(row); N.push(nrow); T.push(trow);
  }
  grid(B, m, P, N, T);
}

const tubeL = (B: Batches, m: Mat, L: Local, pts: V3[], r: number, seg = 6, caps = false) => B.tube(m, pts.map(L.P), r, seg, caps);

/** A quad strip along a local arc (mudguards): centre c, about local x, radius R, from angle a0 to a1, width w. */
function arcStrip(B: Batches, m: Mat, L: Local, c: V3, R: number, a0: number, a1: number, w: number, steps = 18) {
  const P: V3[][] = [], N: V3[][] = [], T: UV[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps, cy = Math.sin(a), cz = Math.cos(a);
    const row: V3[] = [], nrow: V3[] = [], trow: UV[] = [];
    for (const x of [-w / 2, -w / 4, 0, w / 4, w / 2]) {
      const bulge = 1 + 0.06 * (1 - (2 * x / w) ** 2);
      row.push(L.p(c[0] + x, c[1] + R * bulge * cy, c[2] + R * bulge * cz));
      nrow.push(L.d(x * 2, cy, cz));
      trow.push([x, (a * R)]);
    }
    P.push(row); N.push(nrow); T.push(trow);
  }
  grid(B, m, P, N, T);
}

// ---------------------------------------------------------------- the props

/** A mamachari (city bicycle) on its stand: step-through frame, 26" wheels, front basket, rear rack, mudguards,
 *  chain guard, dynamo lamp, bell. ~1.85 m long, its length along `facing`. */
export function bicycle(B: Batches, PM: PropMats, at: V3, facing: V3, R: Rng) {
  const L = new Local(at, facing, R.range(-0.015, 0.015));
  const paint = R.pick(PM.bikePaint), fenders = R.chance(0.6) ? PM.chrome : paint;
  const RA: V3 = [0, 0.335, -0.56], FA: V3 = [0, 0.335, 0.54], BB: V3 = [0, 0.27, -0.05];
  const HT: V3 = [0, 0.94, 0.35], HB: V3 = [0, 0.77, 0.4], ST: V3 = [0, 0.8, -0.2];
  // wheels: tyre, rim, hub, 28 spokes laced tangentially
  for (const A of [RA, FA]) {
    torus(B, PM.rubber, L, A, "x", 0.312, 0.022, 48, 8, 0.85);
    torus(B, PM.chrome, L, A, "x", 0.288, 0.009, 48, 6, 1.6);
    tubeL(B, PM.steel, L, [add(A, [-0.05, 0, 0]), add(A, [0.05, 0, 0])], 0.02, 10, true);
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? 1 : -1, a = (i / 28) * Math.PI * 2, b = a + side * 0.18;
      tubeL(B, PM.steel, L, [add(A, [side * 0.032, Math.sin(a) * 0.03, Math.cos(a) * 0.03]), add(A, [0, Math.sin(b) * 0.282, Math.cos(b) * 0.282])], 0.0016, 3);
    }
  }
  // mudguards over both wheels
  arcStrip(B, fenders, L, RA, 0.352, Math.PI * 0.05, Math.PI * 1.08, 0.06);
  arcStrip(B, fenders, L, FA, 0.352, -Math.PI * 0.15, Math.PI * 0.85, 0.06);
  // frame: the low U-shaped down tube, the seat tube, stays, head tube and fork
  tubeL(B, paint, L, [HT, HB, [0, 0.62, 0.3], [0, 0.44, 0.17], [0, 0.32, 0.05], BB], 0.024, 10);
  tubeL(B, paint, L, [[0, 0.7, 0.33], [0, 0.55, 0.22], [0, 0.4, 0.06], [0, 0.33, -0.02]], 0.016, 8);
  tubeL(B, paint, L, [BB, ST], 0.02, 10);
  for (const s of [-1, 1]) {
    tubeL(B, paint, L, [[s * 0.02, BB[1], BB[2]], [s * 0.065, RA[1], RA[2]]], 0.011, 6);
    tubeL(B, paint, L, [[s * 0.018, 0.74, -0.18], [s * 0.065, RA[1] + 0.02, RA[2] + 0.02]], 0.01, 6);
    tubeL(B, paint, L, [[s * 0.03, HB[1], HB[2]], [s * 0.05, 0.56, 0.47], [s * 0.05, FA[1], FA[2]]], 0.012, 6);
  }
  tubeL(B, paint, L, [HB, HT], 0.026, 10, true);
  // seat post and saddle on its springs
  tubeL(B, PM.chrome, L, [ST, [0, 0.96, -0.245]], 0.013, 8);
  ellipsoid(B, PM.saddle, L, [0, 0.99, -0.25], 0.085, 0.045, 0.135, 14, 7, -0.25);
  for (const s of [-1, 1]) tubeL(B, PM.chrome, L, [[s * 0.05, 0.95, -0.32], [s * 0.05, 0.99, -0.32]], 0.012, 6);
  // stem, swept-back bars, grips, levers, bell
  tubeL(B, PM.chrome, L, [HT, [0, 1.05, 0.33]], 0.014, 8);
  const bar: V3[] = [[-0.27, 1.04, 0.17], [-0.2, 1.05, 0.25], [-0.1, 1.06, 0.31], [0, 1.06, 0.33], [0.1, 1.06, 0.31], [0.2, 1.05, 0.25], [0.27, 1.04, 0.17]];
  tubeL(B, PM.chrome, L, bar, 0.011, 8);
  for (const s of [-1, 1]) {
    tubeL(B, PM.plasticBlack, L, [[s * 0.275, 1.04, 0.165], [s * 0.225, 1.045, 0.225]], 0.017, 8, true);
    tubeL(B, PM.steel, L, [[s * 0.16, 1.07, 0.28], [s * 0.26, 1.03, 0.25]], 0.006, 4);
  }
  ellipsoid(B, PM.chrome, L, [-0.13, 1.085, 0.3], 0.028, 0.02, 0.028, 12, 5, 0);
  // the front basket of wire mesh on its struts
  {
    const x0 = -0.17, x1 = 0.17, z0 = 0.47, z1 = 0.79, y0 = 0.8, y1 = 1.03, step = 0.034;
    const rimAt = (y: number, r: number) => tubeL(B, PM.chrome, L, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]], r, 4);
    rimAt(y0, 0.004); rimAt(y1, 0.005); rimAt((y0 + y1) / 2, 0.003);
    for (let x = x0; x <= x1 + 1e-6; x += step) for (const z of [z0, z1]) tubeL(B, PM.chrome, L, [[x, y0, z], [x, y1, z]], 0.0022, 3);
    for (let z = z0 + step; z < z1; z += step) for (const x of [x0, x1]) tubeL(B, PM.chrome, L, [[x, y0, z], [x, y1, z]], 0.0022, 3);
    for (let x = x0; x <= x1 + 1e-6; x += step) tubeL(B, PM.chrome, L, [[x, y0, z0], [x, y0, z1]], 0.0022, 3);
    for (let z = z0; z <= z1 + 1e-6; z += step) tubeL(B, PM.chrome, L, [[x0, y0, z], [x1, y0, z]], 0.0022, 3);
    for (const s of [-1, 1]) tubeL(B, PM.steel, L, [[s * 0.12, y0, 0.6], [s * 0.05, FA[1] + 0.02, FA[2]]], 0.005, 4);
    tubeL(B, PM.steel, L, [[0, y0, z0], [0, 0.98, 0.37]], 0.006, 4);
  }
  // the rear rack
  for (const s of [-1, 1]) {
    tubeL(B, PM.chrome, L, [[s * 0.075, 0.81, -0.3], [s * 0.075, 0.81, -0.8]], 0.006, 5);
    tubeL(B, PM.chrome, L, [[s * 0.075, 0.81, -0.74], [s * 0.065, RA[1] + 0.01, RA[2]]], 0.006, 5);
    tubeL(B, PM.chrome, L, [[s * 0.075, 0.81, -0.32], [s * 0.02, 0.76, -0.2]], 0.005, 4);
  }
  for (let z = -0.34; z > -0.8; z -= 0.07) tubeL(B, PM.chrome, L, [[-0.075, 0.81, z], [0.075, 0.81, z]], 0.005, 4);
  // drivetrain: chainring, cranks, pedals; the chain guard on the right
  torus(B, PM.steel, L, [0.06, BB[1], BB[2]], "x", 0.09, 0.006, 32, 4);
  tubeL(B, PM.steel, L, [[0.06, BB[1], BB[2]], [0.065, BB[1] - 0.16, BB[2] + 0.04]], 0.01, 6);
  tubeL(B, PM.steel, L, [[-0.06, BB[1], BB[2]], [-0.065, BB[1] + 0.16, BB[2] - 0.04]], 0.01, 6);
  for (const [x, y, z] of [[0.1, BB[1] - 0.16, BB[2] + 0.04], [-0.1, BB[1] + 0.16, BB[2] - 0.04]] as V3[]) B.box(PM.plasticBlack, L.frame(), x - 0.05, x + 0.05, y - 0.012, y + 0.012, z - 0.04, z + 0.04);
  {
    const a = L.p(0.085, BB[1], BB[2] + 0.06), b = L.p(0.085, RA[1], RA[2] + 0.06), along = norm(sub(b, a));
    const gf = new Frame(a, along, cross(along, [0, 1, 0]));
    B.box(paint, gf, -0.04, Math.hypot(b[0] - a[0], b[2] - a[2]) + 0.03, -0.07, 0.06, -0.004, 0.004);
  }
  // the centre stand, down behind the rear axle; the dynamo lamp on the fork
  for (const s of [-1, 1]) tubeL(B, PM.steel, L, [[s * 0.07, RA[1] - 0.02, RA[2] + 0.05], [s * 0.1, 0.0, RA[2] + 0.2]], 0.009, 6);
  tubeL(B, PM.steel, L, [[-0.1, 0.008, RA[2] + 0.2], [0.1, 0.008, RA[2] + 0.2]], 0.009, 6);
  lathe(B, PM.chrome, L, [0, 0.6, 0.5], "z", [[0.032, 0], [0.036, 0.05], [0.036, 0.065]], 14);
  lathe(B, PM.lens, L, [0, 0.6, 0.565], "z", [[0.034, 0], [0.02, 0.012], [0.001, 0.014]], 14);
}

/** A drinks vending machine against a wall, its front to `facing`; `at` is the middle of its front on the ground. With
 *  its recycling bin to its right. */
export function vendingMachine(B: Batches, PM: PropMats, at: V3, facing: V3, R: Rng) {
  const L = new Local(at, facing), F = L.frame();
  const body = R.pick(PM.vendBody);
  const W = 0.5, D = 0.72, H = 1.83;
  // plinth and the body's shell (its front built below)
  B.box(PM.plasticBlack, F, -W + 0.03, W - 0.03, 0, 0.07, -D + 0.02, -0.03, { skip: "b" });
  B.box(body, F, -W, W, 0.07, H, -D, -0.03, { skip: "n" });
  // printed side panels
  for (const side of [-1, 1]) {
    const n = mul(L.u, side), u: V3 = [n[2], 0, -n[0]];
    const sf = new Frame(L.p(side * (W + 0.002), 0, side > 0 ? -0.03 : -D), u, n);
    B.rect(PM.vendSide, sf, 0.04, 0.12, D - 0.07, H - 0.05, 0, [0, 0, 1, 1]);
  }
  // front panel round its openings: window 0.98..1.53, header 1.56..1.76, take-out 0.12..0.36
  const front = (x0: number, x1: number, y0: number, y1: number) => B.rect(body, F, x0, y0, x1, y1, -0.03);
  front(-W, W, 0.07, 0.12); front(-W, -0.4, 0.12, 0.36); front(0.4, W, 0.12, 0.36); front(-W, W, 0.36, 0.98);
  front(-W, -0.44, 0.98, 1.53); front(0.44, W, 0.98, 1.53); front(-W, W, 1.53, 1.56); front(-W, -0.44, 1.56, 1.76); front(0.44, W, 1.56, 1.76); front(-W, W, 1.76, H);
  // a rounded top edge: a half-cylinder along the front
  tubeL(B, body, L, [[-W, H - 0.01, -0.04], [W, H - 0.01, -0.04]], 0.015, 8);
  // the header, lit
  B.rect(PM.vendHeader, F, -0.44, 1.565, 0.44, 1.755, -0.035, [0, 0, 1, 1]);
  // the window: a recess with a lit back, a light strip, three shelves of cans and bottles, glass in front
  const wx0 = -0.44, wx1 = 0.44, wy0 = 0.98, wy1 = 1.53, wd = -0.21;
  B.quad(body, F.p(wx0, wy0, -0.03), F.p(wx0, wy1, -0.03), F.p(wx0, wy1, wd), F.p(wx0, wy0, wd), L.u, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.quad(body, F.p(wx1, wy0, -0.03), F.p(wx1, wy1, -0.03), F.p(wx1, wy1, wd), F.p(wx1, wy0, wd), mul(L.u, -1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.flat(body, F, wx0, wx1, wd, -0.03, wy1, true);
  B.flat(PM.vendShelf, F, wx0, wx1, wd, -0.03, wy0);
  B.rect(PM.vendBack, F, wx0, wy0, wx1, wy1, wd);
  B.box(PM.vendStrip, F, wx0 + 0.02, wx1 - 0.02, wy1 - 0.025, wy1 - 0.008, -0.07, -0.05);
  const rows = [1.0, 1.175, 1.35];
  rows.forEach((sy, r) => {
    B.box(PM.vendShelf, F, wx0, wx1, sy - 0.012, sy, wd, -0.045);
    // its price strip and buttons, on the shelf's front edge
    B.rect(PM.vendPrice, F, wx0 + 0.01, sy - 0.03, wx1 - 0.01, sy - 0.012, -0.044, [0, 0, 1, 1]);
    for (let k = 0; k < 8; k++) {
      const x = wx0 + 0.055 + k * 0.11;
      B.box(PM.vendButton, F, x - 0.022, x + 0.022, sy - 0.05, sy - 0.035, -0.05, -0.04);
      const cell = (r * 8 + k * 3 + R.int(16)) % 16, cz = -0.12;
      const P: V3 = [x, sy, cz];
      if ((k + r) % 3 === 0 || R.chance(0.25)) {
        // a PET bottle: body, shoulder, neck, cap
        lathe(B, PM.pet, L, P, "y", [[0.031, 0], [0.033, 0.01], [0.033, 0.105], [0.026, 0.13], [0.014, 0.15], [0.013, 0.162]], 14, [cell / 16, 0.05, (cell + 1) / 16, 0.95]);
        lathe(B, PM.capWhite, L, add(P, [0, 0.162, 0]), "y", [[0.015, 0], [0.015, 0.016]], 10, undefined, undefined, true);
      } else {
        // a can: its body, the necked top
        lathe(B, PM.can, L, P, "y", [[0.028, 0], [0.033, 0.008], [0.033, 0.108], [0.029, 0.12], [0.027, 0.122]], 14, [cell / 16, 0.05, (cell + 1) / 16, 0.95], undefined, true);
      }
    }
  });
  // a closed pane (4 mm), so rays that enter the glass also leave it
  B.box(PM.glass, F, wx0, wx1, wy0, wy1, -0.039, -0.035);
  // the bezel round the window
  B.box(PM.vendPanel, F, wx0 - 0.015, wx1 + 0.015, wy0 - 0.02, wy0, -0.035, -0.02);
  B.box(PM.vendPanel, F, wx0 - 0.015, wx1 + 0.015, wy1, wy1 + 0.02, -0.035, -0.02);
  // the money panel: coin slot, note slot, IC reader, return lever, change cup
  B.box(PM.vendPanel, F, 0.14, 0.44, 0.56, 0.93, -0.03, -0.005, { skip: "b" });
  B.rect(PM.vendSlot, F, 0.3, 0.86, 0.315, 0.9, -0.004);
  B.rect(PM.vendSlot, F, 0.18, 0.86, 0.27, 0.875, -0.004);
  B.rect(PM.vendIC, F, 0.18, 0.72, 0.29, 0.82, -0.004);
  B.box(PM.chrome, F, 0.34, 0.4, 0.78, 0.8, -0.006, 0.01);
  B.box(PM.vendPanel, F, 0.3, 0.42, 0.58, 0.66, -0.004, 0.03);
  B.rect(PM.vendSlot, F, 0.31, 0.6, 0.41, 0.65, 0.031);
  // the take-out bay with its flap
  const tx0 = -0.4, tx1 = 0.4, ty0 = 0.12, ty1 = 0.36, td = -0.16;
  B.quad(PM.plasticBlack, F.p(tx0, ty0, -0.03), F.p(tx0, ty1, -0.03), F.p(tx0, ty1, td), F.p(tx0, ty0, td), L.u, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.quad(PM.plasticBlack, F.p(tx1, ty0, -0.03), F.p(tx1, ty1, -0.03), F.p(tx1, ty1, td), F.p(tx1, ty0, td), mul(L.u, -1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.flat(PM.plasticBlack, F, tx0, tx1, td, -0.03, ty0);
  B.flat(PM.plasticBlack, F, tx0, tx1, td, -0.03, ty1, true);
  B.rect(PM.plasticBlack, F, tx0, ty0, tx1, ty1, td);
  B.quad(PM.plasticBlack, F.p(tx0 + 0.01, ty1 - 0.01, -0.035), F.p(tx1 - 0.01, ty1 - 0.01, -0.035), F.p(tx1 - 0.01, ty0 + 0.04, -0.07), F.p(tx0 + 0.01, ty0 + 0.04, -0.07), norm(add(L.n, [0, 0.6, 0])), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // the recycling bin to its right
  {
    const bx0 = W + 0.06, bx1 = W + 0.46, bz0 = -0.48, bz1 = -0.06, bh = 0.86;
    B.box(PM.binBody, F, bx0, bx1, 0, bh, bz0, bz1, { front: PM.binBody });
    B.rect(PM.binLabel, F, bx0 + 0.03, 0.45, bx1 - 0.03, 0.66, bz1 + 0.002, [0, 0, 1, 1]);
    for (const hx of [bx0 + 0.11, bx1 - 0.11]) lathe(B, PM.vendSlot, L, [hx, bh + 0.001, (bz0 + bz1) / 2 + 0.05], "y", [[0.055, 0], [0.0, 0.0005]], 16);
  }
}

/** A chalk-menu A-board standing open, its front to `facing`. */
export function aBoard(B: Batches, PM: PropMats, at: V3, facing: V3, R: Rng) {
  const L = new Local(at, facing);
  const top = 0.98, spread = 0.24, hw = 0.27;
  for (const side of [1, -1]) {
    const T: V3 = [0, top, side * 0.015], Bt: V3 = [0, 0.0, side * spread];
    const down = sub(Bt, T), right: V3 = [side, 0, 0];
    const Q = (x: number, t: number): V3 => L.P(add(add(T, mul(right, x)), mul(down, t)));
    const nl = norm(cross(down, right));
    const nn = L.d(nl[0], nl[1], nl[2]);
    // the board, a frame round it of square rails
    const c = R.int(4);
    B.quad(PM.chalk, Q(-hw + 0.03, 0.07), Q(hw - 0.03, 0.07), Q(hw - 0.03, 0.86), Q(-hw + 0.03, 0.86), nn, [[c / 4 + 0.01, 0.99], [(c + 1) / 4 - 0.01, 0.99], [(c + 1) / 4 - 0.01, 0.01], [c / 4 + 0.01, 0.01]]);
    // the board's back, 15 mm behind the slate (not in its plane)
    const back = mul(nn, -0.015);
    B.quad(PM.boardWood, add(Q(-hw, 0.05), back), add(Q(hw, 0.05), back), add(Q(hw, 0.88), back), add(Q(-hw, 0.88), back), mul(nn, -1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const rail = (a: V3, b: V3) => B.tube(PM.boardWood, [a, b], 0.02, 4, true);
    rail(Q(-hw, 0), Q(-hw, 1)); rail(Q(hw, 0), Q(hw, 1)); rail(Q(-hw, 0.04), Q(hw, 0.04)); rail(Q(-hw, 0.88), Q(hw, 0.88)); rail(Q(-hw, 0.005), Q(hw, 0.005));
  }
  B.box(PM.steelBlack, L.frame(), -0.2, 0.2, top - 0.02, top + 0.01, -0.02, 0.02);
}

/** A galvanised stand of clear plastic umbrellas (1-3), folded, leaning in it. */
export function umbrellaStand(B: Batches, PM: PropMats, at: V3, facing: V3, R: Rng) {
  const L = new Local(at, facing);
  lathe(B, PM.bucket, L, [0, 0, 0], "y", [[0.12, 0], [0.13, 0.02], [0.15, 0.44], [0.155, 0.45]], 20);
  lathe(B, PM.bucket, L, [0, 0, 0], "y", [[0.145, 0.45], [0.14, 0.43], [0.0, 0.43]], 20);
  const n = 1 + R.int(3);
  for (let k = 0; k < n; k++) {
    const a = R.range(0, Math.PI * 2), tilt = R.range(0.08, 0.22), base: V3 = [Math.cos(a) * 0.05, 0.05, Math.sin(a) * 0.05];
    const dir: V3 = norm([Math.cos(a) * tilt, 1, Math.sin(a) * tilt]);
    const at2 = (t: number) => add(base, mul(dir, t));
    // the canopy, pleated, from the tip up; the shaft on; the J handle
    const pleat = (j: number) => (j % 2 ? 1 : 0.72);
    const prof: [number, number][] = [[0.004, 0], [0.03, 0.08], [0.052, 0.2], [0.056, 0.32], [0.042, 0.48], [0.018, 0.6], [0.008, 0.62]];
    const P: V3[][] = [], N: V3[][] = [], T: UV[][] = [];
    const e1 = norm(cross(dir, [0, 0, 1])), e2 = cross(dir, e1);
    for (let i = 0; i < prof.length; i++) {
      const [r, h] = prof[i], row: V3[] = [], nrow: V3[] = [], trow: UV[] = [];
      for (let j = 0; j <= 16; j++) {
        const ang = (j / 16) * Math.PI * 2, rad = add(mul(e1, Math.cos(ang)), mul(e2, Math.sin(ang)));
        row.push(L.P(add(at2(h), mul(rad, r * pleat(j % 16)))));
        nrow.push(L.d(rad[0], rad[1], rad[2]));
        trow.push([j / 16, i / 6]);
      }
      P.push(row); N.push(nrow); T.push(trow);
    }
    grid(B, PM.umbrella, P, N, T);
    // the strap round its waist
    B.tube(PM.umbrellaHandle, Array.from({ length: 13 }, (_, j) => { const ang = (j / 12) * Math.PI * 2; return L.P(add(at2(0.42), mul(add(mul(e1, Math.cos(ang)), mul(e2, Math.sin(ang))), 0.04))); }), 0.004, 4);
    tubeL(B, PM.steel, L, [at2(0.6), at2(0.8)], 0.006, 6);
    const h0 = at2(0.8), side = mul(e1, 1);
    const hook: V3[] = [];
    for (let j = 0; j <= 8; j++) { const t = (j / 8) * Math.PI; hook.push(add(add(h0, mul(dir, 0.05 + Math.sin(t) * 0.045)), mul(side, 0.045 - Math.cos(t) * 0.045))); }
    tubeL(B, PM.umbrellaHandle, L, [h0, ...hook], 0.011, 8);
  }
}

/** Plastic beer crates (1-`max` stacked), 20 brown bottles in the top one. */
export function beerCases(B: Batches, PM: PropMats, at: V3, facing: V3, R: Rng, max = 3) {
  const L = new Local(at, facing, 0);
  const n = 1 + R.int(max), mat = R.pick(PM.crate);
  const W = 0.23, Dz = 0.165, Hc = 0.255;
  for (let k = 0; k < n; k++) {
    const y0 = k * (Hc - 0.01), off = R.range(-0.015, 0.015);
    const F = new Local(L.p(off, y0, R.range(-0.01, 0.01)), facing).frame();
    // rims, corner posts, slats, the floor; the hand holes as dark slots
    B.box(mat, F, -W, W, 0, 0.04, -Dz, Dz);
    B.box(mat, F, -W, W, Hc - 0.035, Hc, -Dz, Dz, { skip: "d" });
    for (const [x, z] of [[-W, -Dz], [W, -Dz], [-W, Dz], [W, Dz]]) B.box(mat, F, x - 0.012 * Math.sign(x), x, 0, Hc, z - 0.012 * Math.sign(z), z);
    for (let s = -W + 0.06; s < W - 0.03; s += 0.065) for (const z of [-Dz, Dz]) B.box(mat, F, s - 0.009, s + 0.009, 0.04, Hc - 0.035, z - 0.01 * Math.sign(z), z);
    for (let s = -Dz + 0.06; s < Dz - 0.03; s += 0.065) for (const x of [-W, W]) B.box(mat, F, x - 0.01 * Math.sign(x), x, 0.04, Hc - 0.035, s - 0.009, s + 0.009);
    B.flat(mat, F, -W, W, -Dz, Dz, 0.045);
    // dividers
    for (let i = 1; i < 5; i++) B.box(mat, F, -W + (2 * W * i) / 5 - 0.003, -W + (2 * W * i) / 5 + 0.003, 0.045, 0.2, -Dz, Dz, { skip: "d" });
    for (let j = 1; j < 4; j++) B.box(mat, F, -W, W, 0.045, 0.2, -Dz + (2 * Dz * j) / 4 - 0.003, -Dz + (2 * Dz * j) / 4 + 0.003, { skip: "d" });
    if (k === n - 1 && R.chance(0.85)) {
      const Lb = new Local(L.p(off, y0, 0), facing);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
        if (R.chance(0.08)) continue;
        const c: V3 = [-W + (2 * W * (i + 0.5)) / 5, 0.045, -Dz + (2 * Dz * (j + 0.5)) / 4];
        lathe(B, PM.bottleBrown, Lb, c, "y", [[0.03, 0], [0.036, 0.01], [0.036, 0.19], [0.03, 0.22], [0.014, 0.25], [0.013, 0.285], [0.015, 0.29]], 12);
        lathe(B, PM.capGold, Lb, add(c, [0, 0.29, 0]), "y", [[0.016, 0], [0.016, 0.008]], 8, undefined, undefined, true);
      }
    }
  }
}

/** A 50 cc scooter on its centre stand, its front to `facing`. */
export function scooter(B: Batches, PM: PropMats, at: V3, facing: V3, R: Rng) {
  const L = new Local(at, facing);
  const paint = R.pick(PM.scootPaint);
  const FA: V3 = [0, 0.2, 0.6], RA: V3 = [0, 0.2, -0.55];
  for (const A of [FA, RA]) {
    torus(B, PM.rubber, L, A, "x", 0.155, 0.047, 36, 10, 0.95);
    lathe(B, PM.steel, L, add(A, [-0.045, 0, 0]), "x", [[0.11, 0], [0.12, 0.01], [0.12, 0.08], [0.11, 0.09]], 18);
    lathe(B, PM.darkMetal, L, add(A, [-0.05, 0, 0]), "x", [[0.0, 0], [0.11, 0.004]], 18);
    lathe(B, PM.darkMetal, L, add(A, [0.05, 0, 0]), "x", [[0.11, 0], [0.0, 0.004]], 18);
  }
  // the rear body over the engine, the seat on it, the tail light and the plate
  ellipsoid(B, paint, L, [0, 0.5, -0.36], 0.19, 0.23, 0.5, 20, 10, -0.35);
  B.box(PM.darkMetal, L.frame(), -0.12, 0.1, 0.12, 0.34, -0.72, -0.18);
  tubeL(B, PM.chrome, L, [[0.15, 0.24, -0.35], [0.17, 0.27, -0.7], [0.15, 0.32, -0.85]], 0.04, 10, true);
  ellipsoid(B, PM.saddle, L, [0, 0.74, -0.3], 0.155, 0.065, 0.33, 18, 8, -0.3);
  ellipsoid(B, PM.tail, L, [0, 0.62, -0.84], 0.07, 0.035, 0.03, 12, 6);
  {
    const back = new Local(L.p(0, 0, -0.86), mul(L.n, -1)).frame();
    B.box(PM.plate, back, -0.075, 0.075, 0.42, 0.52, -0.005, 0.0);
  }
  tubeL(B, PM.chrome, L, [[-0.12, 0.72, -0.62], [-0.12, 0.74, -0.9], [0.12, 0.74, -0.9], [0.12, 0.72, -0.62]], 0.011, 6);
  // floorboard, the leg shield and the front body
  B.box(PM.plasticBlack, L.frame(), -0.17, 0.17, 0.22, 0.28, -0.08, 0.4);
  ellipsoid(B, paint, L, [0, 0.62, 0.44], 0.21, 0.36, 0.09, 20, 10);
  ellipsoid(B, paint, L, [0, 0.38, 0.62], 0.085, 0.07, 0.2, 14, 7, -0.2);
  // the steering column, the bars' cover with its headlight, the grips and mirrors
  tubeL(B, PM.steelBlack, L, [[0, 0.5, 0.58], [0, 0.98, 0.47]], 0.025, 8);
  for (const s of [-1, 1]) tubeL(B, PM.steel, L, [[s * 0.05, 0.45, 0.58], [s * 0.05, FA[1], FA[2]]], 0.018, 8);
  ellipsoid(B, paint, L, [0, 1.0, 0.47], 0.26, 0.07, 0.11, 18, 8);
  lathe(B, PM.lens, L, [0, 0.98, 0.56], "z", [[0.06, 0], [0.055, 0.02], [0.0, 0.025]], 16);
  for (const s of [-1, 1]) {
    tubeL(B, PM.plasticBlack, L, [[s * 0.25, 1.0, 0.45], [s * 0.36, 1.0, 0.43]], 0.017, 8, true);
    tubeL(B, PM.chrome, L, [[s * 0.18, 1.05, 0.46], [s * 0.24, 1.25, 0.44]], 0.006, 5);
    ellipsoid(B, PM.chrome, L, [s * 0.25, 1.28, 0.44], 0.055, 0.04, 0.012, 12, 6);
  }
  // the centre stand
  for (const s of [-1, 1]) tubeL(B, PM.steel, L, [[s * 0.1, 0.18, -0.25], [s * 0.12, 0.0, -0.12]], 0.012, 6);
}
