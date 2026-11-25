// A compiled city area (tools/city: out of PLATEAU, OpenStreetMap and GSI) as ThreeRT content: one GLB per 256 m tile,
// meshed by the upstream client's mesher (tools/city/mesh/meshing.js, the same geometry the three.js app draws), and an
// index the scene imports (scene/areas/<area>.ts).
//
//   node tools/tokyo/to-glb.ts [--area=shinjuku]      assets/city/tiles/<area> -> assets/city/glb/<area>/
//
// What each tile carries, by material:
//   - the terrain from the elevation grid, meshed per tile;
//   - road surfaces, kerbs, parks, water and paint, coloured as the source colours them (per-vertex colours, grouped
//     into materials by quantised colour and ground layer);
//   - buildings: walls and roofs generated from footprints and survey heights;
//   - windows: dark glass, and the lit ones (night) as emitters;
//   - street props (tools/tokyo/props.ts): lights and poles with LED heads (emitters by night), signals, vending
//     machines, parked cars, trees (park trees in clumps).
//   - signboards (tools/tokyo/signs.ts): fascias, blades and titles, lettered in a per-tile atlas; glowing a little by
//     day and fully by night.
//   - the road's painted symbols (tools/tokyo/decals.ts): arrows, 止まれ, speed numbers, as geometry traced from the
//     client's atlas (cutouts would cost every ray the renderer's alpha-test loop).
// Not yet: billboards and screens: ROADMAP § 0 step 1.
import { clipToSeams, seamsOf } from "./stitch.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodeTile } from "../city/shared/tileformat.js";
import { makeSurface } from "../city/shared/decks.js";

import { buildTile } from "../city/mesh/meshing.js";
import { KIND, GROUND } from "../city/mesh/constants.js";
import { repoRoot } from "../lib/paths.ts";
import { GlbBuilder, type Material } from "./glb.ts";
import { PROP_MATERIALS, propSoups, TREE_FORMS, treeCopies } from "./props.ts";
import { signBoards } from "./signs.ts";
import { decalGeometry, decalShapes } from "./decals.ts";
import { WINDOW_GROUPS, WINDOW_NODES, WINDOW_SWITCH } from "../../scene/area.ts";
import { createDraper } from "../city/mesh/drape.js";
import { PROP } from "../city/shared/tileformat.js";
import type { BuildingLook } from "../../scene/hero/dress.ts";
import { curtainWindows, farWindows, rowAt, storey, upperWindows, type FarWindows } from "./far-windows.ts";

const area = (process.argv.find((a) => a.startsWith("--area=")) ?? "--area=shinjuku").split("=")[1];
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
// A hero district dressed at street level (scene/hero): `--exclude=x0,z0,x1,z1` leaves out the buildings (by
// centroid), props, signs and wires inside the box, `--only=x_z,...` converts those tiles alone, `--out=<dir>` (under
// assets/city/glb) writes them there; with --only the area's index and scene/areas/<area>.ts are not rewritten.
const exclude = flag("exclude")?.split(",").map(Number), only = flag("only")?.split(",");
// `--strip=x0,z0,x1,z1`: the buildings alone left out of a wider box (dressed at mid distance)
const strip = flag("strip")?.split(",").map(Number);
const city = join(repoRoot, "assets/city");
const tilesDir = join(city, "tiles", area), outDir = join(city, "glb", flag("out") ?? area);
mkdirSync(outDir, { recursive: true });

type Manifest = {
  area: string; origin: { lon: number; lat: number }; tileSize: number; bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  terrain: { file: string; x0: number; z0: number; step: number; w: number; h: number }; decks?: unknown[];
  tiles: { x: number; z: number; file: string; mesh?: string; atlas?: string; walls?: string }[];
};
const manifest = JSON.parse(readFileSync(join(tilesDir, "manifest.json"), "utf8")) as Manifest;
const t = manifest.terrain;
const tb = readFileSync(join(tilesDir, t.file));
const grid = { x0: t.x0, z0: t.z0, step: t.step, w: t.w, h: t.h, data: new Float32Array(tb.buffer, tb.byteOffset, tb.byteLength / 4) };
const surface = makeSurface(grid, manifest.decks ?? []);
const size = manifest.tileSize;

// ---------------------------------------------------------------- materials
const srgbToLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
// Colours come linear from the mesher; quantised in sRGB (perceptually even steps) to group triangles into materials.
const Q = 24;
const linToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const quant = (c: number[]): [number, number, number] => c.map((v) => Math.round(linToSrgb(Math.min(1, Math.max(0, v))) * Q)) as [number, number, number];
const fromQuant = (q: number[]): [number, number, number] => q.map((v) => srgbToLin(v / Q)) as [number, number, number];
const ROUGH: Record<number, number> = { [GROUND.ASPHALT]: 0.85, [GROUND.PAVERS]: 0.8, [GROUND.GRASS]: 0.95, [GROUND.CONCRETE]: 0.85, [GROUND.WATER]: 0.04 };

// Flat-shaded triangle soups (position, normal, colour per vertex) -> one primitive per material key.
/** A group's material, or one material per node: lamps lit in the "night" node and unlit in the "day" node. */
type Placed = Material | { node: string; material: Material }[];

function soup(g: GlbBuilder, a: { position: Float32Array; normal: Float32Array; color?: Float32Array }, key: (tri: number) => string, material: (key: string) => Placed) {
  const n = a.position.length / 9;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let list = groups.get(k);
    if (!list) groups.set(k, (list = []));
    list.push(i);
  }
  for (const [k, tris] of groups) {
    const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9), idx = new Uint32Array(tris.length * 3);
    tris.forEach((tri, j) => {
      pos.set(a.position.subarray(tri * 9, tri * 9 + 9), j * 9);
      nor.set(a.normal.subarray(tri * 9, tri * 9 + 9), j * 9);
      idx[j * 3] = j * 3; idx[j * 3 + 1] = j * 3 + 1; idx[j * 3 + 2] = j * 3 + 2;
    });
    const m = material(k);
    if (Array.isArray(m)) for (const { node, material: mm } of m) g.triangles(g.material(mm), pos, nor, null, idx, node);
    else g.triangles(g.material(m), pos, nor, null, idx);
  }
}

