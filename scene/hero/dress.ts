// Street-level dressing for a hero district: the compiled city's footprints, storeys and wires (tools/tokyo/
// hero-extract.ts) turned into buildings a camera can stand next to. Every building is rebuilt whole (the city's tile
// leaves it out: tools/tokyo/to-glb.ts --exclude): walls in generated finishes with grime, doors and windows cut into
// them with depth, the rooms behind the glass, eaves, signs, lanterns, noren, meters, pipes and cables; on the ground
// the alleys' patched asphalt with gutters, grates and manholes; overhead the poles, their lines and the service drops
// to the houses; and the clutter by the doors (generated street models). Deterministic: one seed.
import { GLTFModel, Group, Mesh, type Object3D } from "@threert/scene";
import earcut from "earcut";
import { Batches, Frame, add, mul, norm, rng, type KitPiece, type V3 } from "./builder.ts";
import type { StreetModel } from "./street.ts";
import type { Mats } from "./materials.ts";
import { shopCells } from "./shops.ts";
import { aBoard, beerCases, bicycle, propMaterials, scooter, umbrellaStand, vendingMachine } from "./props.ts";

export interface HeroData {
  /** The wider box: its buildings are rebuilt and dressed for mid distance. */
  box: [number, number, number, number];
  /** The hero box inside it, dressed in full at street level. */
  hero: [number, number, number, number];
  buildings: { id: number; usage: number; storeys: number; flags: number; base: number; height: number; ring: number[]; holes: number[][] }[];
  areas: { kind: number; code: number; rings: number[][] }[];
  props: { kind: number; variant: number; rot: number; x: number; z: number; scale: number }[];
  wires: number[][];
  terrain: { x0: number; z0: number; step: number; w: number; h: number; y: number[] };
}


import { TREE_FORMS, treeKey, treeSites } from "../trees.ts";
/** Cells of the window-inside atlas (tools/tokyo/hero-textures.ts blinds()): 0 shoji, 1 venetian blind, 2 beige
 *  curtains, 3 lace, 4 pale blue curtains, 5 pale green curtains, 6 office ceiling, 7 a room's back wall. */
const BLIND_CELLS = 8;
const blindCell = (i: number): [number, number, number, number] => [i / BLIND_CELLS + 0.002, 0, (i + 1) / BLIND_CELLS - 0.002, 1];
/** The interiors each kind of building shows. */
const INSIDES = { home: [0, 2, 2, 3, 3, 4, 5, 7, 1], office: [1, 1, 6, 6, 6], shop: [1, 2, 3, 7, 6], bar: [0, 2, 3, 7] };
/** The models placed as glTF files: the trees (tools/tokyo/trees.ts). The street models (hero/street.ts) are the kit's. */
export const MODELS: Record<string, { uri: string }> = Object.fromEntries(
  TREE_FORMS.flatMap((_, v) => [treeKey(v, 0), treeKey(v, 1)]).map((key) => [key, { uri: `assets/city/street-models/${key}.glb` }]),
);


export interface FacadeInfo { building: number; o: V3; u: V3; n: V3; length: number; y0: number; small: boolean }

/** A model or a prop placed: what a baked cell carries instead of objects (the city's streaming re-creates them). */
export type Placement = { m: string; at: V3; ry: number; s: number } | { p: string; v: number; at: V3; ry: number };

export interface DressOptions {
  /** Cost studies: no mid-distance dressing / no props. */
  noMid?: boolean;
  noProps?: boolean;
  /** Dress only the buildings whose centroid is in this box (the others are neighbours: what walls face), its poles,
   *  wires and trees. Left out: everything in the data. */
  cell?: [number, number, number, number];
  /** Street-level detail for every building dressed (the near level); else the hero box decides (Golden Gai). */
  full?: boolean;
  /** The alleys' own ground (patched asphalt over the city's): the hero district alone. */
  ground?: boolean;
  /** Record models and props here rather than making objects (baking). */
  record?: Placement[];
  /** Repeated elements (windows, ...) to this sink in their own frames rather than into the batches (baking). */
  kit?: (piece: KitPiece) => void;
}

/** One random stream per building (and per thing outside buildings): what a building looks like does not depend on
 *  which others are dressed with it, so a baked cell and its neighbours agree, and so do the two levels. */