/**
 * A steel lattice tower's lamps (tools/city/mesh/tower.js marks them with colours brighter than 1, which the source's
 * shader lights at night): the edge bulbs warm white, the beacons and the aircraft warning lights red. Lit in the
 * "night" node, as street lamps are, and plain in the "day" node.
 */
function towerLamp(raw: number[]): { node: string; material: Material }[] {
  const peak = Math.max(...raw);
  const tint = raw.map((c) => c / peak) as [number, number, number];
  const red = tint[1] < 0.2;
  const name = red ? "tower beacon" : "tower bulb";
  return [
    { node: "night", material: { name, color: tint.map((c) => c * 0.3) as [number, number, number], roughness: 0.4, emissive: tint, emissiveStrength: red ? 2500 : 800 } },
    { node: "day", material: { name: `${name} unlit`, color: tint.map((c) => c * 0.6) as [number, number, number], roughness: 0.4 } },
  ];
}
const colorOf = (c: Float32Array, tri: number) => [c[tri * 9], c[tri * 9 + 1], c[tri * 9 + 2]];

// ---------------------------------------------------------------- windows
// The source draws windows in its facade shader (src/world/materials.js upstream): a grid of bays (aFacade.x, integer =
// bay edge) and floors (aFacade.y height above the base, aFacade.z floor height) on every wall with a bay width
// (aBldg.w), one window rectangle per bay and floor by category, a shopfront on the ground floor of mixed and
// commercial blocks, some plain bays on houses and apartments. Here they become geometry: each window rectangle,
// clipped to each wall triangle in (u, v) and mapped back through the triangle's affine (u, v) -> world map, so pieces
// from neighbouring triangles meet; 3 cm in front of the wall (coplanar surfaces are ambiguous to the ray queries).
// Unlit panes are dark dielectric glass (they reflect the city), lit ones emitters. Which rooms are lit, in what light
// and how bright follow the source's facade shader at night (src/world/materials.js, its defaults: uSoft 1,
// uNightBlue 0.55), with our hashes in place of its: see `roomLight`.
const WINDOW_RECT: Record<number, [number, number, number, number]> = { 0: [0.26, 0.74, 0.36, 0.78], 4: [0.16, 0.84, 0.3, 0.8], 5: [0, 1, 0.26, 1] };
const OFFICE_RECT: [number, number, number, number] = [0.14, 0.86, 0.3, 0.82];
const SHOP_RECT: [number, number, number, number] = [0.05, 0.95, 0.03, 0.8];
/** A lit room's luminance (nits) at glow 1. */
const LIT_NITS = process.argv.includes("--city") ? 11 : 45;
/** The lights a room shows, after the source's softening towards a warm cloth (uSoft 1): its warm bulbs (deep and
 *  light), neutral and cool tubes (uNightBlue 0.55), and the blue of a screen. Each lit window takes the nearest. */
const LIT_COLOURS: [number, number, number][] = [[1, 0.71, 0.454], [1, 0.809, 0.589], [1, 0.868, 0.706], [0.906, 0.827, 0.738], [0.812, 0.786, 0.769], [0.685, 0.688, 0.769]];
/** Glow bins (the source's glow, 0.2–1.7): a lit window takes the nearest. */
const LIT_GLOW = [0.45, 0.85, 1.35];
function hash(a: number, b: number, c: number) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
// Sutherland–Hodgman: the part of a convex polygon (2D) on the left of a directed edge a -> b.
function clipEdge(poly: number[][], a: number[], b: number[]) {
  const side = (p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
/**
 * A room's light at night (the source's facade shader): null when it is dark, else the index of its colour
 * (LIT_COLOURS) and of its glow (LIT_GLOW).
 * - Lit share: shops 0.75, offices 0.32, homes 0.22, times 0.35–1.9 for the building (one asleep, the next busy).
 * - Most offices are lit by the floor (a storey working late, the one above dark: 0.9 or 0.05).
 * - Towers (70–110 m and up) are mostly dark glass, a few storeys lit as bands (0.82 for one storey in ten).
 * - Colour: homes mostly warm bulbs, some cool, the odd blue of a screen; an office one kind of tube throughout, cool
 *   white more often than warm.
 */
function roomLight(seed: number, col: number, row: number, cat: number, height: number, shop: boolean): [number, number] | null {
  const b1 = hash(seed, 1, 0), b2 = hash(seed, 2, 0), b3 = hash(seed, 3, 0), office = cat > 2.5;
  let onRate = (shop ? 0.75 : office ? 0.32 : 0.22) * (0.35 + 1.55 * b1);
  if (!shop && office && b2 > 0.4) onRate = hash(seed, 7, row) < 0.5 ? 0.9 : 0.05;
  if (!shop) onRate += (0.02 + 0.8 * (hash(seed, 11, row) >= 0.9 ? 1 : 0) - onRate) * smooth(70, 110, height);
  if (hash(seed, col, row + 977) >= Math.min(0.95, Math.max(0, onRate))) return null;
  const tint = hash(seed, col + 61, row), nb = 0.55;
  const warm = mix3([1, 0.6, 0.3], [1, 0.82, 0.6], hash(seed, col + 67, row));
  const cool = mix3([1, 0.95, 0.86], mix3([0.78, 0.9, 1], [0.42, 0.66, 1], nb), hash(seed, col + 71, row));
  const coolShare = (office ? (b2 >= 0.35 ? 0.95 : 0.12) : 0.25) + 0.45 * nb;
  let lamp = (office ? 0.5 * b3 + 0.5 * tint : tint) >= 1 - coolShare ? cool : warm;
  if (tint >= 0.93 - 0.22 * nb) lamp = mix3(lamp, [0.3, 0.55, 1], office ? nb : 1);
  const soft = mix3([1, 0.8, 0.58], lamp, 0.45);
  const glow = (0.3 + 1.05 * hash(seed, col + 13, row)) * (0.65 + 0.6 * b3);
  const near = (xs: number[][], d: (x: number[]) => number) => xs.reduce((bi, x, i) => (d(x) < d(xs[bi]) ? i : bi), 0);
  return [near(LIT_COLOURS, (c) => c.reduce((a, v, i) => a + (v - soft[i]) ** 2, 0)), near(LIT_GLOW.map((g) => [g]), ([g]) => Math.abs(g - glow))];
}
/** A building's switch group (scene/area.ts): the moment its lit rooms come on, a sun elevation within its use's
 *  span (offices 12 to 0 degrees, shops 6 to -2, homes 4 to -8), by a hash of the building. */
function windowGroup(seed: number, cat: number): number {
  const [hi, lo] = cat > 2.5 ? [12, 0] : cat > 1.5 ? [6, -2] : [4, -8];
  const at = hi + (lo - hi) * hash(seed, 5, 0), step = (WINDOW_SWITCH.high - WINDOW_SWITCH.low) / WINDOW_GROUPS;
  return Math.min(WINDOW_GROUPS - 1, Math.max(0, Math.floor((WINDOW_SWITCH.high - at) / step)));
}
type Soup = { pos: number[]; nor: number[] };
/** `looks`: each building's window look (far-windows.ts), in the order the mesher took them (`bd.ends`); a building
 *  with one has its rows and its module as the near levels draw them, one without the source's grid. */
function windows(bd: { position: Float32Array; normal: Float32Array; aFacade: Float32Array; aBldg: Float32Array; ends: ArrayLike<number> }, looks: (FarWindows | null)[] = []) {
  const glass: Soup = { pos: [], nor: [] };
  // lit windows by switch group, colour and glow
  const lit = WINDOW_NODES.map(() => LIT_COLOURS.map(() => LIT_GLOW.map((): Soup => ({ pos: [], nor: [] }))));
  let count = 0, litCount = 0;
  const n = bd.position.length / 9;
  let bi = 0;
  for (let t = 0; t < n; t++) {
    while (bi < bd.ends.length && t * 3 >= bd.ends[bi]) bi++;
    const fw = looks[bi] ?? null;
    const kind = bd.aBldg[t * 12 + 2], bay = bd.aBldg[t * 12 + 3];
    if (kind !== KIND.WALL || bay <= 0.5) continue;
    const height = bd.aBldg[t * 12], cat = bd.aBldg[t * 12 + 1] % 8, floorH = bd.aFacade[t * 12 + 2], seed = Math.round(bd.aFacade[t * 12 + 3] * 4096);
    const P = [0, 1, 2].map((k) => [bd.position[t * 9 + k * 3], bd.position[t * 9 + k * 3 + 1], bd.position[t * 9 + k * 3 + 2]]);
    const UV = [0, 1, 2].map((k) => [bd.aFacade[t * 12 + k * 4], bd.aFacade[t * 12 + k * 4 + 1]]);
    // affine (u, v) -> world: P = P0 + A (u - u0) + B (v - v0)
    const du1 = UV[1][0] - UV[0][0], dv1 = UV[1][1] - UV[0][1], du2 = UV[2][0] - UV[0][0], dv2 = UV[2][1] - UV[0][1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-9) continue;
    const A = [0, 1, 2].map((k) => ((P[1][k] - P[0][k]) * dv2 - (P[2][k] - P[0][k]) * dv1) / det);
    const B = [0, 1, 2].map((k) => ((P[2][k] - P[0][k]) * du1 - (P[1][k] - P[0][k]) * du2) / det);
    const nrm = [bd.normal[t * 9], bd.normal[t * 9 + 1], bd.normal[t * 9 + 2]];
    const world = (u: number, v: number) => [0, 1, 2].map((k) => P[0][k] + A[k] * (u - UV[0][0]) + B[k] * (v - UV[0][1]) + nrm[k] * 0.03);
    // the triangle counter-clockwise in (u, v)
    const tri = det > 0 ? UV : [UV[0], UV[2], UV[1]];
    const u0 = Math.min(...UV.map((p) => p[0])), u1 = Math.max(...UV.map((p) => p[0])), v0 = Math.min(...UV.map((p) => p[1])), v1 = Math.max(...UV.map((p) => p[1]));
    // (with a look: its storeys, a 4 m ground floor and the rest under the parapet, as the dress splits the wall)
    const rows = fw ? [rowAt(fw, Math.max(0, v0)), rowAt(fw, v1)] : [Math.max(0, Math.floor(v0 / floorH)), Math.ceil(v1 / floorH) - 1];
    for (let row = rows[0]; row <= rows[1]; row++) {
      for (let col = Math.floor(u0); col < u1; col++) {
        const shop = row === 0 && cat > 1.5 && cat < 3.5;
        const rects: number[][] = [];
        if (fw?.spandrelH !== undefined) for (const r of curtainWindows(fw, row, bay)) rects.push(r);
        else if (fw && row > 0) for (const r of upperWindows(fw, row, bay)) rects.push(r);
        else {
          const r = shop ? SHOP_RECT : WINDOW_RECT[cat > 4.5 ? 5 : cat > 3.5 ? 4 : cat < 0.5 ? 0 : -1] ?? OFFICE_RECT;
          const [fy, fh] = fw ? storey(fw, 0) : [row * floorH, floorH];
          if (!fw && cat < 2.5 && !shop && hash(seed, col + 41, row) < 0.2) continue; // a plain bay
          rects.push([r[0], r[1], fy + r[2] * fh, fy + r[3] * fh]);
        }
        for (const [ru0, ru1, wy0, wy1] of rects) {
        if (wy0 < 0 || wy1 > height - (fw ? 0.3 : 0.9)) continue;
        let poly = [[col + ru0, wy0], [col + ru1, wy0], [col + ru1, wy1], [col + ru0, wy1]];
        for (let e = 0; e < 3 && poly.length; e++) poly = clipEdge(poly, tri[e], tri[(e + 1) % 3]);
        if (poly.length < 3) continue;
        const light = roomLight(seed, col, row, cat, height, shop), on = light !== null;
        const dst = light ? lit[windowGroup(seed, cat)][light[0]][light[1]] : glass;
        const w = poly.map((p) => world(p[0], p[1]));
        for (let i = 1; i + 1 < w.length; i++) for (const p of [w[0], w[i], w[i + 1]]) { dst.pos.push(...p); dst.nor.push(...nrm); }
        // (a window clipped by two triangles counts twice: counted where its lower-left corner lies)
        const cu = col + ru0, cv = wy0;
        const inside = clipEdge(clipEdge(clipEdge([[cu, cv], [cu + 1e-4, cv], [cu, cv + 1e-4]], tri[0], tri[1]), tri[1], tri[2]), tri[2], tri[0]).length > 0;
        if (inside) { count++; if (on) litCount++; }
        }
      }
    }
  }
  return { glass, lit, count, litCount };
}

// ---------------------------------------------------------------- tiles

const totals = { tiles: 0, triangles: 0, buildings: 0, bytes: 0, images: 0, windows: 0, litWindows: 0, props: {} as Record<string, number>, signs: 0, decals: 0 };
/** A signboard's luminance (nits) where its atlas is white: a backlit board by night, and the little it shows by day. */
const SIGN_NITS = { day: 20, night: 200 };
const PROP_NAME = Object.fromEntries(Object.entries(PROP).map(([k, v]) => [v, k.toLowerCase()]));
const index: { x: number; z: number; file: string; triangles: number; buildings: number; nodes?: string[] }[] = [];
const t0 = Date.now();
const build = createHash("sha256");
// `--city`: the far level of the streamed city (scene/city.game.ts): the tile's ground in node "ground" (terrain,
// roads, paint, the road symbols); its buildings, their windows and signs, its props and its trees by
// 128 m quadrant q (0..3: +x half, then +z half) in nodes b<q> (lit windows and signs: b<q>-night / b<q>-day), p<q>
// (lamp heads: p<q>-night / p<q>-day) and t<q>, so the scene can hide a quadrant's own when a nearer level shows it.
const cityLevel = process.argv.includes("--city");
/** The edges the area shares with another of the stitched city (tools/tokyo/stitch.ts). */
const seams = cityLevel ? seamsOf(area) : [];
if (seams.length) console.log(`${area}: seams ${seams.map((q) => `${"xyz"[q.axis]} ${q.sign > 0 ? "<=" : ">="} ${q.at}`).join(", ")}`);
// The near levels' looks (looks.json, tools/tokyo/city-bake.ts): a building far away keeps the wall colour the dress gave
// it near, and a tower its curtain wall (its storeys' vision glass, the wall between them its spandrels: their colour,
// and their polish, a metal panel's, as the dress has them).
// Ids are the tiles' buildings in city-bake's order (the files sorted, a building's polygons each one).
type Looks = { looks: Record<string, BuildingLook>; materials: Record<string, { albedo: number[]; roughness?: number; metalness?: number }> };
const looksFile = join(city, "baked", area, "looks.json");
const looks: Looks | null = cityLevel && existsSync(looksFile) ? JSON.parse(readFileSync(looksFile, "utf8")) : null;
const firstId = new Map<string, number>();
if (looks) {
  let id = 0;
  for (const f of readdirSync(tilesDir).filter((f) => /^t_.*\.bin$/.test(f)).sort()) {
    firstId.set(f, id);
    const tb = readFileSync(join(tilesDir, f));
    for (const bd of decodeTile(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength)).buildings) for (const p of bd.polygons) if (p[0]) id++;
  }
} else if (cityLevel) console.warn(`(no ${looksFile}: the far level in the source's colours; run tools/tokyo/city-bake.ts first)`);
const albedo = (name: string) => (looks!.materials[name]?.albedo ?? [0.5, 0.5, 0.5]).map((v) => Math.min(0.9, v));
/** A tower's vision glass far away: the dress's curtain glass as an opaque pane of its colour, nearly black. Clear glass
 *  scatters next to no light itself: what it shows is its reflection and the tinted room behind it (the scene's
 *  `TokyoFarCurtainRoom`). At 0.35 a sunlit bronze tower read as a pale wall far away and dark glass at L1 (the towers
 *  pose's 480 m switch, swept: 0.35 / 0.12 / 0.06 / 0.02 gave mean ΔE 0.40 / 0.27 / 0.24 / 0.21). */
const CURTAIN_FAR = 0.02;
/** The curtain glass the far level uses, and what it lets through (its linear colour: the dress's glass transmits it
 *  all, tinted): the scene's rooms behind a far tower's panes by day are that much dimmer, as they are near. */
const curtains: Record<string, number[]> = {};
const curtainGlass = (name: string): Omit<Material, "name"> => ({ color: albedo(name).map((v) => v * CURTAIN_FAR) as [number, number, number], roughness: 0.04, ior: 1.5 });
/** How a wall of a tower's spandrels reflects (looks.json: the dress's spandrel material); a wall of an older looks.json
 *  is matt. */
const spandrelFinish = (name: string) => ({ roughness: looks!.materials[name]?.roughness ?? 0.8, metallic: looks!.materials[name]?.metalness ?? 0 });
/** Each building's look (`b.look`, read by the mesher) from looks.json, before any filter changes the order. */
function setLooks(tile: ReturnType<typeof decodeTile>, file: string) {
  if (!looks) return;
  let id = firstId.get(file) ?? 0;
  for (const b of tile.buildings as { polygons: Float32Array[][]; look?: { wall: number[]; curtain: string | null; spandrel: string | null; windows: FarWindows | null } }[]) {
    let first = -1;
    for (const p of b.polygons) if (p[0]) { if (first < 0) first = id; id++; }
    const l = looks.looks[first];
    // (and its windows: the near levels' module and storeys; the mesher takes its bay)
    if (l) b.look = { wall: albedo(l.curtain ? l.curtain.spandrel : l.wall), curtain: l.curtain?.glass ?? null, spandrel: l.curtain?.spandrel ?? null, windows: farWindows(l) };
  }
}
/** The far level's trees by tile and quadrant ("x_z_q"): each a form and its frame (props.ts `treeCopies`). */
/** The far level's sign atlases, at this fraction of the near levels' size. */
const FAR_SIGN_SCALE = 0.25;
const farTrees = new Map<string, { form: number; frame: number[] }[]>();
/** trees.bin, the far level's trees for the scene to draw as instances (scene/city.game.ts `farTrees`): "TKT1", the
 *  header's length (u32) and the header (JSON: `palette`, each colour [r, g, b] linear and its roughness; `forms`,
 *  each form's vertex and index counts and where its data is; `quads`, each quadrant's [form, copies, where their
 *  frames are]), then each form's positions, normals, uvs (its colour's place on the palette: a row of 32 x 32 px
 *  swatches) and indices, then the frames (12 floats a copy). */
function writeTrees(dir: string) {
  const names: string[] = [];
  const forms = TREE_FORMS.map((parts) => {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [];
    for (const part of parts) {
      let k = names.indexOf(part.mat);
      if (k < 0) k = names.push(part.mat) - 1;
      for (const t of part.tris) for (const p of t.p) { pos.push(...p); nor.push(...t.n); uv.push(k, 0.5); }
    }
    return { pos, nor, uv };
  });
  for (const f of forms) for (let i = 0; i < f.uv.length; i += 2) f.uv[i] = (f.uv[i] + 0.5) / names.length;
  const palette = names.map((n) => [...PROP_MATERIALS[n].color, PROP_MATERIALS[n].roughness]);
  const blobs: Buffer[] = [];
  let at = 0;
  const put = (a: Float32Array | Uint32Array) => { const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength); blobs.push(b); const o = at; at += b.length; return o; };
  const fhead = forms.map((f) => {
    const v = f.pos.length / 3;
    const o = put(Float32Array.from(f.pos));
    put(Float32Array.from(f.nor));
    put(Float32Array.from(f.uv));
    put(Uint32Array.from({ length: v }, (_, i) => i));
    return { v, i: v, at: o };
  });
  const quads: Record<string, [number, number, number][]> = {};
  let copies = 0;
  for (const [key, list] of farTrees) {
    const byForm = new Map<number, number[]>();
    for (const c of list) (byForm.get(c.form) ?? byForm.set(c.form, []).get(c.form)!).push(...c.frame);
    quads[key] = [...byForm].map(([form, fr]) => [form, fr.length / 12, put(Float32Array.from(fr))]);
    copies += list.length;
  }
  const head = Buffer.from(JSON.stringify({ palette, forms: fhead, quads }));
  const pre = Buffer.alloc(8);
  pre.writeUInt32LE(0x3154_4b54, 0);
  pre.writeUInt32LE(head.length, 4);
  // (the data's offsets count from the end of the header)
  writeFileSync(join(dir, "trees.bin"), Buffer.concat([pre, head, ...blobs]));
  return copies;
}
async function cityTile(tile: ReturnType<typeof decodeTile>, tl: Manifest["tiles"][number], g: GlbBuilder, tag: string) {
  const x0 = tl.x * size, z0 = tl.z * size, half = size / 2;
  const quad = (x: number, z: number) => (x >= x0 + half ? 1 : 0) + (z >= z0 + half ? 2 : 0);
  const cen = (r: Float32Array) => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x / (r.length / 2), z / (r.length / 2)] as const; };
  // ground: the mesher without buildings
  const m = buildTile({ ...tile, buildings: [], signs: [] }, grid, size, surface, []);
  {
    const tp = m.terrain.position as Float32Array;
    const uv = new Float32Array((tp.length / 3) * 2);
    for (let i = 0, j = 0; i < tp.length; i += 3, j += 2) { uv[j] = tp[i] / 4; uv[j + 1] = tp[i + 2] / 4; }
    // (the tile's terrain runs to its edges, past the area's: where another area of the city lies, it stops at the
    // seam, the other's taking over)
    const c = seams.length ? clipToSeams(seams, tp, m.terrain.normal, uv, m.terrain.index) : null;
    if (!c || c.index.length) g.triangles(g.material({ name: `ground ${tag}`, color: [0.14, 0.14, 0.12], roughness: 0.92 }), c?.pos ?? tp, c?.nor ?? m.terrain.normal, c?.uv ?? uv, c?.index ?? Uint32Array.from(m.terrain.index), "ground");
  }
  for (const [kind, a] of [["road", m.roads], ["paint", m.paint]] as const) {
    if (!a.position.length) continue;
    soupTo(g, a, (tri) => `${kind} ${a.aLayer[tri * 3]} ${quant(colorOf(a.color, tri)).join(",")}`, (k) => {
      const [, layer, q] = k.split(" ");
      return { name: k, color: fromQuant(q.split(",").map(Number)), roughness: kind === "paint" ? 0.6 : ROUGH[Number(layer)] ?? 0.85 };
    }, "ground");
  }
  {
    const drape = createDraper(grid, surface, size);
    const d = decalGeometry(tile.props, drape, await decalShapes());
    for (const [paint, sp, color] of [["white", d.white, [0.8, 0.8, 0.78]], ["orange", d.orange, [0.89, 0.37, 0.012]]] as const) {
      if (!sp.length) continue;
      const pos = Float32Array.from(sp), nor = new Float32Array(pos.length);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
      g.triangles(g.material({ name: `road symbols ${paint}`, color: [...color], roughness: 0.6 }), pos, nor, null, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), "ground");
    }
  }
  // props and trees by quadrant
  {
    const all = m.props as Float32Array;
    for (let q = 0; q < 4; q++) for (const trees of [false, true]) {
      const sel: number[] = [];
      for (let i = 0; i < all.length; i += 6) if (quad(all[i + 3], all[i + 4]) === q && (all[i] === PROP.TREE) === trees) sel.push(...all.subarray(i, i + 6));
      if (!sel.length) continue;
      // (the trees: copies of a few forms, the scene's instances, in trees.bin; not triangles of the tile's)
      if (trees) {
        const copies = treeCopies(Float32Array.from(sel), (x, z) => surface(x, z));
        if (copies.length) farTrees.set(`${tl.x}_${tl.z}_${q}`, copies);
        continue;
      }
      const p = propSoups(Float32Array.from(sel), (x, z) => surface(x, z));
      for (const { node, mat, soup: sp } of p.soups.values()) {
        const pm = PROP_MATERIALS[mat];
        const pos = Float32Array.from(sp.pos), nor = Float32Array.from(sp.nor);
        const nn = trees ? `t${q}` : node === "city" ? `p${q}` : `p${q}-${node}`;
        g.triangles(g.material({ name: `prop ${mat}`, color: pm.color, roughness: pm.roughness, metallic: pm.metallic, ...(pm.emissive ? { emissive: pm.emissive, emissiveStrength: pm.nits } : {}) }), pos, nor, null, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), nn);
      }
    }
  }
  // buildings by quadrant
  
  for (let q = 0; q < 4; q++) {
    const bs = tile.buildings.filter((b: { polygons: Float32Array[][] }) => b.polygons[0]?.[0] && quad(...cen(b.polygons[0][0])) === q);
    const ss = tile.signs.filter((sg: { x: number; z: number }) => quad(sg.x, sg.z) === q);
    if (!bs.length && !ss.length) continue;
    // (by curtain wall: a tower's windows in its own glass; the signs with the first group)
    const groups = new Map<string, typeof bs>();
    for (const b of bs) { const k = (b as { look?: { curtain: string | null } }).look?.curtain ?? ""; (groups.get(k) ?? groups.set(k, []).get(k)!).push(b); }
    if (!groups.size) groups.set("", []);
    let mq: ReturnType<typeof buildTile> | null = null;
    const B = `b${q}`;
    for (const [curtain, gb] of groups) {
    const m1 = buildTile({ ...tile, buildings: gb, signs: mq ? [] : ss, areas: [], props: [], walls: [], wires: new Float32Array(0) }, grid, size, surface, []);
    mq ??= m1;
    const bd = m1.buildings;
    if (bd.position.length) {
      // (a curtain wall's walls are its spandrels: each triangle's building from the mesher's ends)
      const spandrelOf = (tri: number) => {
        if (!curtain) return null;
        let lo = 0, hi = bd.ends.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tri * 3 >= bd.ends[mid]) lo = mid + 1; else hi = mid; }
        return (gb[lo] as { look?: { spandrel: string | null } } | undefined)?.look?.spandrel ?? null;
      };
      soupTo(g, bd, (tri) => {
        const kind = bd.aBldg[tri * 12 + 2], c = colorOf(bd.color, tri), sp = kind === KIND.WALL ? spandrelOf(tri) : null;
        return kind === KIND.LATTICE && Math.max(...c) > 1 ? `lamp ${c.map((v) => v.toFixed(2)).join(",")}` : `bldg ${kind} ${quant(c).join(",")}${sp ? ` ${sp}` : ""}`;
      }, (k) => {
        if (k.startsWith("lamp ")) return towerLamp(k.split(" ")[1].split(",").map(Number)).map((e) => ({ node: `${B}-${e.node}`, material: e.material }));
        const [, kind, qq, ...sp] = k.split(" ");
        const K = Number(kind);
        if (sp.length) return { name: k, color: fromQuant(qq.split(",").map(Number)), ...spandrelFinish(sp.join(" ")) };
        return { name: k, color: fromQuant(qq.split(",").map(Number)), roughness: K === KIND.LATTICE ? 0.5 : K === KIND.WALL ? 0.8 : 0.88, metallic: 0 };
      }, B);
      const w = windows(bd, gb.map((b) => (b as { look?: { windows: FarWindows | null } }).look?.windows ?? null));
      const put = (sp: Soup, mat: Material, node: string) => {
        if (!sp.pos.length) return;
        const pos = Float32Array.from(sp.pos), nor = Float32Array.from(sp.nor);
        g.triangles(g.material(mat), pos, nor, null, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), node);
      };
      const glass: Omit<Material, "name"> = { color: [0.02, 0.022, 0.025], roughness: 0.04, ior: 1.5 };
      put(w.glass, curtain ? { name: `window glass ${curtain}`, ...curtainGlass(curtain) } : { name: "window glass", ...glass }, B);
      // (unlit: seen, lighting nothing; a far city's 1.3 M window triangles out of the light list)
      // (a curtain wall's in their own, which the scene sees its room through by day: "window lit curtain <glass>")
      w.lit.forEach((group) => group.forEach((bins, i) => bins.forEach((sp, j) => put(sp, { name: curtain ? `window lit curtain ${curtain} ${i} ${j}` : `window lit far ${i} ${j}`, ...glass, emissive: LIT_COLOURS[i], emissiveStrength: LIT_NITS * LIT_GLOW[j], unlit: true }, `${B}-night`))));
      if (curtain) curtains[curtain] = albedo(curtain);
      totals.windows += w.count;
      totals.litWindows += w.litCount;
    }
    }

    if (mq?.signs?.length) {
      // (at a quarter of the near levels' size: 4.7 -> 0.3 Gpx of atlases for two areas, each far tile's ~10 MB of
      // texture pages a commit of its own when the tile streams in)
      const sb = await signBoards(mq.signs, FAR_SIGN_SCALE);
      if (sb) {
        for (const [p, pg] of sb.pages.entries()) {
          const tex = g.image(new Uint8Array(pg.atlas), "image/png", true);
          const pos = Float32Array.from(pg.pos), nor = Float32Array.from(pg.nor), uv = Float32Array.from(pg.uv), idx = Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
          for (const node of ["day", "night"] as const) g.triangles(g.material({ name: `signs ${node} ${q} ${p}`, color: [1, 1, 1], roughness: 0.55, texture: tex, emissive: [1, 1, 1], emissiveTexture: tex, emissiveStrength: SIGN_NITS[node], unlit: node === "night" }), pos, nor, uv, idx, `${B}-${node}`);
        }
        totals.signs += sb.boards;
      }
    }
  }
}
function soupTo(g: GlbBuilder, a: { position: Float32Array; normal: Float32Array; color?: Float32Array }, key: (tri: number) => string, material: (key: string) => Placed, node: string) {
  const n = a.position.length / 9;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let list = groups.get(k);
    if (!list) groups.set(k, (list = []));
    list.push(i);
  }
  for (const [k, tris] of groups) {
    const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9), idx = new Uint32Array(tris.length * 3);
    tris.forEach((tri, j) => {
      pos.set(a.position.subarray(tri * 9, tri * 9 + 9), j * 9);
      nor.set(a.normal.subarray(tri * 9, tri * 9 + 9), j * 9);
      idx[j * 3] = j * 3; idx[j * 3 + 1] = j * 3 + 1; idx[j * 3 + 2] = j * 3 + 2;
    });
    const mm = material(k);
    if (Array.isArray(mm)) for (const { node: nd, material: x } of mm) g.triangles(g.material(x), pos, nor, null, idx, nd);
    else g.triangles(g.material(mm), pos, nor, null, idx, node);
  }
}