function hashSeed(...xs: number[]) {
  let h = 2166136261;
  for (const x of xs) {
    h ^= Math.floor(x * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** `v` to the nearest multiple of `q`. */
const snap = (v: number, q: number) => Math.round(v / q) * q;
/** A size to the nearest of a geometric series 12 % apart (from 10 cm). */
const sizeStep = (v: number) => 0.1 * Math.pow(1.12, Math.round(Math.log(Math.max(v, 0.1) / 0.1) / Math.log(1.12)));

export function dressDistrict(data: HeroData, M: Mats, night: boolean, seed = 11, ab: DressOptions = {}): { objects: Object3D[]; triangles: number; counts: Record<string, number>; facades: FacadeInfo[]; batches: Batches } {
  let R = rng(seed);
  const B = new Batches();
  B.kit = ab.kit ?? null;
  const objects: Object3D[] = [];
  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  /** The next shop of scene/hero/shops.ts: one name, one look, on all of a shop's signs. */
  let nextShop = 0;
  const PM = propMaterials(night);
  /** Props as instances: a few variants of each built once at the origin facing +z, then placed as clones that share
   *  their geometry (the renderer keeps one copy of each mesh). */
  type PropFn = (B: Batches, PM: ReturnType<typeof propMaterials>, at: V3, facing: V3, R: ReturnType<typeof rng>) => void;
  const protos = new Map<string, Mesh[]>();
  const prop = (fn: PropFn, kind: string, variants: number, at: V3, facing: V3) => {
    const v = R.int(variants), k = `${kind} ${v}`;
    if (ab.record) {
      if (!ab.noProps) ab.record.push({ p: kind, v, at: [...at], ry: Math.atan2(facing[0], facing[2]) });
      count(kind);
      return;
    }
    let ms = protos.get(k);
    if (!ms) {
      const b = new Batches();
      fn(b, PM, [0, 0, 0], [0, 0, 1], rng(seed * 7919 + v * 104729 + kind.length));
      ms = b.meshes(k);
      protos.set(k, ms);
    }
    const g = new Group();
    g.position.set(...at);
    g.rotation.y = Math.atan2(facing[0], facing[2]);
    for (const m of ms) g.add(m.clone());
    if (!ab.noProps) objects.push(g);
    count(kind);
  };
  const propRec = ab.record;
  /** A pane: a closed 4 mm slab (the renderer refracts a single sheet as the face of a solid). */
  const pane = (m: typeof M.glass, f: Frame, s0: number, y0: number, s1: number, y1: number, d: number) => B.box(m, f, s0, s1, y0, y1, d - 0.002, d + 0.002);
  /** Whether a room is lit (2), dim (1) or dark (0) tonight: drawn by day too, so the district is the same at every
   *  hour. */
  const lit = (bright: number, dim: number) => {
    const a = R.chance(bright), b = R.chance(dim);
    return night ? (a ? 2 : b ? 1 : 0) : 0;
  };

  // ---------------------------------------------------------------- the ground's height
  const T = data.terrain;
  const terrain = (x: number, z: number) => {
    const fx = Math.min(Math.max((x - T.x0) / T.step, 0), T.w - 1.001), fz = Math.min(Math.max((z - T.z0) / T.step, 0), T.h - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const y = (a: number, b: number) => T.y[b * T.w + a];
    return (y(i, j) * (1 - tx) + y(i + 1, j) * tx) * (1 - tz) + (y(i, j + 1) * (1 - tx) + y(i + 1, j + 1) * tx) * tz;
  };
  /** The alley's surface: the city's road sits 4-6 cm over the terrain; ours a little above it. */
  const groundY = (x: number, z: number) => terrain(x, z) + 0.075;

  // ---------------------------------------------------------------- footprints
  type Bldg = (typeof data.buildings)[number] & { pts: [number, number][]; bb: [number, number, number, number] };
  const bldgs: Bldg[] = data.buildings.map((b) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < b.ring.length; i += 2) pts.push([b.ring[i], b.ring[i + 1]]);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { ...b, pts, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
  const inside = (pts: [number, number][], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  // a 10 m grid of the footprints, for the many point tests below
  const CELL = 10, grid = new Map<number, Bldg[]>();
  const key = (i: number, j: number) => i * 100003 + j;
  for (const b of bldgs) {
    for (let i = Math.floor(b.bb[0] / CELL); i <= Math.floor(b.bb[2] / CELL); i++) for (let j = Math.floor(b.bb[1] / CELL); j <= Math.floor(b.bb[3] / CELL); j++) {
      const k = key(i, j);
      const l = grid.get(k);
      if (l) l.push(b);
      else grid.set(k, [b]);
    }
  }
  /** The top of the highest building at (x, z) but `skip` (-Infinity: none). */
  const topAt = (x: number, z: number, skip?: Bldg) => {
    let t = -Infinity;
    for (const b of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      if (b !== skip && x >= b.bb[0] - 0.01 && x <= b.bb[2] + 0.01 && z >= b.bb[1] - 0.01 && z <= b.bb[3] + 0.01 && inside(b.pts, x, z)) t = Math.max(t, b.base + b.height);
    }
    return t;
  };
  const inAny = (x: number, z: number, skip?: Bldg) => (grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []).some((b) => b !== skip && x >= b.bb[0] - 0.01 && x <= b.bb[2] + 0.01 && z >= b.bb[1] - 0.01 && z <= b.bb[3] + 0.01 && inside(b.pts, x, z));
  const [bx0, bz0, bx1, bz1] = data.hero ?? data.box;
  const inBox = ab.full !== undefined ? () => !!ab.full : (x: number, z: number) => x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1;
  const inCell = (x: number, z: number) => !ab.cell || (x >= ab.cell[0] && x < ab.cell[2] && z >= ab.cell[1] && z < ab.cell[3]);
  const centroid = (b: Bldg) => { let x = 0, z = 0; for (const [px, pz] of b.pts) { x += px; z += pz; } return [x / b.pts.length, z / b.pts.length] as const; };

  /** Exposed edges: walls that face an open alley (the space 1.2 m in front of them is no building's), or that rise
   *  well above the building in front of them: dressed from `from` (a height; -Infinity: from the ground) up. */
  type Edge = { b: Bldg; f: Frame; L: number; y0: number; top: number; exposed: boolean; floors: number[]; small: boolean; from: number };
  const edges: Edge[] = [];

  /** One window design per building (Tokyo about 1980: aluminium sashes in silver, bronze, white or black; tall, wide,
   *  paired, tripled or banded), its interiors and the colour of its rooms' light. */
  type WinModule = {
    frame: typeof M.aluminium; sash: 1 | 2 | 3; depth: number; hood: boolean; sill: boolean;
    layout: "single" | "pair" | "triple" | "tall" | "wide" | "ribbon"; wFrac: number; hFrac: number;
    temp: "warm" | "neutral" | "cool"; cells: number[];
    bands: boolean; piers: boolean; crown: boolean; trim: typeof M.roof; penthouse: boolean; stair: boolean; neon: number;
  };
  let W: WinModule = { frame: M.aluminium, sash: 2, depth: 0.1, hood: false, sill: true, layout: "single", wFrac: 0.6, hFrac: 0.55, temp: "warm", cells: INSIDES.home, bands: false, piers: false, crown: false, trim: M.trims[0], penthouse: false, stair: false, neon: 0 };
  let stairDone = false;
  const roomFor = (l: number | undefined) => (l === 2 ? M.rooms[W.temp][0] : l === 1 ? M.rooms[W.temp][1] : M.roomDark);

  // ---------------------------------------------------------------- buildings
  for (const b of bldgs) {
    if (!inCell(...centroid(b))) continue;
    R = rng(hashSeed(seed, b.id));
    const small = b.height < 14 && (b.storeys < 5 || b.storeys === 255);
    const storeys = b.storeys >= 1 && b.storeys < 60 ? b.storeys : Math.max(1, Math.round(b.height / 3.1));
    const footY = Math.min(...b.pts.map(([x, z]) => terrain(x, z))) - 0.4;
    const top = Math.max(b.base + b.height, Math.max(...b.pts.map(([x, z]) => terrain(x, z))) + 2.6);
    const wallMat = small ? weighted(R, M.walls, M.wallWeights) : R.pick(M.bigWalls);
    const parapet = small ? R.range(0.5, 1.1) : R.range(0.8, 1.4);
    const st = styleOf(b, storeys);
    W = moduleOf(st, small, storeys);
    stairDone = false;
    for (let i = 0; i < b.pts.length; i++) {
      const [ax, az] = b.pts[i], [cx, cz] = b.pts[(i + 1) % b.pts.length];
      const L = Math.hypot(cx - ax, cz - az);
      if (L < 0.05) continue;
      let u: V3 = [(cx - ax) / L, 0, (cz - az) / L];
      let n: V3 = [-u[2], 0, u[0]];
      const mx = (ax + cx) / 2, mz = (az + cz) / 2;
      // the frame runs left to right for someone outside looking at the wall (n = (-u.z, 0, u.x)): the other way round
      // when the ring does
      let ox = ax, oz = az;
      if (inside(b.pts, mx + n[0] * 0.05, mz + n[2] * 0.05)) {
        u = mul(u, -1);
        n = [-u[2], 0, u[0]];
        ox = cx;
        oz = cz;
      }
      let open = 0, below = -Infinity;
      for (const t of [0.2, 0.5, 0.8]) {
        const qx = ox + u[0] * L * t + n[0] * 1.2, qz = oz + u[2] * L * t + n[2] * 1.2;
        if (inside(b.pts, qx, qz)) continue;
        const nt = topAt(qx, qz, b);
        if (nt === -Infinity) open++;
        else below = Math.max(below, nt);
      }
      // (a tower's wall over a low neighbour, its podium or the block next door: windows from above its roof; a wall left
      // bare all the way up read as a blank slab)
      const over = open < 2 && L >= 2 && top - below > 6 ? below + 0.6 : Infinity;
      const exposed = (open >= 2 && L >= 1.0) || over < Infinity;
      const from = open >= 2 ? -Infinity : over;
      const y0 = groundY(mx, mz);
      const f = new Frame([ox, footY, oz], u, n);
      const gH = small ? Math.min(3.0, (top - parapet - y0) / storeys) : 4.0;
      const upper = storeys > 1 ? (top - parapet - y0 - gH) / (storeys - 1) : 0;
      const floors = [y0, ...Array.from({ length: storeys - 1 }, (_, k) => y0 + gH + k * upper), top - parapet];
      const e: Edge = { b, f, L, y0, top, exposed, floors, small, from };
      edges.push(e);
      const openings: Opening[] = [];
      const hero = inBox(mx, mz);
      if (exposed && hero && small) dressSmall(e, openings, wallMat);
      else if (exposed && L >= 2 && !ab.noMid) dressMid(e, openings, st, i === st.balconyEdge, i === st.longest);
      wall(e, openings, wallMat);
    }
    // the roof: a slab inside the parapet, the coping on the walls round it, and what stands up there
    const ring = b.pts;
    const roofY = top - (small ? 0.25 : 0.9);
    const tris = earcut(ring.flat());
    B.polygon(R.pick(small ? M.roofsSmall : M.roofs), ring.map(([x, z]) => [x, roofY, z] as V3), tris, [0, 1, 0]);
    if (st.highrise) towerRoof(b, st, roofY, wallMat);
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [cx, cz] = ring[(i + 1) % ring.length];
      const L = Math.hypot(cx - ax, cz - az);
      if (L < 0.3) continue;
      const u: V3 = [(cx - ax) / L, 0, (cz - az) / L], n: V3 = [-u[2], 0, u[0]];
      const inward = inside(b.pts, (ax + cx) / 2 + n[0] * 0.1, (az + cz) / 2 + n[2] * 0.1) ? n : mul(n, -1);
      const cf = new Frame([ax, top, az], u, mul(inward, -1));
      B.box(M.coping, cf, 0, L, -0.06, 0.02, -0.22, 0.03, { skip: "d" });
      // the parapet's inner face
      if (!small) B.rect(M.coping, cf, 0, -(top - roofY), L, -0.06, -0.2, undefined, inward);
    }
    // (a tower's roof is its own: towerRoof)
    if (!st.highrise) rooftop(b, roofY, small, wallMat, storeys);
    count("buildings");
  }

  type Opening = { s0: number; s1: number; y0: number; y1: number; depth: number; reveal?: typeof M.roof };

  /** The wall of one edge from its foot to its top, with the openings left out and their reveals in. */
  function wall(e: Edge, openings: Opening[], mat: typeof M.roof) {
    const { f, L, top } = e;
    const base = f.o[1];
    const plinthTop = e.y0 + 0.28 - base;
    const ss = new Set([0, L]), ys = new Set([0, top - base, plinthTop]);
    for (const o of openings) {
      ss.add(o.s0); ss.add(o.s1);
      ys.add(o.y0 - base); ys.add(o.y1 - base);
    }
    const S = [...ss].filter((s) => s >= 0 && s <= L).sort((a, b) => a - b);
    const Y = [...ys].filter((y) => y >= 0 && y <= top - base).sort((a, b) => a - b);
    // row by row, runs of solid cells merged into one quad each (a facade of many windows is far fewer triangles)
    for (let j = 0; j + 1 < Y.length; j++) {
      if (Y[j + 1] - Y[j] < 1e-4) continue;
      const yc = (Y[j] + Y[j + 1]) / 2 + base;
      const rowMat = e.exposed && yc - base < plinthTop ? M.plinth : mat;
      let run = -1;
      for (let i = 0; i + 1 <= S.length; i++) {
        const solid = i + 1 < S.length && S[i + 1] - S[i] >= 1e-4 && !openings.some((o) => (S[i] + S[i + 1]) / 2 > o.s0 && (S[i] + S[i + 1]) / 2 < o.s1 && yc > o.y0 && yc < o.y1);
        if (solid && run < 0) run = i;
        if (!solid && run >= 0) {
          B.rect(rowMat, f, S[run], Y[j], S[i], Y[j + 1], 0);
          run = -1;
        }
      }
    }
    // reveals: the opening's sides, head and sill, `depth` into the wall
    for (const o of openings) {
      const y0 = o.y0 - base, y1 = o.y1 - base, d = -o.depth, rm = o.reveal ?? mat;
      B.quad(rm, f.p(o.s0, y0, 0), f.p(o.s0, y0, d), f.p(o.s0, y1, d), f.p(o.s0, y1, 0), f.u, [[0, -y0], [d, -y0], [d, -y1], [0, -y1]]);
      B.quad(rm, f.p(o.s1, y0, 0), f.p(o.s1, y0, d), f.p(o.s1, y1, d), f.p(o.s1, y1, 0), mul(f.u, -1), [[0, -y0], [d, -y0], [d, -y1], [0, -y1]]);
      B.quad(rm, f.p(o.s0, y1, 0), f.p(o.s1, y1, 0), f.p(o.s1, y1, d), f.p(o.s0, y1, d), [0, -1, 0], [[o.s0, 0], [o.s1, 0], [o.s1, d], [o.s0, d]]);
      B.quad(rm, f.p(o.s0, y0, 0), f.p(o.s1, y0, 0), f.p(o.s1, y0, d), f.p(o.s0, y0, d), [0, 1, 0], [[o.s0, 0], [o.s1, 0], [o.s1, d], [o.s0, d]]);
    }
  }

  /** A model at a world point, turned so its +z faces `facing`, its own node offset undone. */
  function place(key: StreetModel | string, at: V3, facing: V3, scale = 1, spin = 0) {
    const m = MODELS[key];
    if (ab.record) {
      if (!ab.noProps) ab.record.push({ m: key, at: [...at], ry: Math.atan2(facing[0], facing[2]) + spin, s: scale });
      count(key);
      return null;
    }
    if (!m) return null;
    const g = new Group();
    g.position.set(...at);
    g.rotation.y = Math.atan2(facing[0], facing[2]) + spin;
    g.scale.setScalar(scale);
    const model = new GLTFModel(m.uri);
    g.add(model);
    if (!ab.noProps) objects.push(g);
    count(key);
    return g;
  }

  /** A window: aluminium frame, sliding sashes, the glass, the room behind it; the opening into `openings`. One kit
   *  element (its frame, glass, sill and hood; the room behind is the cell's: its picture and light vary). */
  function windowAt(e: Edge, openings: Opening[], s0: number, s1: number, y0: number, y1: number, o: Parameters<typeof drawWindow>[6]) {
    // Drawn at a standard size, the nearest of a few (12 % apart), and stretched to its own: one kit piece per size and
    // kind of window. The bars stretch with it (by 6 % at most: a couple of millimetres).
    // Two pieces: what sits in the opening (its frame and glass, from the recess: one piece whatever the wall's
    // depth) and what is on the wall (the sill, the hood, a grille).
    const w = s1 - s0, h = y1 - y0, ws = sizeStep(w), hs = sizeStep(h), depth = snap(o.depth ?? W.depth, 0.02), scale: V3 = [w / ws, h / hs, 1];
    openings.push({ s0, s1, y0, y1, depth });
    B.begin(e.f, s0, y0 - e.f.o[1], scale, -depth);
    drawWindow(e, null, s0, s0 + ws, y0, y0 + hs, o, () => {
      B.end();
      B.begin(e.f, s0, y0 - e.f.o[1], scale);
    });
    B.end();
  }
  function drawWindow(e: Edge, openings: Opening[] | null, s0: number, s1: number, y0: number, y1: number, o: { frosted?: boolean; lit?: number; grille?: boolean; inside?: number; frame?: typeof M.aluminium; depth?: number; bar?: boolean; shop?: boolean; hood?: boolean }, outside = () => {}) {
    const f = e.f, base = f.o[1], depth = snap(o.depth ?? W.depth, 0.02);
    openings?.push({ s0, s1, y0, y1, depth });
    const Y0 = y0 - base, Y1 = y1 - base, fr = o.frame ?? W.frame, t = 0.035, d = -depth;
    const cellIx = o.inside ?? R.pick(W.cells);
    // the sashes: two sliding, three, or one fixed pane under a transom
    const sash = W.sash, w = s1 - s0, transom = sash === 1 && Y1 - Y0 > 1.0 ? Y1 - Math.min(0.45, (Y1 - Y0) * 0.28) : 0;
    const hood = (o.hood ?? W.hood) && !o.shop;
    if (!inBox(f.o[0], f.o[2]) && !o.shop) {
      // seen from the next block: the frame's front faces, the mullions, one pane, the room
      B.rect(fr, f, s0, Y0, s1, Y0 + t, d + 0.04);
      B.rect(fr, f, s0, Y1 - t, s1, Y1, d + 0.04);
      B.rect(fr, f, s0, Y0 + t, s0 + t, Y1 - t, d + 0.04);
      B.rect(fr, f, s1 - t, Y0 + t, s1, Y1 - t, d + 0.04);
      for (let q = 1; q < sash; q++) B.rect(fr, f, s0 + (w * q) / sash - 0.02, Y0 + t, s0 + (w * q) / sash + 0.02, Y1 - t, d + 0.035);
      if (transom) B.rect(fr, f, s0 + t, transom - 0.02, s1 - t, transom + 0.02, d + 0.035);
      pane(M.glass, f, s0 + t, Y0 + t, s1 - t, Y1 - t, d + 0.02);
      B.rect(roomFor(o.lit), f, s0, Y0, s1, Y1, d - 0.3, blindCell(cellIx));
      outside();
      if (hood) B.box(W.frame, f, s0 - 0.1, s1 + 0.1, Y1 + 0.06, Y1 + 0.1, 0, 0.3, { skip: "b" });
      count("windows");
      return;
    }
    // frame
    B.box(fr, f, s0, s1, Y0, Y0 + t, d, d + 0.05, { skip: "b" });
    B.box(fr, f, s0, s1, Y1 - t, Y1, d, d + 0.05, { skip: "b" });
    B.box(fr, f, s0, s0 + t, Y0, Y1, d, d + 0.05, { skip: "b" });
    B.box(fr, f, s1 - t, s1, Y0, Y1, d, d + 0.05, { skip: "b" });
    const glassM = o.frosted ? M.frosted : M.glass;
    if (sash === 1) {
      // a fixed pane, a transom light over it
      if (transom) B.box(fr, f, s0 + t, s1 - t, transom - 0.02, transom + 0.02, d + 0.005, d + 0.045, { skip: "b" });
      pane(glassM, f, s0 + t, Y0 + t, s1 - t, Y1 - t, d + 0.025);
    } else {
      // sliding sashes, each a little behind the last, their meeting stiles
      for (let q = 0; q < sash; q++) {
        const a0 = s0 + (w * q) / sash, a1 = s0 + (w * (q + 1)) / sash, dz = q % 2 ? -0.005 : 0.03;
        pane(glassM, f, q ? a0 : a0 + t, Y0 + t, q === sash - 1 ? a1 - t : a1, Y1 - t, d + dz);
        if (q) B.box(fr, f, a0 - 0.02, a0 + 0.02, Y0 + t, Y1 - t, d - 0.015, d + 0.045, { skip: "b" });
      }
    }
    // the room behind
    if (o.shop) {
      // a shop's inside: a lit back wall well behind the glass
      const ci = o.inside ?? R.int(4);
      B.rect(o.lit ? M.roomShop : M.roomDark, f, s0 - 0.3, Y0 - 0.1, s1 + 0.3, Y1 + 0.3, d - 2.2, [ci / 4 + 0.01, 0, (ci + 1) / 4 - 0.01, 1]);
      B.flat(M.coping, f, s0, s1, d - 2.2, d, Y0 - 0.02);
    } else if (o.bar && o.frosted) {
      // a bar behind frosted glass: its inside, further back
      const ci = R.int(4);
      B.rect(o.lit ? M.roomBar : M.roomDark, f, s0 - 0.2, Y0 - 0.2, s1 + 0.2, Y1 + 0.2, d - 0.7, [ci / 4 + 0.01, 0.2, (ci + 1) / 4 - 0.01, 0.8]);
    } else {
      B.rect(roomFor(o.lit), f, s0, Y0, s1, Y1, d - 0.25, blindCell(cellIx));
    }
    outside();
    // a sill, and a hood over the houses' windows (the aluminium kirivoke)
    if (W.sill || o.shop) B.box(M.coping, f, s0 - 0.04, s1 + 0.04, Y0 - 0.05, Y0, -0.02, 0.06);
    if (hood) {
      B.box(W.frame, f, s0 - 0.1, s1 + 0.1, Y1 + 0.06, Y1 + 0.09, 0, 0.32, { skip: "b" });
      for (const sx of [s0 - 0.1, s1 + 0.08]) B.box(W.frame, f, sx, sx + 0.02, Y1 - 0.08, Y1 + 0.06, 0, 0.3, { skip: "b" });
    }
    if (o.grille) {
      const n = Math.max(3, Math.round((s1 - s0) / 0.12));
      for (let k = 1; k < n; k++) {
        const s = s0 + ((s1 - s0) * k) / n;
        B.tube(M.aluminium, [f.p(s, Y0 - 0.02, 0.09), f.p(s, Y1 + 0.02, 0.09)], 0.009, 5);
      }
      for (const yy of [Y0 + 0.02, Y1 - 0.02, (Y0 + Y1) / 2]) B.box(M.aluminium, f, s0 - 0.05, s1 + 0.05, yy - 0.012, yy + 0.012, 0.06, 0.1);
      for (const s of [s0 - 0.04, s1 + 0.04]) B.box(M.aluminium, f, s - 0.015, s + 0.015, Y0 - 0.03, Y1 + 0.03, 0, 0.1);
    }
    count("windows");
  }

  /** A neon tube along points (a frame of a fixed depth), lit by night. */
  function neonLine(f: Frame, pts: [number, number][], d: number, mat: (typeof M.neon)[number]) {
    B.tube(mat, pts.map(([sx, sy]) => f.p(sx, sy, d)), 0.011, 5);
    count("neon");
  }
  /** A neon outline round a rectangle (a sign's frame), sometimes doubled. */
  function neonRect(f: Frame, s0: number, y0: number, s1: number, y1: number, d: number, mat: (typeof M.neon)[number], twice = false) {
    neonLine(f, [[s0, y0], [s1, y0], [s1, y1], [s0, y1], [s0, y0]], d, mat);
    if (twice) neonLine(f, [[s0 + 0.06, y0 + 0.06], [s1 - 0.06, y0 + 0.06], [s1 - 0.06, y1 - 0.06], [s0 + 0.06, y1 - 0.06], [s0 + 0.06, y0 + 0.06]], d, mat);
  }
  /** A small neon emblem on a wall: a wave, a zigzag, a star, a cocktail glass, a heart-like loop. */
  function neonShape(f: Frame, cs: number, cy: number, size: number, d: number, mat: (typeof M.neon)[number]) {
    const k = R.int(5), r = size / 2;
    if (k === 0) neonLine(f, Array.from({ length: 13 }, (_, i) => [cs - r + (i / 12) * size, cy + Math.sin((i / 12) * Math.PI * 3) * r * 0.3] as [number, number]), d, mat);
    else if (k === 1) neonLine(f, Array.from({ length: 7 }, (_, i) => [cs - r + (i / 6) * size, cy + (i % 2 ? r * 0.4 : -r * 0.4)] as [number, number]), d, mat);
    else if (k === 2) neonLine(f, Array.from({ length: 11 }, (_, i) => { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.4 : r; return [cs + Math.cos(a) * rr, cy + Math.sin(a) * rr] as [number, number]; }), d, mat);
    else if (k === 3) {
      neonLine(f, [[cs - r, cy + r], [cs + r, cy + r], [cs, cy], [cs - r, cy + r]], d, mat);
      neonLine(f, [[cs, cy], [cs, cy - r * 0.8], [cs - r * 0.5, cy - r * 0.8], [cs + r * 0.5, cy - r * 0.8]], d, mat);
    } else neonLine(f, Array.from({ length: 17 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return [cs + Math.sin(a) * r, cy + Math.cos(a) * r * 0.7 + Math.abs(Math.sin(a)) * r * 0.25] as [number, number]; }), d, mat);
  }

  /** A lightbox over a door: a dark metal box with the lit face (lightbox.png's 4 x 8 cells). */
  function lightboxAt(f: Frame, s0: number, s1: number, y0: number, y1: number, depth = 0.13, shop = shopCells(nextShop++)) {
    R.int(32); // (the draw the generic atlas took: the layout stays as it was)
    B.box(M.signFrame, f, s0, s1, y0, y1, 0, depth, { front: M.shop(shop.page).box, frontUV: shop.lightbox });
    count("lightboxes");
  }

  /** The dressing of a small building's open wall (Golden Gai's bars): its ground floor unit by unit, the floors above. */
  function dressSmall(e: Edge, openings: Opening[], wallMat: typeof M.roof) {
    const { f, L, floors } = e;
    const base = f.o[1], y0 = floors[0], gTop = floors[1] ?? floors[floors.length - 1];
    const units = Math.max(1, Math.round(L / R.range(2.6, 3.6)));
    const uw = L / units;
    for (let k = 0; k < units; k++) {
      const s0 = k * uw + 0.12, s1 = (k + 1) * uw - 0.12, w = s1 - s0;
      if (w < 0.9) continue;
      const Y = (y: number) => y - base;
      // a unit closed by a shutter, now and then (a store room, a bar not open yet)
      if (R.chance(0.06) && w > 1.6) {
        const sh = Math.min(2.35, gTop - y0 - 0.35);
        openings.push({ s0, s1, y0, y1: y0 + sh, depth: 0.06 });
        B.rect(R.chance(0.5) ? M.shutter : M.shutterPainted, f, s0, Y(y0), s1, Y(y0 + sh), -0.06);
        B.box(M.steelDark, f, s0 - 0.05, s1 + 0.05, Y(y0 + sh), Y(y0 + sh + 0.28), -0.02, 0.18);
        count("shutters");
        continue;
      }
      // the door, at one side of the unit; a window beside it if there is room
      const shop = shopCells(nextShop++), SM = M.shop(shop.page);
      const dw = R.range(0.72, 0.9), dh = R.range(1.82, 2.0);
      const left = R.chance(0.5);
      const ds0 = left ? s0 + 0.15 : s1 - 0.15 - dw, ds1 = ds0 + dw;
      const glassDoor = R.chance(0.35);
      openings.push({ s0: ds0, s1: ds1, y0, y1: y0 + dh, depth: 0.14 });
      if (glassDoor) {
        const t = 0.045;
        B.box(M.aluminiumDark, f, ds0, ds1, Y(y0), Y(y0 + t * 2), -0.14, -0.09, { skip: "b" });
        B.box(M.aluminiumDark, f, ds0, ds1, Y(y0 + dh - t), Y(y0 + dh), -0.14, -0.09, { skip: "b" });
        B.box(M.aluminiumDark, f, ds0, ds0 + t, Y(y0), Y(y0 + dh), -0.14, -0.09, { skip: "b" });
        B.box(M.aluminiumDark, f, ds1 - t, ds1, Y(y0), Y(y0 + dh), -0.14, -0.09, { skip: "b" });
        pane(M.frosted, f, ds0 + t, Y(y0 + 2 * t), ds1 - t, Y(y0 + dh - t), -0.115);
        for (const h of [0.33, 0.66]) B.box(M.aluminiumDark, f, ds0 + t, ds1 - t, Y(y0 + dh * h - 0.015), Y(y0 + dh * h + 0.015), -0.13, -0.1, { skip: "b" });
        const ci = R.int(4);
        B.rect(lit(0.75, 0) ? M.roomBar : M.roomDark, f, ds0 - 0.3, Y(y0 - 0.1), ds1 + 0.3, Y(y0 + dh + 0.2), -0.9, [ci / 4 + 0.01, 0, (ci + 1) / 4 - 0.01, 1]);
      } else {
        const door = R.pick(M.doorWood);
        B.box(door, f, ds0, ds1, Y(y0), Y(y0 + dh), -0.14, -0.1, { skip: "b" });
        // a small frosted light in the door, lit from inside
        if (R.chance(0.6)) {
          const ws0 = ds0 + dw * 0.3, ws1 = ds1 - dw * 0.3, wy0 = y0 + dh * 0.55, wy1 = y0 + dh * 0.8;
          pane(M.frosted, f, ws0, Y(wy0), ws1, Y(wy1), -0.095);
          const ci = R.int(4);
          B.rect(lit(0.75, 0) ? M.roomBar : M.roomDark, f, ws0, Y(wy0), ws1, Y(wy1), -0.105, [ci / 4 + 0.05, 0.3, (ci + 1) / 4 - 0.05, 0.7]);
        }
        // the shop's name plate on its door
        {
          const pw = Math.min(0.42, dw - 0.2);
          B.rect(SM.plate, f, ds0 + 0.1, Y(y0 + 1.55), ds0 + 0.1 + pw, Y(y0 + 1.55 + pw / 3), -0.098, [shop.plate[0], 1 - shop.plate[3], shop.plate[2], 1 - shop.plate[1]]);
        }
        // a notice or the open sign on the door
        if (R.chance(0.55)) {
          const c = R.int(8), w2 = R.range(0.16, 0.24), ns = ds0 + dw * R.range(0.25, 0.55);
          B.rect(M.notices, f, ns, Y(y0 + 1.25), ns + w2, Y(y0 + 1.25 + w2), -0.098, [(c % 4) / 4 + 0.01, c < 4 ? 0.51 : 0.01, (c % 4 + 1) / 4 - 0.01, c < 4 ? 0.99 : 0.49]);
        }
        // the handle
        const hs = left ? ds1 - 0.09 : ds0 + 0.07;
        B.box(M.steelDark, f, hs, hs + 0.02, Y(y0 + 0.95), Y(y0 + 1.1), -0.1, -0.06);
      }
      // a small lamp over the door: a bracket and a frosted globe
      if (R.chance(0.6)) {
        const ls = left ? ds1 + 0.12 : ds0 - 0.12, ly = y0 + dh + 0.12;
        B.box(M.steelDark, f, ls - 0.04, ls + 0.04, Y(ly - 0.06), Y(ly + 0.06), 0, 0.03);
        B.tube(M.steelDark, [f.p(ls, Y(ly), 0.03), f.p(ls, Y(ly), 0.16)], 0.008, 5);
        B.lantern(M.globe, f.p(ls, Y(ly - 0.07), 0.16), 0.055, 0.12, 7, 3);
        count("doorLamps");
      }
      // a step at the door
      B.box(M.coping, f, ds0 - 0.08, ds1 + 0.08, Y(y0 - 0.05), Y(y0 + 0.08), -0.14, 0.2);
      const rest0 = left ? ds1 + 0.25 : s0 + 0.1, rest1 = left ? s1 - 0.1 : ds0 - 0.25;
      if (rest1 - rest0 > 0.7) {
        const ww = Math.min(rest1 - rest0, R.range(0.6, 1.5)), wc = (rest0 + rest1) / 2;
        const wy0 = y0 + R.range(0.9, 1.1), wy1 = wy0 + R.range(0.5, 0.85);
        windowAt(e, openings, wc - ww / 2, wc + ww / 2, wy0, wy1, { frosted: R.chance(0.6), lit: lit(0.65, 1), grille: R.chance(0.45), bar: true });
      }
      // posters and a meter
      if (rest1 - rest0 > 0.5 && R.chance(0.3)) {
        const c = R.int(8), ps = R.range(rest0, Math.max(rest0, rest1 - 0.4));
        B.rect(M.poster, f, ps, Y(y0 + 1.25), ps + 0.36, Y(y0 + 1.75), 0.004, [(c % 4) / 4, Math.floor(c / 4) / 2, (c % 4 + 1) / 4, Math.floor(c / 4) / 2 + 0.5]);
      }
      if (R.chance(0.45)) {
        const ms = left ? ds1 + 0.08 : ds0 - 0.3;
        B.box(M.paintMetal, f, ms, ms + 0.22, Y(y0 + 1.45), Y(y0 + 1.75), 0, 0.12, { skip: "b" });
        B.box(M.pvcDark, f, ms + 0.09, ms + 0.13, Y(y0 + 0.2), Y(y0 + 1.45), 0.03, 0.07, { skip: "b" });
      }
      // the sign over the door (a lightbox), or a blade sign out from the wall at the unit's edge
      const signY = y0 + dh + R.range(0.12, 0.3);
      let signTop = 0;
      if (R.chance(0.8) && signY + 0.5 < gTop) {
        const sw = Math.min(w - 0.2, R.range(0.75, 1.15)), sc = (ds0 + ds1) / 2 + (left ? 0.15 : -0.15);
        signTop = signY + sw * 0.47;
        if (R.chance(W.neon)) neonRect(f, Math.max(s0, sc - sw / 2) - 0.05, Y(signY) - 0.05, Math.min(s1, sc - sw / 2 + sw) + 0.05, Y(signTop) + 0.05, 0.135, R.pick(M.neon));
        lightboxAt(f, Math.max(s0, sc - sw / 2), Math.min(s1, sc - sw / 2 + sw), Y(signY), Y(signY + sw * 0.47), 0.13, shop);
      }
      if (R.chance(0.55)) {
        const bs = left ? s1 - 0.05 : s0 + 0.05, by0 = gTop + R.range(-0.4, 0.4), bh = R.range(1.1, 1.6);
        // (its frame runs out of the wall along -u so that its faces read left to right from both sides)
        const bf = new Frame(f.p(bs, 0, 0), mul(f.n, -1), f.u);
        const c = R.int(16);
        // brackets, then the box: its two faces lit (blade.png's cells), facing up and down the alley
        B.box(M.steelDark, bf, -0.18, 0, Y(by0 + 0.1), Y(by0 + 0.14), -0.02, 0.02);
        B.box(M.steelDark, bf, -0.18, 0, Y(by0 + bh - 0.14), Y(by0 + bh - 0.1), -0.02, 0.02);
        B.box(M.signFrame, bf, -0.16 - bh * 0.27, -0.16, Y(by0), Y(by0 + bh), -0.06, 0.06, { front: SM.blade, frontUV: shop.blade, back: SM.blade, backUV: shop.blade });
        void c;
        count("blades");
      }
      // an eave over the unit (corrugated sheet on two brackets), bulbs under some
      let eaveY = 0;
      if (R.chance(0.5)) {
        // over the sign if there is one, else just over the door
        const ey = Math.min(gTop - 0.1, Math.max(y0 + dh + 0.75, signTop + 0.12)), ed = R.range(0.45, 0.75), drop = ed * 0.12;
        eaveY = ey;
        const a = f.p(s0 - 0.03, Y(ey), 0), b = f.p(s1 + 0.03, Y(ey), 0), c = f.p(s1 + 0.03, Y(ey) - drop, ed), d = f.p(s0 - 0.03, Y(ey) - drop, ed);
        const nUp = norm([f.n[0] * drop, ed, f.n[2] * drop]);
        B.quad(M.corrugatedEave, a, b, c, d, nUp, [[s0, 0], [s1, 0], [s1, ed], [s0, ed]]);
        B.quad(M.corrugatedEave, add(a, [0, -0.02, 0]), add(b, [0, -0.02, 0]), add(c, [0, -0.02, 0]), add(d, [0, -0.02, 0]), mul(nUp, -1), [[s0, 0], [s1, 0], [s1, ed], [s0, ed]]);
        B.box(M.steelDark, f, s0 - 0.03, s1 + 0.03, Y(ey) - drop - 0.06, Y(ey) - drop, ed - 0.03, ed + 0.01);
        for (const s of [s0 + 0.1, s1 - 0.1]) B.tube(M.steelDark, [f.p(s, Y(ey) - 0.45, 0.01), f.p(s, Y(ey) - drop * 0.6 - 0.02, ed * 0.75)], 0.012, 5);
        if (R.chance(0.45)) {
          const bs = R.range(s0 + 0.3, s1 - 0.3), at = f.p(bs, Y(ey) - drop * 0.4 - 0.02, ed * 0.45);
          place("socket", at, f.n);
          B.cylinder(M.bulb, add(at, [0, -0.25, 0]), 0.032, 0.032, 0.07, 6);
          B.lantern(M.bulb, add(at, [0, -0.26, 0]), 0.035, 0.06, 6, 2);
          count("bulbs");
        }
      }
      // a paper lantern by the door
      if (R.chance(0.3)) {
        const ls = left ? ds1 + 0.25 : ds0 - 0.25, ly = y0 + dh + 0.05, c = R.int(4);
        const at = f.p(ls, Y(ly), 0.32);
        // its arm from the wall
        B.tube(M.steelDark, [f.p(ls, Y(ly + 0.42), 0), f.p(ls, Y(ly + 0.42), 0.34), f.p(ls, Y(ly + 0.3), 0.34)], 0.01, 5);
        lanternMesh(at, 0.17, 0.5, c);
        count("lanterns");
      }
      // noren over a wooden door
      if (!glassDoor && R.chance(0.35)) {
        const c = R.int(4), panels = 3, top = y0 + dh + 0.02, hgt = R.range(0.5, 0.75);
        B.tube(M.steelDark, [f.p(ds0 - 0.08, Y(top + 0.02), 0.06), f.p(ds1 + 0.08, Y(top + 0.02), 0.06)], 0.012, 6);
        for (let p = 0; p < panels; p++) {
          const a0 = ds0 - 0.06 + ((dw + 0.12) * p) / panels + 0.01, a1 = ds0 - 0.06 + ((dw + 0.12) * (p + 1)) / panels - 0.01;
          const sway = R.range(-0.015, 0.015);
          const nc = shop.noren, vb = 1 - nc[3], vt = 1 - nc[1];
          const u0 = nc[0] + ((nc[2] - nc[0]) * p) / panels, u1 = nc[0] + ((nc[2] - nc[0]) * (p + 1)) / panels;
          void c;
          // the cloth in folds: strips alternately forward and back, deeper at the hem
          const strips = 6;
          for (let q = 0; q < strips; q++) {
            const t0 = q / strips, t1 = (q + 1) / strips;
            const z0 = (q % 2 ? 0.012 : -0.012), z1 = ((q + 1) % 2 ? 0.012 : -0.012);
            const sa = a0 + (a1 - a0) * t0, sb = a0 + (a1 - a0) * t1, ua = u0 + (u1 - u0) * t0, ub = u0 + (u1 - u0) * t1;
            const pa = f.p(sa, Y(top - hgt), 0.07 + sway + z0 * 1.6), pb = f.p(sb, Y(top - hgt), 0.07 + sway + z1 * 1.6), pc = f.p(sb, Y(top), 0.06 + z1 * 0.5), pd = f.p(sa, Y(top), 0.06 + z0 * 0.5);
            const nn = norm(add(f.n, mul(f.u, (z0 - z1) * 8)));
            B.quad(SM.cloth, pa, pb, pc, pd, nn, [[ua, vb], [ub, vb], [ub, vt], [ua, vt]]);
          }
        }
        count("noren");
      }
      // a standing sign on the ground before the door
      if (R.chance(0.3)) {
        const ss = left ? Math.min(s1 - 0.3, ds1 + 0.35) : Math.max(s0 + 0.3, ds0 - 0.35), at = f.p(ss, 0, 0.55);
        const sf = new Frame([at[0], f.o[1], at[2]], mul(f.n, -1), f.u);
        const c = R.int(16), gy = groundY(at[0], at[2]) - base;
        B.box(M.signFrame, sf, -0.14, 0.14, gy + 0.02, gy + 0.14, -0.2, 0.2);
        B.box(M.signFrame, sf, -0.12, 0.12, gy + 0.14, gy + 1.0, -0.17, 0.17, { front: SM.blade, frontUV: shop.standing, back: SM.blade, backUV: shop.standing });
        void c;
        count("standing");
      }
      // what stands by the door
      const clutter = (s: number, d: number) => {
        const at = f.p(s, 0, d), gy = groundY(at[0], at[2]);
        return [at[0], gy, at[2]] as V3;
      };
      const free0 = left ? ds1 + 0.35 : s0 + 0.2, free1 = left ? s1 - 0.2 : ds0 - 0.35;
      for (let pick = 0; pick < 2 && free1 - free0 > 0.35; pick++) {
        const roll = R.next();
        const s = R.range(free0, free1);
        // kept tidy: plants and a stool by the door, crates stacked square, a bin bag only now and then
        if (roll < 0.14) {
          const kind = R.pick(["crate1", "crate2", "crate3"] as const);
          const h = kind === "crate3" ? 0.27 : 0.26, n = 1 + R.int(3);
          for (let q = 0; q < n; q++) place(kind, add(clutter(s, 0.28), [0, q * h, 0]), f.n, 1, (R.next() - 0.5) * 0.06);
        } else if (roll < 0.19) place("propane", clutter(s, 0.25), f.n, 1, R.next() * 6);
        else if (roll < 0.22) {
          place("trashbag", clutter(s, 0.3 + R.range(0, 0.2)), f.n, R.range(0.8, 1.0), R.next() * 6);
        } else if (roll < 0.47) place(R.pick(["plant1", "plant2", "planter", "plant2"] as const), clutter(s, 0.3), f.n, R.range(0.8, 1.0), R.next() * 6);
        else if (roll < 0.55) place("stool", clutter(s, 0.35), f.n, 1, R.next() * 6);
        else if (roll < 0.58) place("box", clutter(s, 0.3), f.n, 1, R.next() * 6);
        else if (roll < 0.62) place("planter", clutter(s, 0.3), f.n, 1, R.next() * 0.2);
        else if (roll < 0.8) {
          for (let q = 0; q < 2 + R.int(3); q++) place("plant4", clutter(s + q * 0.18, 0.15), f.n, R.range(1.2, 2.0), R.next() * 6);
        } else if (roll < 0.86) prop((b, pm, a, fc, r) => beerCases(b, pm, a, fc, r, 3), "beercases", 6, clutter(s, 0.3), f.n);
        else if (roll < 0.91) prop(umbrellaStand, "umbrellas", 4, clutter(s, 0.25), f.n);
        else if (roll < 0.96) prop(aBoard, "aboard", 4, clutter(s, 0.45), f.n);
      }
      // a neon emblem on the wall now and then
      if (R.chance(0.12) && w > 1.6) neonShape(f, left ? s1 - 0.45 : s0 + 0.45, Y(y0 + dh + 0.4), 0.45, 0.05, R.pick(M.neon));
      // a bicycle or a scooter left against the wall
      if (R.chance(0.2) && w > 2.0) {
        const bs = R.range(s0 + 0.95, s1 - 0.95), at = f.p(bs, 0, R.range(0.4, 0.55)), gy = groundY(at[0], at[2]);
        if (R.chance(0.75)) prop(bicycle, "bike", 8, [at[0], gy, at[2]], R.chance(0.5) ? f.u : mul(f.u, -1));
        else prop(scooter, "scooter", 4, [at[0], gy, at[2]], R.chance(0.5) ? f.u : mul(f.u, -1));
        count("bikes");
      }
      void eaveY;
      count("units");
    }
    // the floors above: windows unit by unit, air conditioners, signs
    for (let fl = 1; fl + 1 < floors.length; fl++) {
      const fy = floors[fl], fh = floors[fl + 1] - fy;
      for (let k = 0; k < units; k++) {
        const s0 = k * uw + 0.2, s1 = (k + 1) * uw - 0.2;
        if (s1 - s0 < 0.8) continue;
        const ww = Math.min(s1 - s0 - 0.1, R.range(0.8, 1.6)), wc = R.range(s0 + ww / 2, s1 - ww / 2);
        const wy0 = fy + R.range(0.75, 0.95), wy1 = Math.min(fy + fh - 0.3, wy0 + R.range(0.85, 1.2));
        if (wy1 - wy0 > 0.5) windowAt(e, openings, wc - ww / 2, wc + ww / 2, wy0, wy1, { frosted: R.chance(0.3), lit: lit(0.45, 0.4), grille: R.chance(0.25) });
        // an air conditioner on a bracket under the window or beside it
        if (R.chance(0.35)) {
          const as = wc + (R.chance(0.5) ? -1 : 1) * Math.min(0.2, (s1 - s0) * 0.1), ay = fy + R.range(0.05, 0.25);
          const at = f.p(as, ay - f.o[1] + 0.32, 0.25);
          place(R.chance(0.6) ? "aircon" : "aircon", at, f.n, 0.82);
          B.box(M.steelDark, f, as - 0.35, as - 0.32, ay - f.o[1], ay - f.o[1] + 0.04, 0, 0.42);
          B.box(M.steelDark, f, as + 0.32, as + 0.35, ay - f.o[1], ay - f.o[1] + 0.04, 0, 0.42);
          // its pipes down the wall
          B.tube(M.pvc, [f.p(as - 0.25, ay - f.o[1] + 0.3, 0.05), f.p(as - 0.25, ay - f.o[1] - 1.2, 0.05)], 0.025, 6);
          count("aircons");
        }
        if (R.chance(0.35)) {
          const sw = Math.min(s1 - s0 - 0.2, 0.9);
          const sy = fy + fh - 0.25 - sw * 0.47;
          if (sy > wy1 + 0.05) lightboxAt(f, wc - sw / 2, wc + sw / 2, sy - f.o[1], sy + sw * 0.47 - f.o[1], 0.1);
        }
      }
    }
    // pipes: a drain from the roof gutter down a corner; cables along the front
    const top = floors[floors.length - 1] + 0.4;
    if (R.chance(0.6)) {
      const ps = R.chance(0.5) ? 0.12 : L - 0.12;
      B.tube(M.pvc, [f.p(ps, top - f.o[1], 0.09), f.p(ps, y0 + 0.1 - f.o[1], 0.09)], 0.045, 8);
      B.tube(M.pvc, [f.p(0, top - f.o[1] - 0.1, 0.1), f.p(L, top - f.o[1] - 0.1, 0.1)], 0.055, 8);
    }
    const nCables = R.int(4);
    for (let c = 0; c < nCables; c++) {
      const cy = gTop + R.range(0.1, 0.9) - f.o[1], cd = R.range(0.03, 0.08), r = R.range(0.006, 0.014);
      const pts: V3[] = [];
      // (clipped every 1.1 m, drooping between: a point at each clip and one between)
      const steps = Math.max(2, Math.round(L / 1.1));
      for (let k = 0; k <= steps * 2; k++) {
        const t = k / (steps * 2), sag = k % 2 ? 0.03 : 0;
        pts.push(f.p(t * L, cy - sag, cd));
      }
      B.tube(c % 2 ? M.cable : M.cableGrey, pts, r, 4);
    }
    // the gas: a yellow pipe low along the wall, rising to its meter
    if (R.chance(0.5) && L > 1.5) {
      const gy = y0 + R.range(0.25, 0.45) - f.o[1], s0 = R.range(0.1, L * 0.3), s1 = R.range(L * 0.6, L - 0.1), riser = R.range(s0 + 0.2, s1 - 0.2);
      B.tube(M.gasPipe, [f.p(s0, gy, 0.05), f.p(s1, gy, 0.05)], 0.016, 8);
      B.tube(M.gasPipe, [f.p(riser, gy, 0.05), f.p(riser, gy + 0.9, 0.05)], 0.016, 8);
      B.box(M.paintMetal, f, riser - 0.12, riser + 0.12, gy + 0.9, gy + 1.2, 0.0, 0.14, { skip: "b" });
      for (let q = s0 + 0.3; q < s1; q += 0.9) B.box(M.steelDark, f, q - 0.015, q + 0.015, gy - 0.03, gy + 0.03, 0, 0.07);
      count("gas");
    }
    // a ledge at the first floor
    if (floors.length > 2 && R.chance(0.4)) B.box(M.coping, f, 0, L, floors[1] - 0.18 - f.o[1], floors[1] - 0.06 - f.o[1], 0, 0.05, { skip: "b" });
    // the gutter along the alley (a U-channel): precast concrete lids with a finger gap between them, a steel grating
    // every few lids; the channel's dark water under the grating
    {
      const lid = 0.5, gap = 0.012;
      const n = Math.max(1, Math.floor(L / lid));
      for (let k = 0; k < n; k++) {
        const a = k * lid + gap / 2, b = (k + 1) * lid - gap / 2;
        const pm = f.p((a + b) / 2, 0, 0.2);
        const gy = groundY(pm[0], pm[2]) - f.o[1];
        // (each lid one kit element: the grating's bars and frame, or a lid's finger holes)
        B.begin(f, a, gy);
        if (k % 4 === 2) {
          // the grating: bearing bars across the channel on a frame, the channel's floor below
          B.quad(M.cable, f.p(a, gy - 0.12, 0.04), f.p(b, gy - 0.12, 0.04), f.p(b, gy - 0.12, 0.36), f.p(a, gy - 0.12, 0.36), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
          B.box(M.steelDark, f, a, b, gy - 0.03, gy + 0.008, 0.035, 0.05);
          B.box(M.steelDark, f, a, b, gy - 0.03, gy + 0.008, 0.35, 0.365);
          for (let q = a + 0.02; q < b - 0.01; q += 0.033) B.box(M.steelDark, f, q, q + 0.006, gy - 0.03, gy + 0.006, 0.05, 0.35, { skip: "d" });
          B.box(M.steelDark, f, a, b, gy - 0.02, gy - 0.008, 0.19, 0.2, { skip: "d" });
        } else {
          B.box(M.gutter, f, a, b, gy - 0.06, gy + 0.012, 0.02, 0.38, { skip: "d" });
          // its two finger holes
          for (const h of [0.3, 0.7]) {
            const q = a + (b - a) * h;
            B.flat(M.cable, f, q - 0.03, q + 0.03, 0.185, 0.215, gy + 0.0125);
          }
        }
        B.end();
      }
    }
    void wallMat;
  }

  type Style = { kind: "commercial" | "office" | "apartment" | "house"; bay: number; winW: number; winH: number; lit: [number, number]; tower: boolean; fascia: boolean; balconyEdge: number; longest: number; billboard: boolean; frame: typeof M.aluminium; office: boolean;
    /** A high-rise office or commercial tower (45 m and up): a curtain wall of its own (`dressCurtain`), a lobby, a roof
     *  with plant, aviation lights and over 100 m the emergency helipad. */
    highrise: { glass: (typeof M.curtainGlass)[number]; spandrel: (typeof M.spandrels)[number]; fin: typeof M.aluminium; finDepth: number; spandrelH: number } | null };
  /** What a building's floors look like, from its recorded use (PLATEAU usage codes) and size: one style for all its walls. */
  function styleOf(b: Bldg, storeys: number): Style {
    const u = b.usage;
    const kind = [402, 404, 413, 414, 403].includes(u) ? "commercial" : [401, 421, 422, 431, 441, 453].includes(u) ? "office" : u === 412 ? "apartment" : u === 411 ? "house" : storeys >= 3 ? "commercial" : "house";
    // the longest wall faces the street: the apartments' balconies go there
    let best = -1, bl = 0;
    for (let i = 0; i < b.pts.length; i++) {
      const [ax, az] = b.pts[i], [cx, cz] = b.pts[(i + 1) % b.pts.length];
      const L = Math.hypot(cx - ax, cz - az);
      if (L > bl) { bl = L; best = i; }
    }
    return {
      kind,
      bay: kind === "office" ? R.range(1.5, 1.9) : R.range(2.6, 3.6),
      winW: R.range(0.55, 0.8),
      winH: kind === "office" ? R.range(1.5, 1.9) : R.range(1.1, 1.6),
      lit: kind === "office" ? [0.45, 0.2] : [0.4, 0.3],
      tower: kind === "commercial" && storeys >= 3 && R.chance(0.7),
      fascia: kind === "commercial" && R.chance(0.85),
      balconyEdge: kind === "apartment" ? best : -1,
      longest: best,
      billboard: kind === "commercial" && storeys >= 4 && R.chance(0.35),
      frame: R.chance(0.6) ? M.aluminiumDark : M.aluminium,
      office: kind === "office",
      highrise: (kind === "office" || kind === "commercial") && b.height >= 45 && storeys >= 10 ? {
        glass: R.pick(M.curtainGlass), spandrel: R.pick(M.spandrels), fin: R.pick([M.aluminium, M.aluminium, M.aluminiumDark, M.frameWhite]),
        finDepth: R.pick([0.12, 0.25, 0.4]), spandrelH: R.pick([0.9, 1.1, 1.3]),
      } : null,
    };
  }

  /** A building's window module and facade articulation (one per building, drawn from its own stream). */
  function moduleOf(st: Style, small: boolean, storeys: number): WinModule {
    const home = st.kind === "house" || st.kind === "apartment";
    const layout: WinModule["layout"] = st.kind === "office" ? R.pick(["ribbon", "ribbon", "single", "pair"] as const) : home ? R.pick(["single", "pair", "wide", "tall", "single"] as const) : R.pick(["single", "pair", "triple", "tall", "wide", "ribbon"] as const);
    return {
      frame: weighted(R, M.frames, [3, 3, 1.2, 1]),
      sash: home ? R.pick([2, 2, 2, 3, 1] as const) : st.kind === "office" ? R.pick([1, 1, 2] as const) : R.pick([2, 2, 3, 1] as const),
      depth: R.range(0.06, 0.2),
      hood: home && R.chance(0.6),
      sill: R.chance(0.7),
      layout,
      wFrac: R.range(0.45, 0.75),
      hFrac: R.range(0.42, 0.62),
      temp: st.kind === "office" ? "cool" : home ? (R.chance(0.8) ? "warm" : "neutral") : R.pick(["neutral", "cool", "warm"] as const),
      cells: st.kind === "office" ? INSIDES.office : home ? INSIDES.home : small ? INSIDES.bar : INSIDES.shop,
      bands: !small && R.chance(0.5),
      piers: !small && st.kind !== "office" && R.chance(0.35),
      crown: !small && R.chance(0.5),
      trim: R.pick(M.trims),
      penthouse: !small && storeys >= 6 && R.chance(0.45),
      stair: (st.kind === "apartment" || (st.kind === "commercial" && storeys <= 6)) && R.chance(0.3),
      neon: st.kind === "commercial" ? R.range(0.2, 0.6) : small ? 0.25 : 0,
    };
  }

  /** The dressing of a building seen from the next street or the next block: its floors' windows with the rooms behind
   *  them, shopfronts and fascias on the ground floor, the stacked signs of Kabukichō's mixed-use buildings up one end,
   *  balconies on apartments. Cheaper than dressSmall: no clutter, no cables. */
  /** A floor of a tower's curtain wall, slab to slab: per bay of about 1.6 m a kit element (the spandrel panel over the
   *  slab, the vision glass above it, the transom, the fin at its left edge), drawn at a standard size and stretched to
   *  the bay; the office behind the glass (lit by night as the ribbon windows' rooms are). */
  function curtainFloor(e: Edge, openings: Opening[], st: Style, fy: number, fh: number) {
    const H = st.highrise!, { f, L } = e, base = f.o[1];
    const bays = Math.max(1, Math.round(L / 1.6)), bw = L / bays;
    openings.push({ s0: 0, s1: L, y0: fy, y1: fy + fh, depth: 0.06 });
    // (an office floor is lit in zones, not window by window: one to three runs along the wall, each lit or not)
    const zones = Array.from({ length: 1 + R.int(3) }, () => lit(st.lit[0], st.lit[1]));
    const Y0 = fy - base, Y1 = Y0 + fh, sp = Math.min(H.spandrelH, fh * 0.4);
    // the wall's whole floor one kit element: the floors of a tower's wall are alike, one piece up its height
    B.begin(f, 0, Y0);
    B.box(H.spandrel, f, 0, L, Y0, Y0 + sp, -0.06, 0, { skip: "b" });
    B.box(H.fin, f, 0, L, Y1 - 0.04, Y1, -0.06, 0.02, { skip: "b" });
    for (let k = 0; k <= bays; k++) {
      const s = Math.min(L - 0.03, Math.max(0.03, k * bw));
      B.box(H.fin, f, s - 0.03, s + 0.03, Y0, Y1, -0.06, H.finDepth, { skip: "b" });
      if (k < bays) {
        pane(H.glass, f, k * bw + 0.03, Y0 + sp, (k + 1) * bw - 0.03, Y1 - 0.04, -0.05);
        B.rect(roomFor(zones[Math.floor((k / bays) * zones.length)]), f, k * bw, Y0 + sp, (k + 1) * bw, Y1 - 0.04, -0.7, blindCell(R.pick(INSIDES.office)));
      }
    }
    B.end();
    count("curtain floors");
  }

  /** A tower's roof: its plant room (louvred), red aviation lights at the corners (lit by night; 60 m and up), and over
   *  100 m the emergency helipad Tokyo asks of a building that tall (a green-grey pad, its white ring and H). */
  function towerRoof(b: Bldg, st: Style, roofY: number, wallMat: typeof M.roof) {
    const [ax, az] = b.pts[st.longest], [bx, bz] = b.pts[(st.longest + 1) % b.pts.length];
    const ll = Math.hypot(bx - ax, bz - az) || 1, u: V3 = [(bx - ax) / ll, 0, (bz - az) / ll], n: V3 = [-u[2], 0, u[0]];
    const [cx, cz] = centroid(b);
    let s0 = Infinity, s1 = -Infinity, d0 = Infinity, d1 = -Infinity;
    for (const [x, z] of b.pts) {
      const s = (x - cx) * u[0] + (z - cz) * u[2], d = (x - cx) * n[0] + (z - cz) * n[2];
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
    }
    const fr = new Frame([cx, roofY, cz], u, n);
    const fits = (a0: number, a1: number, c0: number, c1: number) => [[a0, c0], [a1, c0], [a1, c1], [a0, c1]].every(([s, d]) => inside(b.pts, cx + u[0] * s + n[0] * d, cz + u[2] * s + n[2] * d));
    const heli = b.height >= 100 && s1 - s0 > 34 && d1 - d0 > 18;
    // the plant room: the half of the roof the helipad leaves, or its middle
    const pa0 = heli ? s0 + 2 : s0 + (s1 - s0) * 0.25, pa1 = heli ? s0 + (s1 - s0) * 0.42 : s1 - (s1 - s0) * 0.25;
    const pc0 = d0 + (d1 - d0) * 0.2, pc1 = d1 - (d1 - d0) * 0.2, ph = R.range(3.5, 6);
    if (pa1 - pa0 > 3 && pc1 - pc0 > 3 && fits(pa0, pa1, pc0, pc1)) {
      B.box(wallMat, fr, pa0, pa1, 0, ph, pc0, pc1);
      B.box(M.coping, fr, pa0 - 0.1, pa1 + 0.1, ph, ph + 0.15, pc0 - 0.1, pc1 + 0.1);
      // louvres along its long sides
      for (let y = 0.6; y < ph - 0.5; y += 0.22) for (const d of [pc0 - 0.04, pc1 + 0.04]) B.box(M.steelDark, fr, pa0 + 0.6, pa1 - 0.6, y, y + 0.05, Math.min(d, d + (d < 0 ? -0.08 : 0.08)), Math.max(d, d + (d < 0 ? -0.08 : 0.08)));
      if (b.height >= 60) for (const [s, d] of [[pa0, pc0], [pa1, pc0], [pa1, pc1], [pa0, pc1]]) {
        B.box(M.steelDark, fr, s - 0.04, s + 0.04, ph + 0.15, ph + 1.2, d - 0.04, d + 0.04);
        B.box(M.aviation, fr, s - 0.12, s + 0.12, ph + 1.2, ph + 1.45, d - 0.12, d + 0.12);
      }
      count("plant rooms");
    }
    if (heli) {
      const hc = s1 - (s1 - s0) * 0.3, dc = (d0 + d1) / 2, R2 = Math.min(8, (d1 - d0) / 2 - 1.5);
      if (fits(hc - R2, hc + R2, dc - R2, dc + R2)) {
        B.box(M.helipadPaint, fr, hc - R2, hc + R2, 0, 0.35, dc - R2, dc + R2);
        // the ring (as segments) and the H, painted on
        const seg = 32, ro = R2 * 0.82, ri = ro - 0.45, y = 0.36;
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
          const P = (r: number, a: number): V3 => fr.p(hc + Math.cos(a) * r, y, dc + Math.sin(a) * r);
          B.quad(M.helipadWhite, P(ri, a0), P(ro, a0), P(ro, a1), P(ri, a1), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
        const hh = ri * 0.62, hw = hh * 0.62, t = 0.55;
        B.box(M.helipadWhite, fr, hc - hw, hc - hw + t, y - 0.01, y, dc - hh, dc + hh);
        B.box(M.helipadWhite, fr, hc + hw - t, hc + hw, y - 0.01, y, dc - hh, dc + hh);
        B.box(M.helipadWhite, fr, hc - hw, hc + hw, y - 0.01, y, dc - t / 2, dc + t / 2);
        count("helipads");
      }
    }
  }

  function dressMid(e: Edge, openings: Opening[], st: Style, balconies: boolean, longest: boolean) {
    const { f, L, floors } = e;
    const base = f.o[1], Y = (y: number) => y - base;
    const bays = Math.max(1, Math.round(L / st.bay));
    const bw = L / bays;
    const whole = e.from === -Infinity;
    const towerAt = whole && st.tower && L > 5 && floors.length > 3 ? (R.chance(0.5) ? 0.35 : L - 0.35) : -1;
    // an external stair core up one side wall (not the street front): a tall box, slit windows, its windows skipped
    const stairAt = whole && !st.highrise && W.stair && !stairDone && !longest && !balconies && L > 3.4 && floors.length > 3 ? 0.3 : -1;
    if (stairAt >= 0) {
      stairDone = true;
      const sw = 2.4, top = Y(e.top) + 0.6;
      B.box(W.trim, f, stairAt, stairAt + sw, Y(floors[0]), top, 0, 2.2);
      B.box(M.coping, f, stairAt - 0.05, stairAt + sw + 0.05, top, top + 0.12, -0.05, 2.25);
      for (let fl = 1; fl + 1 < floors.length; fl++) B.rect(roomFor(lit(0.7, 0.2)), f, stairAt + sw * 0.4, Y(floors[fl]) + 0.6, stairAt + sw * 0.6, Y(floors[fl]) + 2.2, 2.205, blindCell(7));
      count("stairs");
    }
    const skipAt = (wc: number) => (towerAt >= 0 && Math.abs(wc - towerAt) < 1.2) || (stairAt >= 0 && wc < stairAt + 2.9);
    // the floors above
    for (let fl = 1; fl + 1 < floors.length; fl++) {
      const fy = floors[fl], fh = floors[fl + 1] - fy;
      // (the floors over a lower neighbour only)
      if (fy < e.from - 0.3) continue;
      if (st.highrise) {
        curtainFloor(e, openings, st, fy, fh);
        continue;
      }
      if (balconies) {
        // a balcony slab the length of the wall, its railing, sliding doors behind, partitions between flats
        const by = Y(fy);
        B.box(M.coping, f, 0.1, L - 0.1, by - 0.16, by, 0, 1.1, { skip: "b" });
        // the balcony front: frosted panels, aluminium bars, or a solid parapet in the trim (1970s-80s mansions)
        const kind = (e.b.id * 7) % 3;
        if (kind === 0) B.box(M.frosted, f, 0.12, L - 0.12, by, by + 1.05, 1.04, 1.08, { skip: "b" });
        else if (kind === 1) for (let q = 0.2; q < L - 0.1; q += 0.15) B.box(W.frame, f, q, q + 0.025, by, by + 1.05, 1.05, 1.075);
        else B.box(W.trim, f, 0.1, L - 0.1, by, by + 1.0, 0.98, 1.1);
        B.box(kind === 2 ? M.coping : W.frame, f, 0.1, L - 0.1, by + 1.03, by + 1.1, 1.0, 1.1);
        for (let k = 0; k < bays; k++) {
          const s0 = k * bw + 0.25, s1 = (k + 1) * bw - 0.25;
          if (k > 0) B.box(M.frosted, f, k * bw - 0.02, k * bw + 0.02, by, by + 2.2, 0, 1.0, { skip: "b" });
          if (s1 - s0 > 0.8) windowAt(e, openings, s0, s1, fy + 0.05, Math.min(fy + fh - 0.3, fy + 2.05), { lit: lit(0.45, 0.25), frame: M.aluminium, depth: 0.08, inside: R.pick([1, 2]) });
          if (R.chance(0.6)) place(R.chance(0.5) ? "aircon" : "aircon", f.p(k * bw + 0.6, by + 0.35, 0.5), f.n, 0.82);
          if (R.chance(0.25)) {
            // laundry on a pole
            const ly = by + 1.9;
            B.tube(M.aluminium, [f.p(s0, ly, 0.75), f.p(s1, ly, 0.75)], 0.012, 5);
            for (let q = s0 + 0.2; q < s1 - 0.3; q += R.range(0.35, 0.6)) {
              const w = R.range(0.3, 0.55), hgt = R.range(0.4, 0.8);
              B.quad(R.pick(M.laundry), f.p(q, ly, 0.75), f.p(q + w, ly, 0.75), f.p(q + w, ly - hgt, 0.75 + R.range(-0.03, 0.03)), f.p(q, ly - hgt, 0.75), f.n, [[0, 1], [1, 1], [1, 0], [0, 0]]);
            }
          }
        }
        continue;
      }
      if (st.office || W.layout === "ribbon") {
        // a ribbon of glass across the floor, mullions every bay
        const wy0 = fy + 0.85, wy1 = Math.min(fy + fh - 0.25, wy0 + st.winH);
        if (wy1 - wy0 > 0.6 && L > 1.5) {
          const s0 = stairAt >= 0 ? stairAt + 2.9 : 0.3, s1 = L - 0.3;
          openings.push({ s0, s1, y0: wy0, y1: wy1, depth: 0.12 });
          pane(M.glass, f, s0, Y(wy0), s1, Y(wy1), -0.1);
          for (let k = 0; k < bays; k++) {
            const a0 = s0 + ((s1 - s0) * k) / bays, a1 = s0 + ((s1 - s0) * (k + 1)) / bays;
            const l = lit(st.lit[0], st.lit[1]);
            B.rect(roomFor(l), f, a0, Y(wy0), a1, Y(wy1), -0.45, blindCell(R.pick(W.cells)));
            B.box(W.frame, f, a0 - 0.03, a0 + 0.03, Y(wy0), Y(wy1), -0.12, -0.04);
          }
          B.box(W.frame, f, s0, s1, Y(wy0) - 0.04, Y(wy0), -0.12, -0.02);
          B.box(W.frame, f, s0, s1, Y(wy1), Y(wy1) + 0.04, -0.12, -0.02);
        }
        continue;
      }
      for (let k = 0; k < bays; k++) {
        const s0 = k * bw, s1 = (k + 1) * bw;
        const wc = (s0 + s1) / 2;
        if (skipAt(wc)) continue;
        // the building's module: one window, a pair, three, two tall ones, or a wide one, each bay
        const h = Math.max(0.8, Math.min(fh - 0.65, fh * W.hFrac)), tall = W.layout === "tall";
        const wy0 = tall ? fy + 0.35 : fy + Math.max(0.55, (fh - h) * 0.55), wy1 = tall ? fy + fh - 0.35 : wy0 + (W.layout === "wide" ? h * 0.75 : h);
        const usable = bw - 0.5;
        const spans: [number, number][] =
          W.layout === "pair" ? [[wc - usable * W.wFrac * 0.5, wc - 0.12], [wc + 0.12, wc + usable * W.wFrac * 0.5]]
          : W.layout === "triple" ? [-1, 0, 1].map((q) => [wc + q * usable * 0.31 - usable * 0.13, wc + q * usable * 0.31 + usable * 0.13] as [number, number])
          : tall ? [[wc - usable * 0.34, wc - usable * 0.08], [wc + usable * 0.08, wc + usable * 0.34]]
          : W.layout === "wide" ? [[wc - usable * 0.42, wc + usable * 0.42]]
          : [[wc - (usable * W.wFrac) / 2, wc + (usable * W.wFrac) / 2]];
        const l = lit(st.lit[0], st.lit[1]);
        for (const [a0, a1] of spans) if (a1 - a0 > 0.35 && wy1 - wy0 > 0.5) windowAt(e, openings, a0, a1, wy0, wy1, { lit: l, grille: st.kind === "house" && R.chance(0.3) });
        const ww = spans[spans.length - 1][1] - spans[0][0];
        // a neon emblem between floors on a lively building
        if (st.kind === "commercial" && R.chance(W.neon * 0.25) && fh - (wy1 - fy) > 0.5) neonShape(f, wc, Y(wy1) + Math.min(0.45, (fy + fh - wy1) / 2), 0.5, 0.06, R.pick(M.neon));
        // signs in the windows of the mixed-use floors (a bar, a karaoke room, a clinic)
        else if (st.kind === "commercial" && R.chance(0.3) && wy1 - wy0 > 0.8) lightboxAt(f, wc - ww / 2 + 0.05, wc + ww / 2 - 0.05, Y(wy1) + 0.05, Y(wy1) + Math.min(0.45, fy + fh - wy1 - 0.05), 0.08);
        if (st.kind !== "office" && R.chance(0.15)) place(R.chance(0.5) ? "aircon" : "aircon", f.p(wc + ww / 2 + 0.6, Y(wy0) + 0.1, 0.25), f.n, 0.82);
      }
    }
    // articulation: floor bands, piers between the bays, a crown at the top (a second finish)
    if (W.bands && !balconies && !st.highrise) for (let fl = 1; fl + 1 < floors.length; fl++) B.box(W.trim, f, -0.02, L + 0.02, Y(floors[fl]) - 0.14, Y(floors[fl]) + 0.06, 0, 0.07, { skip: "b" });
    if (W.piers && !balconies && !st.highrise && floors.length > 3) for (let k = 0; k <= bays; k++) {
      const ps = Math.min(L - 0.15, Math.max(0.15, k * bw));
      if (!skipAt(ps)) B.box(W.trim, f, ps - 0.15, ps + 0.15, Y(floors[1]) - 0.15, Y(e.top) - 0.05, 0, 0.1, { skip: "b" });
    }
    if (W.crown) B.box(W.trim, f, -0.04, L + 0.04, Y(e.top) - 0.75, Y(e.top) - 0.02, 0, 0.11, { skip: "b" });
    // the ground floor
    const gTop = floors[1] ?? floors[floors.length - 1];
    if (!whole) {
      // (behind the neighbour)
    } else if (st.highrise) {
      // a tower's lobby: glass the height of the ground floor between steel mullions, the hall lit behind, a canopy
      // over the entrance on the street front
      const H = st.highrise, g0 = floors[0], g1 = gTop - 0.35, gb = Math.max(1, Math.round((L - 0.6) / 2.4)), gw = (L - 0.6) / gb;
      if (g1 - g0 > 2.2 && L > 3) {
        openings.push({ s0: 0.3, s1: L - 0.3, y0: g0, y1: g1, depth: 0.35 });
        pane(M.glass, f, 0.3, Y(g0), L - 0.3, Y(g1), -0.3);
        for (let k = 0; k <= gb; k++) B.box(H.fin, f, 0.3 + k * gw - 0.05, 0.3 + k * gw + 0.05, Y(g0), Y(g1), -0.34, -0.22);
        B.box(H.fin, f, 0.3, L - 0.3, Y(g1) - 0.08, Y(g1), -0.34, -0.22);
        B.rect(roomFor(2), f, 0.3, Y(g0), L - 0.3, Y(g1), -4, blindCell(6));
        if (longest && L > 8) {
          B.box(H.spandrel, f, L * 0.3, L * 0.7, Y(g1) + 0.1, Y(g1) + 0.35, 0, 3.2, { skip: "b" });
          count("canopies");
        }
      }
    } else if (st.kind === "commercial" || st.kind === "office") {
      for (let k = 0; k < bays; k++) {
        const s0 = k * bw + 0.2, s1 = (k + 1) * bw - 0.2;
        if (s1 - s0 < 0.8) continue;
        const top = Math.min(gTop - 0.7, floors[0] + 2.7);
        if (R.chance(0.2)) {
          openings.push({ s0, s1, y0: floors[0], y1: top, depth: 0.08 });
          B.rect(R.chance(0.5) ? M.shutterPainted : M.shutter, f, s0, Y(floors[0]), s1, Y(top), -0.08);
        } else {
          windowAt(e, openings, s0, s1, floors[0] + 0.05, top, { lit: lit(0.85, 0.1), frame: M.aluminiumDark, depth: 0.25, inside: R.int(4), bar: true, frosted: false, shop: true });
        }
      }
      // the street in front: a row of bicycles, a vending machine
      if (st.kind === "commercial" && L > 4 && R.chance(0.3)) {
        const n = 2 + R.int(5), s0 = R.range(0.5, Math.max(0.5, L - n * 0.6 - 0.5));
        for (let q = 0; q < n && s0 + q * 0.6 < L - 0.4; q++) {
          const at = f.p(s0 + q * 0.6, 0, 1.2);
          prop(bicycle, "bike", 8, [at[0], groundY(at[0], at[2]) + 0.12, at[2]], f.n);
        }
        count("bikeRows");
      }
      if (L > 3 && R.chance(0.08)) {
        const at = f.p(R.range(0.2, L - 1.6) + 0.5, 0, 0.9);
        prop(vendingMachine, "vendingm", 6, [at[0], groundY(at[0], at[2]) + 0.12, at[2]], f.n);
        count("vending");
      }
      // the fascia: a run of lit panels over the shopfronts
      if (st.fascia && gTop - floors[0] > 3) {
        const fy0 = Math.min(gTop - 0.6, floors[0] + 2.85), fh = Math.min(0.9, gTop - fy0 - 0.05);
        let end = 0.2;
        for (let s = 0.2; s + 1.2 < L - 0.2; s += fh * 2 + 0.05) {
          lightboxAt(f, s, s + fh * 2, Y(fy0), Y(fy0 + fh), 0.18);
          end = s + fh * 2;
        }
        if (end > 0.3 && R.chance(W.neon)) neonRect(f, 0.12, Y(fy0) - 0.07, end + 0.08, Y(fy0 + fh) + 0.07, 0.2, R.pick(M.neon), R.chance(0.3));
        count("fascias");
      }
    } else {
      // houses and flats: a door and a window
      const dw = 0.85, ds = R.range(0.4, Math.max(0.4, L - 1.3));
      openings.push({ s0: ds, s1: ds + dw, y0: floors[0], y1: floors[0] + 2.0, depth: 0.12 });
      B.box(R.pick(M.doorWood), f, ds, ds + dw, Y(floors[0]), Y(floors[0] + 2.0), -0.12, -0.08, { skip: "b" });
    }
    // a billboard on the roof over the street: a steel frame and a lit panel (a shop's lightbox face, writ large)
    if (whole && st.billboard && longest && L > 6) {
      const bw2 = Math.min(L - 1, R.range(5, 9)), bh2 = bw2 * 0.5, s0 = (L - bw2) / 2, top = e.top - base;
      for (const s of [s0 + 0.5, s0 + bw2 - 0.5]) B.box(M.steelDark, f, s - 0.06, s + 0.06, top, top + 1.2 + bh2, -0.9, -0.78);
      B.box(M.steelDark, f, s0, s0 + bw2, top + 1.1, top + 1.2, -0.9, -0.6);
      B.box(M.signFrame, f, s0, s0 + bw2, top + 1.2, top + 1.2 + bh2, -0.75, -0.6, { front: M.shop(shopCells(nextShop).page).box, frontUV: shopCells(nextShop++).lightbox });
      count("billboards");
    }
    // the stacked signs up one end (tate-kanban): a lit box per floor, out from the wall, both faces showing
    if (towerAt >= 0) {
      const tf = new Frame(f.p(towerAt, 0, 0), mul(f.n, -1), f.u);
      const w = R.range(0.7, 1.0);
      B.box(M.steelDark, tf, -0.25, 0, Y(floors[1]), Y(floors[floors.length - 1]) + 0.3, -0.05, 0.05);
      for (let fl = 1; fl + 1 < floors.length; fl++) {
        const fy = floors[fl], fh = floors[fl + 1] - fy;
        R.int(16);
        const sh = shopCells(nextShop++), sm = M.shop(sh.page);
        B.box(M.signFrame, tf, -0.25 - w, -0.25, Y(fy + 0.15), Y(fy + fh - 0.1), -0.08, 0.08, { front: sm.blade, frontUV: sh.blade, back: sm.blade, backUV: sh.blade });
        if (R.chance(W.neon * 0.7)) {
          const nm = R.pick(M.neon);
          for (const dd of [0.095, -0.095]) neonRect(tf, -0.2 - w, Y(fy + 0.12), -0.3, Y(fy + fh - 0.07), dd, nm);
        }
      }
      count("towers");
    }
  }

  /** What stands on a roof: air conditioners, a water tank on its stand, the stair house, an aerial. */
  function rooftop(b: Bldg, y: number, small: boolean, wallMat: typeof M.roof, storeys: number) {
    const area = Math.abs(b.pts.reduce((a, [x, z], i) => { const [x2, z2] = b.pts[(i + 1) % b.pts.length]; return a + x * z2 - x2 * z; }, 0)) / 2;
    if (area < 12) return;
    // a penthouse floor set back from the edges (taller buildings): its walls, a band of windows, its own coping
    if (W.penthouse && area > 120 && storeys >= 6) {
      let lu: V3 = [1, 0, 0], ll = 0;
      for (let i = 0; i < b.pts.length; i++) {
        const [ax, az] = b.pts[i], [cx, cz] = b.pts[(i + 1) % b.pts.length], L = Math.hypot(cx - ax, cz - az);
        if (L > ll) { ll = L; lu = [(cx - ax) / L, 0, (cz - az) / L]; }
      }
      const ln: V3 = [-lu[2], 0, lu[0]];
      const [cx, cz] = centroid(b);
      let ea = 0, eb = 0;
      for (const [x, z] of b.pts) { ea = Math.max(ea, Math.abs((x - cx) * lu[0] + (z - cz) * lu[2])); eb = Math.max(eb, Math.abs((x - cx) * ln[0] + (z - cz) * ln[2])); }
      for (const k of [0.6, 0.5, 0.4]) {
        const ha = ea * k, hb = eb * k;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => [cx + lu[0] * ha * p + ln[0] * hb * q, cz + lu[2] * ha * p + ln[2] * hb * q]);
        if (ha < 2.5 || hb < 2.5 || !corners.every(([x, z]) => inside(b.pts, x, z))) continue;
        const fr = new Frame([cx, y, cz], lu, ln), H = 3.1;
        B.box(wallMat, fr, -ha, ha, 0, H, -hb, hb, { skip: "d" });
        B.box(M.coping, fr, -ha - 0.08, ha + 0.08, H, H + 0.12, -hb - 0.08, hb + 0.08);
        const l = lit(0.5, 0.2);
        // its window bands, front and back
        for (const side of [1, -1]) {
          const sf = side > 0 ? fr : new Frame([cx, y, cz], mul(lu, -1), mul(ln, -1));
          B.rect(roomFor(l), sf, -ha + 0.6, 0.9, ha - 0.6, 2.3, hb + 0.01, blindCell(R.pick(W.cells)));
          B.rect(W.frame, sf, -ha + 0.55, 2.3, ha - 0.55, 2.36, hb + 0.012);
        }
        count("penthouses");
        break;
      }
    }
    const spot = (margin: number): V3 | null => {
      for (let t = 0; t < 12; t++) {
        const x = R.range(b.bb[0], b.bb[2]), z = R.range(b.bb[1], b.bb[3]);
        if (!inside(b.pts, x, z)) continue;
        if ([[margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dz]) => inside(b.pts, x + dx, z + dz))) return [x, y, z];
      }
      return null;
    };
    const n = Math.min(6, 1 + Math.floor(area / (small ? 25 : 60)));
    for (let k = 0; k < n; k++) {
      const p = spot(0.8);
      if (p) place(R.chance(0.5) ? "aircon" : "aircon", [p[0], p[1] + 0.32, p[2]], [Math.cos(k), 0, Math.sin(k)], 0.82);
    }
    if (!small && R.chance(0.5)) {
      const p = spot(2);
      if (p) {
        // the water tank (a fibreglass box or a drum) on a steel stand
        const fr = new Frame(p, [1, 0, 0], [0, 0, 1]);
        for (const [sx, sz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) B.box(M.steelDark, fr, sx - 0.04, sx + 0.04, 0, 1.2, sz - 0.04, sz + 0.04);
        if (R.chance(0.5)) B.box(M.tank, fr, -1.0, 1.0, 1.2, 2.8, -1.0, 1.0);
        else B.cylinder(M.tank, [p[0], p[1] + 1.2, p[2]], 1.0, 1.0, 1.7, 16);
        count("tanks");
      }
    }
    if (!small && area > 80 && R.chance(0.6)) {
      const p = spot(2.5);
      if (p) {
        const fr = new Frame(p, [1, 0, 0], [0, 0, 1]);
        B.box(R.pick(M.bigWalls), fr, -1.3, 1.3, 0, 2.6, -1.6, 1.6);
        B.box(M.coping, fr, -1.4, 1.4, 2.6, 2.75, -1.7, 1.7);
        B.box(M.shutterPainted, fr, -0.45, 0.45, 0, 2.0, 1.6, 1.62, { skip: "b" });
      }
    }
    if (R.chance(small ? 0.3 : 0.4)) {
      const p = spot(0.5);
      if (p) {
        B.tube(M.aluminium, [p, [p[0], p[1] + R.range(2.5, 5), p[2]]], 0.025, 6);
        const ty = p[1] + R.range(2, 4.5);
        for (let q = 0; q < 6; q++) B.tube(M.aluminium, [[p[0] - 0.5, ty, p[2] + (q - 3) * 0.12], [p[0] + 0.5, ty, p[2] + (q - 3) * 0.12]], 0.008, 4);
      }
    }
  }

  /** A chōchin: the paper body (lantern.png's cell wrapped round), black rims top and bottom. */
  function lanternMesh(c: V3, r: number, h: number, cellIx: number) {
    B.lantern(M.lanternPaper, c, r, h, 12, 5, [cellIx / 4, (cellIx + 1) / 4]);
    B.cylinder(M.steelDark, add(c, [0, h / 2 - 0.02, 0]), r * 0.72, r * 0.72, 0.05, 14);
    B.cylinder(M.steelDark, add(c, [0, -h / 2 - 0.03, 0]), r * 0.72, r * 0.72, 0.05, 14);
  }

  R = rng(hashSeed(seed, -1, ...(ab.cell ?? [0, 0, 0, 0])));
  // ---------------------------------------------------------------- the ground: patched asphalt
  if (ab.ground !== false && !ab.cell) {
  const gx0 = bx0 - 6, gz0 = bz0 - 6, gx1 = bx1 + 6, gz1 = bz1 + 6;
  const patch = (x: number, z: number) => {
    const i = Math.floor(x / 5.3 + 0.4 * Math.sin(z / 3.1)), j = Math.floor(z / 4.7 + 0.4 * Math.sin(x / 2.7));
    const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return h - Math.floor(h) < 0.32;
  };
  const open = (x: number, z: number) => !inAny(x, z);
  B.heightfield(M.ground, gx0, gz0, gx1, gz1, 0.5, groundY, (x, z) => open(x, z) && !patch(x, z));
  B.heightfield(M.groundB, gx0, gz0, gx1, gz1, 0.5, (x, z) => groundY(x, z) + 0.004, (x, z) => open(x, z) && patch(x, z));

  // manholes along the alleys, away from the walls
  for (let k = 0, tries = 0; k < 7 && tries < 400; tries++) {
    const x = R.range(bx0, bx1), z = R.range(bz0, bz1);
    let clear = true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) if (inAny(x + dx * 1.1, z + dz * 1.1)) clear = false;
    if (!clear) continue;
    place("manhole", [x, groundY(x, z) + 0.005, z], [0, 0, 1], 1, R.next() * 6);
    k++;
  }
  }

  // Trees share their seed, placement and silhouette across the three city levels.
  for (const t of data.props) {
    if (t.kind !== 0 || !inCell(t.x, t.z) || t.x < data.box[0] || t.z < data.box[1] || t.x > data.box[2] || t.z > data.box[3]) continue;
    const key = treeKey(t.variant, inBox(t.x, t.z) ? 0 : 1);
    for (const site of treeSites(t.variant, t.x, t.z, t.rot, t.scale)) {
      place(key, [site.x, groundY(site.x, site.z), site.z], [Math.sin(site.rot), 0, Math.cos(site.rot)], site.scale);
    }
  }

  // ---------------------------------------------------------------- overhead: poles, their lines, service drops, cross-alley wires
  const poles = data.props.filter((p) => p.kind === 1 && inBox(p.x, p.z) && inCell(p.x, p.z));
  const poleTops: { at: V3; arm: V3 }[] = [];
  for (const p of poles) {
    const gy = groundY(p.x, p.z), h = 11.5;
    B.cylinder(M.concretePole, [p.x, gy - 0.2, p.z], 0.19, 0.12, h + 0.2, 14, 1);
    const arm: V3 = [Math.cos(p.rot), 0, Math.sin(p.rot)], side: V3 = [-arm[2], 0, arm[0]];
    const top: V3 = [p.x, gy + h, p.z];
    // two crossarms with their insulators
    for (const [yy, half] of [[-0.35, 0.9], [-1.25, 0.75]] as const) {
      const c = add(top, [0, yy, 0]);
      const pf = new Frame(add(c, mul(side, -half)), side, arm);
      B.box(M.steelDark, pf, 0, half * 2, -0.05, 0.05, -0.05, 0.05);
      for (const s of [0.1, half, half * 2 - 0.1]) B.cylinder(M.insulator, pf.p(s, 0.05, 0), 0.04, 0.03, 0.13, 8);
    }
    // a transformer on some, step bolts up the pole
    if (R.chance(0.6)) {
      const tc = add(top, add(mul(side, 0.35), [0, -3.2, 0]));
      B.cylinder(M.transformer, tc, 0.26, 0.26, 0.95, 14);
      B.box(M.steelDark, new Frame(add(top, [0, -3.25, 0]), side, arm), -0.05, 0.6, -0.04, 0.04, -0.04, 0.04);
    }
    for (let y = 2.0; y < h - 1; y += 0.45) {
      const a = (y * 2.3) % (Math.PI * 2), d: V3 = [Math.cos(a), 0, Math.sin(a)];
      B.tube(M.steelDark, [[p.x + d[0] * 0.12, gy + y, p.z + d[2] * 0.12], [p.x + d[0] * 0.3, gy + y, p.z + d[2] * 0.3]], 0.012, 5);
    }
    // a street lamp on the pole and the district's numbered plate (a tin sign)
    const lampAt = add(top, add(mul(arm, 0.2), [0, -4.4, 0]));
    B.tube(M.paintMetal, [add(top, [0, -4.2, 0]), add(lampAt, mul(arm, 0.9))], 0.025, 6);
    B.box(M.paintMetal, new Frame(add(lampAt, mul(arm, 0.75)), side, arm), -0.1, 0.1, -0.08, 0, -0.2, 0.2);
    B.flat(M.bulb, new Frame(add(lampAt, mul(arm, 0.75)), side, arm), -0.08, 0.08, -0.17, 0.17, -0.081, true);
    poleTops.push({ at: top, arm: side });
    count("poles");
  }
  // the lines between poles (the city's spans) and on to the edge of the district
  for (const w of data.wires.filter((w) => (inBox(w[0], w[1]) || inBox(w[2], w[3])) && inCell(w[0], w[1]))) {
    const a = poleTops.find((p) => Math.hypot(p.at[0] - w[0], p.at[2] - w[1]) < 1.5), b = poleTops.find((p) => Math.hypot(p.at[0] - w[2], p.at[2] - w[3]) < 1.5);
    const A: V3 = a ? a.at : [w[0], groundY(w[0], w[1]) + 11.5, w[1]];
    const Bp: V3 = b ? b.at : [w[2], groundY(w[2], w[3]) + 11.5, w[3]];
    const span = Math.hypot(Bp[0] - A[0], Bp[2] - A[2]);
    for (const [yy, off, r] of [[-0.25, -0.75, 0.011], [-0.25, 0, 0.011], [-0.25, 0.75, 0.011], [-1.15, -0.6, 0.009], [-1.15, 0.6, 0.009], [-2.2, 0, 0.022]] as const) {
      const sideA = a ? mul(a.arm, off) : [0, 0, 0] as V3, sideB = b ? mul(b.arm, off) : [0, 0, 0] as V3;
      B.wire(M.cable, add(add(A, sideA), [0, yy, 0]), add(add(Bp, sideB), [0, yy, 0]), span * 0.018 + 0.1, r, 16);
    }
  }
  // service drops: from each pole to houses round it
  const exposedSmall = edges.filter((e) => e.exposed && e.small && inBox(e.f.o[0], e.f.o[2]));
  for (const p of poleTops) {
    const near = exposedSmall.filter((e) => Math.hypot(e.f.o[0] - p.at[0], e.f.o[2] - p.at[2]) < 28);
    for (let k = 0; k < Math.min(10, near.length); k++) {
      const e = R.pick(near), s = R.range(0.2, e.L - 0.2), y = e.floors[e.floors.length - 1] - R.range(0.3, 1.2);
      const to = e.f.p(s, y - e.f.o[1], 0.05), from = add(p.at, [R.range(-0.3, 0.3), -1.9, R.range(-0.3, 0.3)]);
      B.wire(M.cable, from, to, Math.hypot(to[0] - from[0], to[2] - from[2]) * 0.03 + 0.15, 0.008, 16);
      // its clamp on the wall
      B.box(M.steelDark, e.f, s - 0.04, s + 0.04, y - e.f.o[1] - 0.04, y - e.f.o[1] + 0.04, 0, 0.06);
      count("drops");
    }
  }
  // wires across the alleys between facing houses
  for (const e of exposedSmall) {
    for (let k = 0; k < 2; k++) {
      if (!R.chance(0.55)) continue;
      const s = R.range(0.2, e.L - 0.2), y = R.range(e.floors[1] ?? e.y0 + 3, e.top - 0.3);
      const from = e.f.p(s, y - e.f.o[1], 0.04);
      // straight out across the alley to the first wall it meets, within 2-9 m
      let hit: V3 | null = null;
      for (let t = 1.8; t < 9; t += 0.25) {
        const q = add(from, mul(add(e.f.n, mul(e.f.u, R.range(-0.25, 0.25) * 0)), t));
        if (inAny(q[0], q[2], e.b)) {
          hit = [q[0] - e.f.n[0] * 0.2, from[1] + R.range(-0.8, 0.8), q[2] - e.f.n[2] * 0.2];
          break;
        }
      }
      if (!hit) continue;
      const along = mul(e.f.u, R.range(-2.5, 2.5));
      const to = add(hit, along);
      const n = 1 + (R.chance(0.3) ? 1 : 0);
      for (let q = 0; q < n; q++) B.wire(R.chance(0.8) ? M.cable : M.cableGrey, add(from, [0, -q * 0.08, 0]), add(to, [0, -q * 0.08, 0]), R.range(0.08, 0.3), R.range(0.006, 0.012), 14);
      count("crossings");
    }
  }

  // vending machines where an alley opens on the street
  const ends = edges.filter((e) => e.exposed && e.small && e.L > 2.5 && inBox(e.f.o[0], e.f.o[2]));
  for (let k = 0; k < 3 && ends.length; k++) {
    const e = ends.splice(R.int(ends.length), 1)[0];
    vendingAt(e, R.range(0.3, e.L - 1.3));
  }

  function vendingAt(e: Edge, s: number) {
    const at = e.f.p(s + 0.5, 0, 0.15 + 0.72);
    prop(vendingMachine, "vendingm", 6, [at[0], groundY(at[0], at[2]), at[2]], e.f.n);
    count("vending");
  }

  const facades = edges.filter((e) => e.exposed && inBox(e.f.o[0], e.f.o[2])).map((e) => ({ building: e.b.id, o: e.f.o, u: e.f.u, n: e.f.n, length: e.L, y0: e.y0, small: e.small }));
  return { objects: ab.record ? objects : [...B.meshes("hero"), ...objects], triangles: B.triangles, counts, facades, batches: B };

}

function weighted<T>(R: ReturnType<typeof rng>, xs: T[], w: number[]): T {
  const total = w.reduce((a, b) => a + b, 0);
  let x = R.next() * total;
  for (let i = 0; i < xs.length; i++) if ((x -= w[i]) < 0) return xs[i];
  return xs[xs.length - 1];
}

export type { Mesh };