for (const tl of manifest.tiles) {
  if (only && !only.includes(`${tl.x}_${tl.z}`)) continue;
  const tile = decodeTile(new Uint8Array(readFileSync(join(tilesDir, tl.file))).buffer);
  if (cityLevel) setLooks(tile, tl.file);
  if (strip) {
    const [sx0, sz0, sx1, sz1] = strip;
    const c = (r: Float32Array) => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x / (r.length / 2), z / (r.length / 2)]; };
    tile.buildings = tile.buildings.filter((b: { polygons: Float32Array[][] }) => { if (!b.polygons[0]?.[0]) return true; const [x, z] = c(b.polygons[0][0]); return !(x >= sx0 && x <= sx1 && z >= sz0 && z <= sz1); });
    // and the trees (dressed with shared EZ-Tree models)
    tile.props = tile.props.filter((p: { kind: number; x: number; z: number }) => p.kind !== PROP.TREE || !(p.x >= sx0 && p.x <= sx1 && p.z >= sz0 && p.z <= sz1));
  }
  if (exclude) {
    const [ex0, ez0, ex1, ez1] = exclude;
    const inside = (x: number, z: number) => x >= ex0 && x <= ex1 && z >= ez0 && z <= ez1;
    const centre = (r: Float32Array) => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x / (r.length / 2), z / (r.length / 2)] as const; };
    tile.buildings = tile.buildings.filter((b: { polygons: Float32Array[][] }) => !b.polygons[0]?.[0] || !inside(...centre(b.polygons[0][0])));
    tile.props = tile.props.filter((p: { x: number; z: number }) => !inside(p.x, p.z));
    tile.signs = tile.signs.filter((s: { x: number; z: number }) => !inside(s.x, s.z));
    const keep: number[] = [];
    for (let i = 0; i < tile.wires.length; i += 4) if (!inside(tile.wires[i], tile.wires[i + 1]) && !inside(tile.wires[i + 2], tile.wires[i + 3])) keep.push(...tile.wires.subarray(i, i + 4));
    tile.wires = Float32Array.from(keep);
  }
  if (cityLevel) {
    const g = new GlbBuilder(), tag = `${area}_${tl.x}_${tl.z}`;
    await cityTile(tile, tl, g, tag);
    const glb = g.build(tag), file = `t_${tl.x}_${tl.z}.glb`;
    writeFileSync(join(outDir, file), glb);
    // (the nodes it has: a model of nodes a tile lacks draws nothing, and the scene cannot hide or show it in place)
    const gb = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength), jl = gb.readUInt32LE(12), nodes = (JSON.parse(gb.subarray(20, 20 + jl).toString()).nodes ?? []).map((n: { name: string }) => n.name);
    index.push({ x: tl.x, z: tl.z, file, triangles: g.stats.triangles, buildings: tile.buildings.length, nodes } as (typeof index)[number]);
    totals.tiles++; totals.triangles += g.stats.triangles; totals.bytes += glb.length;
    continue;
  }
  const m = buildTile(tile, grid, size, surface, []);
  const g = new GlbBuilder();
  const tag = `${area}_${tl.x}_${tl.z}`;

  // the terrain, one colour (uv in metres / 4)
  {
    const tp = m.terrain.position as Float32Array;
    const uv = new Float32Array((tp.length / 3) * 2);
    const x0 = tl.x * size, z0 = tl.z * size;
    for (let i = 0, j = 0; i < tp.length; i += 3, j += 2) { uv[j] = tp[i] / 4; uv[j + 1] = tp[i + 2] / 4; }

    g.triangles(g.material({ name: `ground ${tag}`, color: [0.14, 0.14, 0.12], roughness: 0.92 }), tp, m.terrain.normal, uv, Uint32Array.from(m.terrain.index));
  }

  // road surfaces, kerbs, parks, water; then paint
  for (const [kind, a] of [["road", m.roads], ["paint", m.paint]] as const) {
    if (!a.position.length) continue;
    soup(g, a, (tri) => `${kind} ${a.aLayer[tri * 3]} ${quant(colorOf(a.color, tri)).join(",")}`, (k) => {
      const [, layer, q] = k.split(" ");
      const L = Number(layer);
      return { name: k, color: fromQuant(q.split(",").map(Number)), roughness: kind === "paint" ? 0.6 : ROUGH[L] ?? 0.85 };
    });
  }

  // buildings: walls, roofs and the solid parts by kind and colour
  const bd = m.buildings;
  if (bd.position.length) {
    soup(g, bd, (tri) => {
      const kind = bd.aBldg[tri * 12 + 2], c = colorOf(bd.color, tri);
      // lattice lamps (colours above 1) by their raw colour; everything else by its quantised colour
      return kind === KIND.LATTICE && Math.max(...c) > 1 ? `lamp ${c.map((v) => v.toFixed(2)).join(",")}` : `bldg ${kind} ${quant(c).join(",")}`;
    }, (k) => {
      if (k.startsWith("lamp ")) return towerLamp(k.split(" ")[1].split(",").map(Number));
      const [, kind, q] = k.split(" ");
      const K = Number(kind);
      // a lattice tower is painted steel (Tokyo Tower: international orange and white): a dielectric paint, not metal
      return { name: k, color: fromQuant(q.split(",").map(Number)), roughness: K === KIND.LATTICE ? 0.5 : K === KIND.WALL ? 0.8 : 0.88, metallic: 0 };
    });
  }
  // windows: glass, and the lit ones as emitters
  if (bd.position.length) {
    const w = windows(bd);
    const put = (soup: Soup, mat: Material, node = "city") => {
      if (!soup.pos.length) return;
      const pos = Float32Array.from(soup.pos), nor = Float32Array.from(soup.nor);
      g.triangles(g.material(mat), pos, nor, null, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), node);
    };
    const glass: Omit<Material, "name"> = { color: [0.02, 0.022, 0.025], roughness: 0.04, ior: 1.5 };
    put(w.glass, { name: "window glass", ...glass });
    // the lit ones in their switch group's node (scene/area.ts WINDOW_NODES): the same glass with the room's light
    // behind it, so that while their group is off (tokyo-tod, by day) they read as the panes around them
    w.lit.forEach((group, k) => group.forEach((bins, i) => bins.forEach((soup, j) => put(soup, { name: `window lit ${i} ${j}`, ...glass, emissive: LIT_COLOURS[i], emissiveStrength: LIT_NITS * LIT_GLOW[j] }, WINDOW_NODES[k]))));
    totals.windows += w.count;
    totals.litWindows += w.litCount;
  }
  // street props: lights and poles (their LED heads lit in the "night" node), signals, vending machines, parked cars, trees
  if (m.props.length) {
    const p = propSoups(m.props, (x, z) => surface(x, z));
    for (const { node, mat, soup } of p.soups.values()) {
      const pm = PROP_MATERIALS[mat];
      const pos = Float32Array.from(soup.pos), nor = Float32Array.from(soup.nor);
      g.triangles(g.material({ name: `prop ${mat}`, color: pm.color, roughness: pm.roughness, metallic: pm.metallic, ...(pm.emissive ? { emissive: pm.emissive, emissiveStrength: pm.nits } : {}) }), pos, nor, null, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), node);
    }
    for (const [k, n] of Object.entries(p.counts)) totals.props[PROP_NAME[k] ?? k] = (totals.props[PROP_NAME[k] ?? k] ?? 0) + n;
  }

  // the road's painted symbols, as geometry on the draped road (the mesher's own drape for this tile)
  {
    const drape = createDraper(grid, surface, size);
    const d = decalGeometry(tile.props, drape, await decalShapes());
    for (const [paint, soup, color] of [["white", d.white, [0.8, 0.8, 0.78]], ["orange", d.orange, [0.89, 0.37, 0.012]]] as const) {
      if (!soup.length) continue;
      const pos = Float32Array.from(soup), nor = new Float32Array(pos.length);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
      g.triangles(g.material({ name: `road symbols ${paint}`, color: [...color], roughness: 0.6 }), pos, nor, null, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i));
    }
    totals.decals += d.count;
  }

  // signboards: the tile's names on its atlas pages; the same boards in the "day" node (glowing a little) and the "night" one
  if (m.signs?.length) {
    const sb = await signBoards(m.signs);
    if (sb) {
      for (const [p, pg] of sb.pages.entries()) {
        const tex = g.image(new Uint8Array(pg.atlas), "image/png", true);
        const pos = Float32Array.from(pg.pos), nor = Float32Array.from(pg.nor), uv = Float32Array.from(pg.uv), idx = Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
        for (const node of ["day", "night"] as const) {
          g.triangles(g.material({ name: `signs ${node} ${p}`, color: [1, 1, 1], roughness: 0.55, texture: tex, emissive: [1, 1, 1], emissiveTexture: tex, emissiveStrength: SIGN_NITS[node] }), pos, nor, uv, idx, node);
        }
      }
      totals.signs += sb.boards;
    }
  }

  const glb = g.build(tag);
  const file = `t_${tl.x}_${tl.z}.glb`;
  writeFileSync(join(outDir, file), glb);
  build.update(file).update(glb);
  index.push({ x: tl.x, z: tl.z, file, triangles: g.stats.triangles, buildings: tile.buildings.length });
  totals.tiles++;
  totals.triangles += g.stats.triangles;
  totals.buildings += tile.buildings.length;
  totals.bytes += glb.length;
  totals.images += g.stats.images;
}
if (only) {
  console.log(`${area}: ${totals.tiles} tiles (${only.join(" ")}) -> ${outDir}`);
  process.exit(0);
}
if (cityLevel) {
  const trees = writeTrees(outDir);
  console.log(`${area}: ${trees} far trees as copies of ${TREE_FORMS.length} forms -> trees.bin`);
  writeFileSync(join(outDir, "index.json"), JSON.stringify({ area, tileSize: size, bounds: manifest.bounds, tiles: index, triangles: totals.triangles, curtains }, null, 1) + "\n");
  console.log(`${area} (city far level): ${totals.tiles} tiles, ${(totals.triangles / 1e6).toFixed(2)} M triangles, ${(totals.bytes / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outDir}`);
  process.exit(0);
}
const out = {
  area, origin: manifest.origin, tileSize: size, bounds: manifest.bounds,
  // the GLBs' digest: it changes the scene bundle when they change (and with it the truths cached by bundle)
  build: build.digest("hex").slice(0, 12),
  counts: { tiles: totals.tiles, triangles: totals.triangles, buildings: totals.buildings, windows: totals.windows, litWindows: totals.litWindows, props: totals.props, signs: totals.signs, roadSymbols: totals.decals, images: totals.images, glbBytes: totals.bytes },
  tiles: index,
};
writeFileSync(join(outDir, "index.json"), JSON.stringify(out, null, 1) + "\n");
// The scene's view of the area (committed: tile coordinates, bounds and counts, not the data), so the scene bundles and
// type-checks without the local assets.
const areasDir = join(repoRoot, "scene/areas");
mkdirSync(areasDir, { recursive: true });
writeFileSync(join(areasDir, `${area}.ts`), `// Generated by tools/tokyo/to-glb.ts --area=${area}: the area's tiles (assets/city/glb/${area}/) and counts.\nimport type { AreaIndex } from "../area.ts";\n\nexport default ${JSON.stringify({ ...out, tiles: index.map(({ x, z, file }) => ({ x, z, file })) })} satisfies AreaIndex;\n`);
console.log(`${area}: ${totals.tiles} tiles, ${(totals.triangles / 1e6).toFixed(2)} M triangles, ${totals.buildings} buildings, ${totals.windows} windows (${totals.litWindows} lit), ${totals.images} images, ${(totals.bytes / 1e6).toFixed(0)} MB of GLB in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outDir}`);
