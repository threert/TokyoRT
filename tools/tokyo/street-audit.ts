// The street level against the Japanese road-marking and overhead-line standards, measured (issue #28's table, the
// rows that can be read from data): a report to run before and after work on the ordinary street (ROADMAP 6h).
// It reads what the street is built from and changes nothing:
//   - the compiled tiles (tools/city): the paint quads (MARK_WHITE / MARK_YELLOW areas, from pipeline/markings.mjs),
//     the road symbols (DECAL props), the utility poles (POLE props) and their spans (wires, pipeline/landscape.mjs),
//     the carriageway polygons (to measure each road's width), and roads.json (road classes, signals);
//   - the symbols' painted shapes, traced from the decal atlas as the client traces them (tools/tokyo/decals.ts), laid
//     on the cell the mesher gives each symbol (tools/city/mesh/decals.js);
//   - the near pole rig (scene/hero/dress.ts) and the far pole model (scene/hero/streetprops.ts), read from their
//     source: conductor heights, sag, pole and lamp heights. If the rig's code changes shape, those rows say so.
// The standards are cited by name: 道路標識、区画線及び道路標示に関する命令 (標識令), 警察庁「交通規制基準」 (規制基準),
// 安全で快適な自転車利用環境創出ガイドライン (自転車GL), 有線電気通信設備令施行規則 第7条.
//   node tools/tokyo/street-audit.ts [--area=shinjuku] [--bbox=minX,minZ,maxX,maxZ] [--tiles=<dir>] [--json [<file>]]
//   node tools/tokyo/street-audit.ts --diff before.json after.json
// (bbox in the area's own frame, metres east and south of its origin). `--json <file>` writes every row as data
// (id, item, standard, source, measured numbers, unit, verdict) beside the Markdown; `--diff` lists the rows whose
// numbers or verdict changed between two such files: the before / after of a change to the street. Always exits 0.
// Below the standards' rows, the street furniture of 6h along minor roads: what the tiles hold per km, and what they
// do not hold at all ("none in the data"). Below that, the buildings of 6h along minor roads: how many by use and
// storeys (from the tiles), and what the street level gives the mid-rise flats (from the dressing code: "none in the
// code" where it has no such feature).
import { readFileSync, readdirSync, existsSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { AREA, PROP, DECAL, decodeTile } from "../city/shared/tileformat.js";
import { PolyIndex, forEachAlong } from "../city/pipeline/landscape.mjs";
import { decalMesh } from "../city/mesh/decals.js";

export type Box = { minX: number; minZ: number; maxX: number; maxZ: number };
export type Tile = { areas: { kind: number; polygons: ArrayLike<number>[][] }[]; props: { kind: number; variant: number; rot: number; x: number; z: number }[]; wires: ArrayLike<number>;
  buildings?: { usage?: number; storeys: number; height: number; hint?: number; polygons: ArrayLike<number>[][] }[] };
export type Edge = { highway: string; oneway?: number; bridge?: number; tunnel?: number; pts: number[] };
/** The near and far pole models, as their source builds them (null where the source no longer has that shape). */
export type Rig = { poleHeight: number | null; conductors: number[] | null; sag: [number, number] | null; nearLamp: number | null; farPoleHeight: number | null; farLamp: number | null };
export type Input = {
  tiles: Tile[]; edges: Edge[]; signals: [number, number][]; rig: Rig;
  /** each DECAL variant's painted triangles in cell texels (x across, y along, y = 0 the far end), or null */
  shapes: Map<number, { tris: number[] }> | null;
  /** a DECAL variant's cell on the road, [across, along] metres */
  cell: (variant: number) => [number, number];
  bbox?: Box | null;
  /** what the dressing code gives a building (parseBuildingCode); the buildings section is left out without it */
  code?: BuildingCode;
};
/** A row of the report. `standard` and `measured` are the Markdown's text; `source` names the document the standard comes
 * from; `values` are the measured numbers (null where there was nothing to measure), `unit` the unit of the lengths among
 * them (counts, shares and per-km figures say so in their names). */
export type Row = { id: string; item: string; standard: string; source: string; measured: string; value: number | null; values: Record<string, number | null>; unit: string; verdict: string };
export type Report = { rows: Row[]; furniture: Row[]; buildings?: Row[]; edgeLines: { cls: string; width: string; km: number; anySide: number; bothSides: number }[]; spacing: { bin: string; n: number }[]; decals: Record<string, number> };

const CELL_W = 256, CELL_H = 512; // the atlas cell in texels (tools/tokyo/decals.ts)
const MINOR = new Set(["residential", "unclassified", "living_street"]);
const MAJOR = new Set(["trunk", "primary", "secondary", "tertiary"]);
const WIDTHS: [number, number, string][] = [[0, 4, "< 4 m"], [4, 5.5, "4-5.5 m"], [5.5, 7, "5.5-7 m"], [7, 9, "7-9 m"], [9, 99, ">= 9 m"]];

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((p, r) => p - r); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const inBox = (b: Box | null | undefined, x: number, z: number) => !b || (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);

/** A grid of points for neighbour queries. */
class Grid<T extends { x: number; z: number }> {
  cells = new Map<string, T[]>();
  cell: number;
  constructor(cell: number, items: T[]) { this.cell = cell; for (const it of items) { const k = this.key(it.x, it.z); if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k)!.push(it); } }
  key(x: number, z: number) { return Math.floor(x / this.cell) + "," + Math.floor(z / this.cell); }
  near(x: number, z: number, r: number): T[] {
    const out: T[] = [], c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++)
        for (const it of this.cells.get(i + "," + j) ?? []) if (Math.hypot(it.x - x, it.z - z) <= r) out.push(it);
    return out;
  }
}

// ---------------------------------------------------------------- the paint quads
type Quad = { x: number; z: number; ux: number; uz: number; len: number; wid: number; kind: number; ends: [string, string] };
export function paintQuads(tiles: Tile[], bbox?: Box | null): Quad[] {
  const out: Quad[] = [];
  for (const t of tiles) for (const a of t.areas) {
    if (a.kind !== AREA.MARK_WHITE && a.kind !== AREA.MARK_YELLOW) continue;
    for (const rings of a.polygons) {
      const r = rings[0];
      if (rings.length !== 1 || r.length !== 8) continue; // a quad: 4 points
      const p = [0, 1, 2, 3].map((i) => [r[i * 2], r[i * 2 + 1]]);
      const x = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, z = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
      if (!inBox(bbox, x, z)) continue;
      const s0 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), s1 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
      const long = s0 >= s1 ? [p[0], p[1]] : [p[1], p[2]], len = Math.max(s0, s1), wid = Math.min(s0, s1);
      if (len < 1e-3) continue;
      const k = (q: number[]) => q[0].toFixed(2) + ":" + q[1].toFixed(2);
      const end = (q: number[], w: number[]) => [k(q), k(w)].sort().join("|");
      const ends: [string, string] = s0 >= s1 ? [end(p[1], p[2]), end(p[3], p[0])] : [end(p[0], p[1]), end(p[2], p[3])];
      out.push({ x, z, ux: (long[1][0] - long[0][0]) / len, uz: (long[1][1] - long[0][1]) / len, len, wid, kind: a.kind, ends });
    }
  }
  return out;
}
const isLine = (q: Quad) => q.wid >= 0.08 && q.wid <= 0.25 && q.len >= 0.5;
const isBar = (q: Quad) => q.wid >= 0.28 && q.wid <= 0.6;

/** Line pieces joined end to end (they share their end's two corners) into runs: [length, pieces, ends]. */
function chains(lines: Quad[]) {
  const byEnd = new Map<string, number[]>();
  lines.forEach((q, i) => q.ends.forEach((e) => { if (!byEnd.has(e)) byEnd.set(e, []); byEnd.get(e)!.push(i); }));
  const parent = lines.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const ids of byEnd.values()) for (const i of ids.slice(1)) parent[find(i)] = find(ids[0]);
  const runs = new Map<number, Quad[]>();
  lines.forEach((q, i) => { const r = find(i); if (!runs.has(r)) runs.set(r, []); runs.get(r)!.push(q); });
  return [...runs.values()].map((qs) => {
    const len = qs.reduce((s, q) => s + q.len, 0);
    // the run's free ends: end keys used once
    const count = new Map<string, number>();
    for (const q of qs) for (const e of q.ends) count.set(e, (count.get(e) ?? 0) + 1);
    const free = [...count].filter(([, n]) => n === 1).map(([e]) => { const [a, b] = e.split("|").map((s) => s.split(":").map(Number)); return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 }; });
    return { len, qs, free, ux: qs[0].ux, uz: qs[0].uz };
  });
}

// ---------------------------------------------------------------- the symbols' painted shapes
/** A symbol's triangles rasterised on its cell's texels (1 = paint). */
export function raster(tris: number[]): Uint8Array {
  const m = new Uint8Array(CELL_W * CELL_H);
  for (let i = 0; i + 5 < tris.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = tris.slice(i, i + 6);
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(CELL_H - 1, Math.ceil(Math.max(ay, by, cy))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(CELL_W - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / det, v = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / det;
        if (u >= 0 && v >= 0 && u + v <= 1) m[y * CELL_W + x] = 1;
      }
  }
  return m;
}
/** Runs of indices where `on(i)` holds, gaps shorter than `merge` bridged: [start, end] inclusive. */
function segments(n: number, on: (i: number) => boolean, merge: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!on(i)) continue;
    const last = out.at(-1);
    if (last && i - last[1] <= merge) last[1] = i; else out.push([i, i]);
  }
  return out;
}
const rowOn = (m: Uint8Array, y: number, x0 = 0, x1 = CELL_W - 1) => { for (let x = x0; x <= x1; x++) if (m[y * CELL_W + x]) return true; return false; };
const colOn = (m: Uint8Array, x: number, y0 = 0, y1 = CELL_H - 1) => { for (let y = y0; y <= y1; y++) if (m[y * CELL_W + x]) return true; return false; };
function runLengths(m: Uint8Array, across: boolean): number[] {
  const out: number[] = [];
  const [n, k] = across ? [CELL_H, CELL_W] : [CELL_W, CELL_H];
  for (let a = 0; a < n; a++) {
    let run = 0;
    for (let b = 0; b <= k; b++) {
      const on = b < k && m[across ? a * CELL_W + b : b * CELL_W + a];
      if (on) run++; else if (run) { out.push(run); run = 0; }
    }
  }
  return out;
}

/** 止まれ: each character's extent across and along the road, and its strokes' widths, metres. */
export function stopGlyphs(m: Uint8Array, [w, len]: [number, number]) {
  const sx = w / CELL_W, sy = len / CELL_H;
  const rows = segments(CELL_H, (y) => rowOn(m, y), 6).filter(([a, b]) => b - a > 10);
  const chars = rows.map(([y0, y1]) => {
    const cols = segments(CELL_W, (x) => colOn(m, x, y0, y1), CELL_W);
    return { across: (cols.at(-1)![1] - cols[0][0] + 1) * sx, along: (y1 - y0 + 1) * sy };
  });
  const painted = rows.length ? (rows.at(-1)![1] - rows[0][0] + 1) * sy : 0;
  return { chars, painted, strokeAcross: median(runLengths(m, true)) * sx, strokeAlong: median(runLengths(m, false)) * sy };
}
/** Speed numerals: each digit's width and length, the gap between them and the whole number's width, metres. */
export function speedGlyphs(m: Uint8Array, [w, len]: [number, number]) {
  const sx = w / CELL_W, sy = len / CELL_H;
  let cols = segments(CELL_W, (x) => colOn(m, x), 3).filter(([a, b]) => b - a > 4);
  if (cols.length === 1) {
    // the digits touch (the font set them wider than their boxes): split at the thinnest column near the middle
    const [a, b] = cols[0], mid = (a + b) / 2, count = (x: number) => { let n = 0; for (let y = 0; y < CELL_H; y++) n += m[y * CELL_W + x]; return n; };
    let at = -1, least = Infinity;
    for (let x = Math.round(mid - (b - a) * 0.08); x <= Math.round(mid + (b - a) * 0.08); x++) { const n = count(x); if (n < least) { least = n; at = x; } }
    if (at > a && at < b) cols = [[a, at], [at + 1, b]];
  }
  const digits = cols.map(([x0, x1]) => { const r = segments(CELL_H, (y) => rowOn(m, y, x0, x1), CELL_H); return { across: (x1 - x0 + 1) * sx, along: r.length ? (r[0][1] - r[0][0] + 1) * sy : 0 }; });
  const gap = cols.length > 1 ? Math.max(0, cols[1][0] - cols[0][1] - 1) * sx : NaN;
  return { digits, gap, total: cols.length ? (cols.at(-1)![1] - cols[0][0] + 1) * sx : 0 };
}
/** The through arrow: painted length, shaft width, head length and width, metres. */
export function arrowGlyph(m: Uint8Array, [w, len]: [number, number]) {
  const sx = w / CELL_W, sy = len / CELL_H;
  const widths: number[] = [];
  for (let y = 0; y < CELL_H; y++) { let n = 0; for (let x = 0; x < CELL_W; x++) n += m[y * CELL_W + x]; widths.push(n * sx); }
  const painted = widths.map((v, y) => (v > 0 ? y : -1)).filter((y) => y >= 0);
  if (!painted.length) return { length: 0, shaft: NaN, head: NaN, headWidth: NaN };
  const y0 = painted[0], y1 = painted.at(-1)!;
  const shaft = median(widths.slice(Math.round((y0 + y1) / 2), y1 + 1).filter((v) => v > 0));
  // the head: from the tip down to the last row wider than the shaft by half again (the head's base)
  let base = y0;
  for (let y = y0; y <= y1; y++) if (widths[y] > shaft * 1.5) base = y;
  const head = (base - y0 + 1) * sy;
  return { length: (y1 - y0 + 1) * sy, shaft, head, headWidth: Math.max(...widths) };
}

// ---------------------------------------------------------------- the pole rig, from its source
export function parseRig(dress: string, streetprops: string): Rig {
  const num = (re: RegExp, s: string, g = 1) => { const m = re.exec(s); return m ? Number(m[g]) : null; };
  let conductors: number[] | null = null;
  const c = /for \(const \[yy, off, r\] of (\[\[[^\n]*?\]\]) as const\)/.exec(dress);
  if (c) try { conductors = (JSON.parse(c[1]) as number[][]).map((t) => t[0]); } catch { conductors = null; }
  const sag = /B\.wire\(M\.cable, add\(add\(A, sideA\)[^\n]*?span \* ([\d.]+) \+ ([\d.]+)/.exec(dress);
  const pole = /case PROP\.POLE:[\s\S]*?tube\([\d.]+, [\d.]+, ([\d.]+), 0, 0, 0\)/.exec(streetprops);
  const lamp = /case PROP\.POLE:[\s\S]*?mat: "lampHousing", tris: box\([^,]+, [^,]+, [^,]+, [^,]+, ([\d.]+)/.exec(streetprops);
  const h = num(/h = ([\d.]+);\s*\n\s*B\.cylinder\(M\.concretePole/, dress);
  const lampDrop = num(/lampAt = add\(top, add\(mul\(arm, [\d.]+\), \[0, (-?[\d.]+), 0\]\)\)/, dress);
  return {
    poleHeight: h, conductors, sag: sag ? [Number(sag[1]), Number(sag[2])] : null,
    nearLamp: h != null && lampDrop != null ? h + lampDrop : null,
    farPoleHeight: pole ? Number(pole[1]) : null, farLamp: lamp ? Number(lamp[1]) : null,
  };
}

function areaIndex(tiles: Tile[], kinds: number[]) {
  const idx = new PolyIndex(24);
  for (const t of tiles) for (const a of t.areas) if (kinds.includes(a.kind)) for (const rings of a.polygons) {
    idx.add(rings.map((r) => { const pts: [number, number][] = []; for (let i = 0; i + 1 < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; }));
  }
  return idx;
}

// ---------------------------------------------------------------- the street furniture of 6h, along minor roads
const BESIDE = 8; // a prop belongs to the road whose centreline is nearest, within this many metres
const STEP = 2; // the centrelines sampled every STEP metres
const NO_STANDARD = "no standard (6h: the photograph)";
/** What stands along the minor roads, per km of road: what the tiles hold (tools/city/pipeline/landscape.mjs and
 * extras.mjs place it), and what they do not. A prop counts for the road whose centreline sample is nearest within
 * BESIDE metres, if that road is minor; trees inside parks and woods are left out. */
export function streetFurniture(tiles: Tile[], edges: Edge[], bbox: Box | null | undefined, footway: { n: number; kerb: number; line: number; neither: number }): Row[] {
  const samples: { x: number; z: number; minor: boolean }[] = [];
  for (const e of edges) {
    const minor = MINOR.has(e.highway) && !e.bridge && !e.tunnel;
    const pts: [number, number][] = [];
    for (let i = 0; i + 2 < e.pts.length; i += 3) pts.push([e.pts[i], e.pts[i + 2]]);
    forEachAlong(pts, STEP, (x: number, z: number) => { samples.push({ x, z, minor }); });
  }
  const km = samples.filter((p) => p.minor && inBox(bbox, p.x, p.z)).length * STEP / 1000;
  const grid = new Grid(16, samples);
  const besideMinor = (x: number, z: number) => {
    let best = Infinity, minor = false;
    for (const p of grid.near(x, z, BESIDE)) { const d = Math.hypot(p.x - x, p.z - z); if (d < best) { best = d; minor = p.minor; } }
    return minor;
  };
  const parks = areaIndex(tiles, [AREA.PARK, AREA.WOOD]), carriageway = areaIndex(tiles, [AREA.CARRIAGEWAY]);
  const all = tiles.flatMap((t) => t.props.filter((p) => inBox(bbox, p.x, p.z)));
  const beside = (kind: number, keep: (p: Tile["props"][number]) => boolean = () => true) => all.filter((p) => p.kind === kind && keep(p) && besideMinor(p.x, p.z));
  const perKm = (n: number) => (km > 0 ? n / km : NaN);
  const rows: Row[] = [];
  const row = (id: string, item: string, measured: string, values: Record<string, number>, verdict: string, unit = "per km") => {
    const v = Object.values(values)[0];
    rows.push({ id, item, standard: NO_STANDARD, source: "-", measured, value: Number.isFinite(v) ? v : null,
      values: Object.fromEntries(Object.entries(values).map(([k, x]) => [k, Number.isFinite(x) ? x : null])), unit, verdict });
  };
  const present = (n: number) => (n ? "present" : "none in the data");

  const trees = beside(PROP.TREE, (p) => !parks.has(p.x, p.z));
  row("street-trees", "Street trees beside minor roads", `${f(perKm(trees.length), 1)} per km (${trees.length} on ${f(km, 1)} km)`, { perKm: perKm(trees.length), count: trees.length, km }, present(trees.length));
  const vending = beside(PROP.VENDING);
  row("vending", "Vending machines beside minor roads", `${f(perKm(vending.length), 1)} per km (${vending.length})`, { perKm: perKm(vending.length), count: vending.length }, present(vending.length));
  const parked = beside(PROP.PARKED), onStreet = parked.filter((p) => carriageway.has(p.x, p.z)).length, allCars = all.filter((p) => p.kind === PROP.PARKED).length;
  row("parked-cars", "Parked cars on minor roads", `${f(perKm(onStreet), 1)} per km on the carriageway (${onStreet}); ${parked.length - onStreet} in car parks beside them; ${allCars} cars in all, all of them placed in mapped car parks`,
    { perKm: perKm(onStreet), onStreet, beside: parked.length - onStreet, total: allCars }, perKm(onStreet) >= 0.1 ? "present" : "none in the data"); // (a stray car-park car on a road piece is not street parking)
  const info = beside(PROP.INFO).length;
  row("sign-posts", "Sign posts (road signs) beside minor roads", `none in the data (no prop kind for a road sign; ${info} map boards, PROP.INFO)`, { perKm: 0, mapBoards: info }, "none in the data");
  const poles = beside(PROP.POLE), cans = poles.filter((p) => p.variant & 1).length;
  const spans: number[][] = [];
  for (const t of tiles) for (let i = 0; i + 3 < t.wires.length; i += 4) {
    const mx = (t.wires[i] + t.wires[i + 2]) / 2, mz = (t.wires[i + 1] + t.wires[i + 3]) / 2;
    if (inBox(bbox, mx, mz) && besideMinor(mx, mz)) spans.push([mx, mz]);
  }
  row("transformers", "Transformers / boxes on poles, minor roads", `${f(perKm(cans), 1)} transformers per km, the far pole model's (${cans} of ${poles.length} poles, ${f(poles.length ? cans / poles.length * 100 : NaN, 0)}%; ${f(spans.length ? cans / spans.length : NaN, 2)} per span); no pole-mounted boxes (no prop kind or variant)`,
    { perKm: perKm(cans), count: cans, poles: poles.length, perPole: poles.length ? cans / poles.length : NaN, perSpan: spans.length ? cans / spans.length : NaN, boxes: 0 }, present(cans));
  const lights = beside(PROP.LIGHT).length;
  row("lamp-arms", "Lamp arms, minor roads", `${f(perKm(poles.length), 1)} per km: one on each utility pole (${poles.length}; ${f(spans.length ? poles.length / spans.length : NaN, 2)} per span), plus ${lights} standalone street or path lights`,
    { perKm: perKm(poles.length), poleLamps: poles.length, perSpan: spans.length ? poles.length / spans.length : NaN, lights, lightsPerKm: perKm(lights) }, present(poles.length + lights));
  const share = (n: number) => (footway.n ? n / footway.n : NaN);
  row("footway", "Footway edge on minor roads: kerb or white line", `kerbed footway ${f(share(footway.kerb) * 100, 1)}%, white line and no kerb ${f(share(footway.line) * 100, 1)}%, neither ${f(share(footway.neither) * 100, 1)}% (${footway.n} road sides, every 10 m)`,
    { kerb: share(footway.kerb), line: share(footway.line), neither: share(footway.neither), sides: footway.n },
    !footway.n ? "no data" : footway.kerb >= footway.line && footway.kerb >= footway.neither ? "mostly kerbed" : footway.line >= footway.neither ? "mostly white line" : "mostly neither", "share of road sides");
  return rows;
}

// ---------------------------------------------------------------- the buildings of 6h, along minor roads
const FRONTING = 10; // a building fronts a minor road if its outline comes within this many metres of the centreline
/** PLATEAU's building use codes (bldg:usage, the 3D city model's Building_usage code list), in the groups 6h needs. */
export const USES = { flats: [412], houses: [411, 415], shopHouses: [413, 414], commercial: [401, 402, 403, 404], public: [421, 422, 431, 441, 451, 452, 453, 454] } as const;
export type Use = keyof typeof USES | "unknown";
/** A building's use group and storey band (low 1-2, mid 3-8, high 9+). Storeys are PLATEAU's where recorded (1-59, as
 * scene/hero/dress.ts takes them), else estimated from the height at 3.1 m a storey as the dressing does. */
export function buildingClass(usage: number, storeys: number, height: number): { use: Use; storeys: number; rise: "low" | "mid" | "high"; estimated: boolean } {
  const use = (Object.keys(USES) as (keyof typeof USES)[]).find((k) => (USES[k] as readonly number[]).includes(usage)) ?? "unknown";
  const recorded = storeys >= 1 && storeys < 60, n = recorded ? storeys : Math.max(1, Math.round((Number.isFinite(height) ? height : 0) / 3.1));
  return { use, storeys: n, rise: n <= 2 ? "low" : n <= 8 ? "mid" : "high", estimated: !recorded };
}

/** What the dressing code gives a building, read from its source (null where the source no longer has that shape):
 * the size under which a building is dressed as a small one (dress.ts `small`), and the wall finishes the near levels
 * draw for small and for bigger buildings, as shares by kind (tile, render, concrete, metal panel, sheet, timber). */
export type BuildingCode = { smallHeight: number | null; smallStoreys: number | null; smallWalls: Record<string, number> | null; bigWalls: Record<string, number> | null };
// (corrugated sheet, a small house's cladding, is not the metal panel of a block of flats)
const finishKind = (name: string) => (/tile/.test(name) ? "tile" : /concrete/.test(name) ? "concrete" : /panel|alumin/.test(name) ? "metal panel" : /sheet/.test(name) ? "sheet" : /stucco|plaster|mortar/.test(name) ? "render" : /cedar|plank|timber/.test(name) ? "timber" : "other");
export function parseBuildingCode(dress: string, materials: string): BuildingCode {
  const small = /const small = b\.height < ([\d.]+) && \(b\.storeys < (\d+)/.exec(dress);
  const names = (list: string) => { const m = new RegExp(`const ${list} = \\[([\\s\\S]*?)\\n\\s*\\];`).exec(materials); return m ? [...m[1].matchAll(/name: "([^"]+)"/g)].map((x) => x[1]) : null; };
  const shares = (ns: string[] | null, w: number[] | null) => {
    if (!ns?.length || (w && w.length !== ns.length)) return null;
    const out: Record<string, number> = {}, sum = w ? w.reduce((s, v) => s + v, 0) : ns.length;
    ns.forEach((n, i) => { const k = finishKind(n); out[k] = (out[k] ?? 0) + (w ? w[i] : 1) / sum; });
    return out;
  };
  const wm = /const wallWeights = \[([^\]]*)\]/.exec(materials), weights = wm ? wm[1].split(",").map(Number) : null;
  return { smallHeight: small ? Number(small[1]) : null, smallStoreys: small ? Number(small[2]) : null, smallWalls: shares(names("walls"), weights), bigWalls: shares(names("bigWalls"), null) };
}

/** The buildings along the minor roads, by use and storeys, and for the mid-rise flats what their street level has: the
 * counts read from the tiles, the features read from the dressing code (scene/hero/dress.ts and materials.ts, the near
 * levels; tools/city/mesh/meshing.js, the far level). A building counts if its centroid is in the box and its outline
 * comes within FRONTING metres of a minor road's centreline (bridges and tunnels left out). */
export function streetBuildings(tiles: Tile[], edges: Edge[], bbox: Box | null | undefined, code: BuildingCode): Row[] {
  const samples: { x: number; z: number; minor: boolean }[] = [];
  for (const e of edges) {
    const minor = MINOR.has(e.highway) && !e.bridge && !e.tunnel;
    const pts: [number, number][] = [];
    for (let i = 0; i + 2 < e.pts.length; i += 3) pts.push([e.pts[i], e.pts[i + 2]]);
    forEachAlong(pts, STEP, (x: number, z: number) => { samples.push({ x, z, minor }); });
  }
  const km = samples.filter((p) => p.minor && inBox(bbox, p.x, p.z)).length * STEP / 1000;
  const grid = new Grid(16, samples);
  const minorNear = (x: number, z: number, r: number) => grid.near(x, z, r).some((p) => p.minor);
  const nearestMinor = (x: number, z: number, r: number) => { let best = Infinity, minor = false; for (const p of grid.near(x, z, r)) { const d = Math.hypot(p.x - x, p.z - z); if (d < best) { best = d; minor = p.minor; } } return minor; };
  type B = { use: Use; rise: string; estimated: boolean; small: boolean; faces: boolean; mapped: number };
  const found: B[] = [];
  for (const t of tiles) for (const b of t.buildings ?? []) {
    const poly = b.polygons.reduce<ArrayLike<number> | null>((best, rings) => (rings[0] && (!best || rings[0].length > best.length) ? rings[0] : best), null);
    if (!poly || poly.length < 6) continue;
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (!inBox(bbox, cx, cz)) continue;
    let fronts = false;
    forEachAlong([...pts, pts[0]], STEP, (x: number, z: number) => { if (!fronts && minorNear(x, z, FRONTING)) fronts = true; });
    if (!fronts) continue;
    const c = buildingClass(b.usage ?? 0, b.storeys, b.height);
    // the longest wall (where the near level puts an apartment's balconies, dress.ts styleOf): does it face the minor road?
    let li = 0, ll = 0;
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > ll) { ll = l; li = i; } });
    const [ax, az] = pts[li], [bx, bz] = pts[(li + 1) % pts.length], mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -(bz - az) / (ll || 1), nz = (bx - ax) / (ll || 1);
    if (insideRing(pts, mx + nx * 0.05, mz + nz * 0.05)) { nx = -nx; nz = -nz; }
    let faces = false;
    for (let d = 1; d <= FRONTING + 2 && !faces; d++) { const x = mx + nx * d, z = mz + nz * d; if (grid.near(x, z, 2.5).length) { faces = nearestMinor(x, z, 2.5); break; } }
    const small = code.smallHeight != null && code.smallStoreys != null && b.height < code.smallHeight && (b.storeys < code.smallStoreys || b.storeys === 255);
    found.push({ use: c.use, rise: c.rise, estimated: c.estimated, small, faces, mapped: ((b.hint ?? 0) >>> 24) & 15 });
  }
  const rows: Row[] = [];
  const row = (id: string, item: string, measured: string, values: Record<string, number>, verdict: string, unit: string, source = "-") => {
    const v = Object.values(values)[0];
    rows.push({ id, item, standard: NO_STANDARD, source, measured, value: Number.isFinite(v) ? v : null,
      values: Object.fromEntries(Object.entries(values).map(([k, x]) => [k, Number.isFinite(x) ? x : null])), unit, verdict });
  };
  const n = found.length, pc = (k: number, of = n) => f(of ? (k / of) * 100 : NaN, 0) + "%";
  const by = (use: Use) => found.filter((b) => b.use === use).length;
  const uses: [Use, string][] = [["flats", "flats (412 共同住宅)"], ["houses", "houses (411, 415)"], ["shopHouses", "shops with homes (413, 414)"], ["commercial", "commercial (401-404)"], ["public", "public and other (421-454)"], ["unknown", "unknown (461 or none)"]];
  row("bldg-use", "Buildings fronting minor roads, by use", `${n} buildings (${f(km > 0 ? n / km : NaN, 1)} per km): ${uses.map(([k, s]) => `${s} ${by(k)} (${pc(by(k))})`).join(", ")}`,
    { count: n, perKm: km > 0 ? n / km : NaN, ...Object.fromEntries(uses.map(([k]) => [k, by(k)])) }, n ? "measured" : "no data", "count", "PLATEAU bldg:usage (Building_usage code list)");
  const rise = (r: string, list = found) => list.filter((b) => b.rise === r).length, est = found.filter((b) => b.estimated).length;
  row("bldg-storeys", "Buildings fronting minor roads, by storeys", `low 1-2: ${rise("low")} (${pc(rise("low"))}), mid 3-8: ${rise("mid")} (${pc(rise("mid"))}), high 9+: ${rise("high")} (${pc(rise("high"))}); ${est} with storeys estimated from the height`,
    { low: rise("low"), mid: rise("mid"), high: rise("high"), estimated: est }, n ? "measured" : "no data", "count", "PLATEAU bldg:storeysAboveGround");
  const flats = found.filter((b) => b.use === "flats" && b.rise === "mid"), m = flats.length;
  const small = flats.filter((b) => b.small).length, faces = flats.filter((b) => b.faces).length, bigFacing = flats.filter((b) => !b.small && b.faces).length;
  const smallRule = code.smallHeight != null ? `under ${code.smallHeight} m and ${code.smallStoreys} storeys` : "(the small-building rule was not found in scene/hero/dress.ts)";
  row("bldg-mid-flats", "Mid-rise flats (412, 3-8 storeys) fronting minor roads", `${m} (${pc(m)} of the buildings, ${f(km > 0 ? m / km : NaN, 1)} per km); ${small} of them ${smallRule}, dressed at street level (L0, within 140 m) as a small building (dress.ts:219, 286: dressSmall's bar units, no balconies) and further off (L1) as a mid one; the longest wall faces the minor road on ${faces} (${pc(faces, m)})`,
    { count: m, share: n ? m / n : NaN, perKm: km > 0 ? m / km : NaN, small, longestFaces: faces }, m ? "measured" : "no data", "count");
  row("bldg-balconies", "Balconies on the mid-rise flats", `on ${bigFacing} of ${m} (${pc(bigFacing, m)}) toward the minor road at street level (L0), on ${faces} (${pc(faces, m)}) at L1: the near levels put them on the longest wall only (dress.ts:1062), a 1.1 m slab with a frosted panel, aluminium bars or a solid parapet by building (dress.ts:1203-1211), an outdoor unit on 60% of the bays (dress.ts:1217); none on the ${small} dressed small at L0 (they have them at L1 and lose them nearer); far level 1.05 m deep, solid plaster front, no glass or units (meshing.js:547-566)`,
    { towardRoad: m ? bigFacing / m : NaN, towardRoadL1: m ? faces / m : NaN, flats: m, small }, !m ? "no data" : bigFacing / m >= 0.5 ? "present" : "partial", "share of the mid-rise flats");
  row("bldg-shutters", "Ground-floor shutters on the mid-rise flats", `none in the code for flats: their ground floor is a door (dress.ts:1339-1343); shutters only on shop and office ground floors (20% of bays, dress.ts:1307-1309) and on 6% of a small building's units (dress.ts:724), so on the ${small} flats dressed small, as a bar's store room`,
    { flats: m, small }, "none in the code", "count");
  row("bldg-garage", "Garage doors on the mid-rise flats", "none in the code (no garage or car-port opening in scene/hero or tools/city/mesh; the one roll-up door is the shop shutter, materials.ts:124-125)", { flats: m }, "none in the code", "count");
  row("bldg-lobby", "Lobbies / entrances of the mid-rise flats", "none in the code for flats: one timber door 0.85 x 2.0 m on each open wall (dress.ts:1341-1343; no glass entrance, canopy or letterboxes); a glass lobby only on office and shop towers of 45 m and 10 storeys (dress.ts:1067, 1287-1301)",
    { flats: m }, "none in the code", "count");
  const share = (s: Record<string, number> | null, k: string) => (s ? s[k] ?? 0 : NaN);
  const mix = (k: string) => (m ? (small * share(code.smallWalls, k) + (m - small) * share(code.bigWalls, k)) / m : NaN);
  const mapped = flats.filter((b) => b.mapped).length;
  const kinds = ["tile", "render", "concrete", "metal panel", "sheet", "timber"];
  row("bldg-facade", "Facade finish of the mid-rise flats (tile / concrete / metal panel)", `expected over the ${m}: ${kinds.map((k) => `${k} ${f(mix(k) * 100, 0)}%`).join(", ")} (near level: bigger buildings draw one of materials.ts:83-94 alike, small ones materials.ts:63-81 by weight); ${mapped} with a material mapped in OSM; far level: tile, brick or plaster, no concrete or metal (meshing.js:217-220)`,
    { ...Object.fromEntries(kinds.map((k) => [k.replace(" panel", "Panel"), mix(k)])), mapped, flats: m }, !m || !code.bigWalls ? "no data" : mix("metal panel") > 0 ? "present" : "no metal panel", "share of the mid-rise flats");
  return rows;
}
function insideRing(pts: [number, number][], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- the audit
export function audit(input: Input): Report {
  const { tiles, edges, signals, rig, shapes, cell, bbox, code } = input;
  const rows: Row[] = [];
  const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);
  const row = (id: string, item: string, standard: string, measured: string, value: number | null, verdict: string, source: string, values: Record<string, number | null | undefined>, unit: string) =>
    rows.push({ id, item, standard, source, measured, value, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, num(v)])), unit, verdict });
  const within = (v: number, lo: number, hi: number, tol = 0.005) => (!Number.isFinite(v) ? "no data" : v < lo - tol ? "under" : v > hi + tol ? "over" : "ok");

  // paint
  const quads = paintQuads(tiles, bbox);
  const lines = quads.filter(isLine), bars = quads.filter(isBar);
  const barGrid = new Grid(4, bars);
  const parallel = (a: Quad, b: Quad, cos = 0.98) => Math.abs(a.ux * b.ux + a.uz * b.uz) > cos;
  // zebra bars: 2.5-5 m long, with a parallel bar of the same length beside them at under 1.4 m
  const pitchOf = new Map<Quad, number>();
  for (const q of bars) {
    if (q.len < 2.5 || q.len > 5) continue;
    let best = Infinity;
    for (const o of barGrid.near(q.x, q.z, 1.4)) {
      if (o === q || !parallel(q, o) || Math.abs(o.len - q.len) > 0.3) continue;
      const along = Math.abs((o.x - q.x) * q.ux + (o.z - q.z) * q.uz);
      if (along < 0.3) best = Math.min(best, Math.hypot(o.x - q.x, o.z - q.z));
    }
    if (best < Infinity) pitchOf.set(q, best);
  }
  const zebra = [...pitchOf.keys()], stopLines = bars.filter((q) => !pitchOf.has(q) && q.len >= 1);
  // crossings: zebra bars grouped by neighbours
  const zGrid = new Grid(4, zebra), seen = new Set<Quad>(), crossings: { x: number; z: number; n: number }[] = [];
  for (const q of zebra) {
    if (seen.has(q)) continue;
    const group = [q]; seen.add(q);
    for (let i = 0; i < group.length; i++) for (const o of zGrid.near(group[i].x, group[i].z, 1.4)) if (!seen.has(o) && pitchOf.has(o)) { seen.add(o); group.push(o); }
    if (group.length >= 3) crossings.push({ x: group.reduce((s, g) => s + g.x, 0) / group.length, z: group.reduce((s, g) => s + g.z, 0) / group.length, n: group.length });
  }
  const sigGrid = new Grid(16, signals.map(([x, z]) => ({ x, z })));
  const unsignalled = crossings.filter((c) => !sigGrid.near(c.x, c.z, 30).length).length;

  const lw = median(lines.map((q) => q.wid));
  row("lane-width", "Lane line width (102)", "0.10-0.15 m (標識令 別表第四; 規制基準 p.94 市街地)", `${f(lw)} m median of ${lines.length} line pieces`, lw, within(lw, 0.1, 0.15),
    "標識令 別表第四; 規制基準 p.94", { median: lw, pieces: lines.length }, "m");
  const runs = chains(lines), dashes = runs.filter((r) => r.len <= 8);
  const dashGrid = new Grid(8, dashes.flatMap((r) => r.free.map((p) => ({ ...p, r }))));
  const gaps: number[] = [];
  for (const r of dashes) {
    let best = Infinity;
    for (const p of r.free) for (const o of dashGrid.near(p.x, p.z, 15)) {
      if (o.r === r || Math.abs(o.r.ux * r.ux + o.r.uz * r.uz) < 0.97) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z), lat = Math.abs((o.x - p.x) * -r.uz + (o.z - p.z) * r.ux);
      if (d > 1 && lat < 0.15) best = Math.min(best, d);
    }
    if (best < Infinity) gaps.push(best);
  }
  const dl = median(dashes.map((r) => r.len)), dg = median(gaps);
  row("dash", "Lane line dash / gap", "6 m line, 9 m gap urban (規制基準 p.94); 標識令 allows l1 3-10 m, l2 (1-2) l1", `${f(dl, 1)} m / ${f(dg, 1)} m (median of ${dashes.length} dashes)`, dl,
    !Number.isFinite(dl) ? "no data" : Math.abs(dl - 6) < 0.5 && Math.abs(dg - 9) < 0.5 ? "ok" : dl >= 3 && dl <= 10 && dg >= dl * 0.95 && dg <= dl * 2.05 ? "within 標識令, not the urban standard" : "outside 標識令",
    "規制基準 p.94; 標識令", { dash: dl, gap: dg, dashes: dashes.length }, "m");

  // stop lines, with 止まれ's (within 8 m of a STOP symbol) apart
  const decals = tiles.flatMap((t) => t.props.filter((p) => p.kind === PROP.DECAL && inBox(bbox, p.x, p.z)));
  const stopText = new Grid(8, decals.filter((p) => p.variant === DECAL.STOP));
  const sw = median(stopLines.map((q) => q.wid)), swStop = median(stopLines.filter((q) => stopText.near(q.x, q.z, 8).length).map((q) => q.wid));
  row("stop-line", "Stop line width (203)", "0.30-0.45 m (標識令 別表第六)", `${f(sw)} m median of ${stopLines.length}; at 止まれ ${f(swStop)} m`, sw, within(sw, 0.3, 0.45),
    "標識令 別表第六", { median: sw, atStop: swStop, lines: stopLines.length }, "m");
  const zw = median(zebra.map((q) => q.wid)), zg = median(zebra.map((q) => pitchOf.get(q)! - q.wid)), zl = median(zebra.map((q) => q.len));
  row("zebra-bars", "Zebra bar width / gap (201)", "bar 0.45-0.50 m, gap 0.45-0.90 m (標識令 別表第六)", `${f(zw)} m / ${f(zg)} m (${zebra.length} bars, ${crossings.length} crossings)`, zw, within(zw, 0.45, 0.5) === "ok" && within(zg, 0.45, 0.9) === "ok" ? "ok" : "off",
    "標識令 別表第六", { bar: zw, gap: zg, bars: zebra.length, crossings: crossings.length }, "m");
  row("zebra-width", "Zebra crossing width (bar length)", ">= 4 m in principle, 3 m minimum (規制基準 p.77)", `${f(zl)} m`, zl, !Number.isFinite(zl) ? "no data" : zl >= 3.995 ? "ok" : zl >= 2.995 ? "short of 4 m" : "under 3 m",
    "規制基準 p.77", { length: zl }, "m");

  // edge line / 路側帯 line by road class and measured width
  const carriageway = new PolyIndex(24);
  for (const t of tiles) for (const a of t.areas) if (a.kind === AREA.CARRIAGEWAY) for (const rings of a.polygons) {
    carriageway.add(rings.map((r) => { const pts: [number, number][] = []; for (let i = 0; i + 1 < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; }));
  }
  const lineGrid = new Grid(8, lines);
  // the raised footways (SIDEWALK areas: the mesher stands them on a kerb, tools/city/mesh/meshing.js)
  const sidewalk = areaIndex(tiles, [AREA.SIDEWALK]);
  const footway = { n: 0, kerb: 0, line: 0, neither: 0 };
  const reach = (x: number, z: number, nx: number, nz: number, s: number) => { for (let d = 0.25; d <= 18; d += 0.25) if (!carriageway.has(x + nx * d * s, z + nz * d * s)) return d; return null; };
  const tally = new Map<string, { n: number; any: number; both: number }>();
  for (const e of edges) {
    const hw = e.highway;
    const cls = MINOR.has(hw) ? "minor" : MAJOR.has(hw) ? "major" : null;
    if (!cls || e.bridge || e.tunnel) continue;
    const pts: [number, number][] = [];
    for (let i = 0; i + 2 < e.pts.length; i += 3) pts.push([e.pts[i], e.pts[i + 2]]);
    forEachAlong(pts, 10, (x: number, z: number, dx: number, dz: number) => {
      if (!inBox(bbox, x, z) || !carriageway.has(x, z)) return;
      const nx = -dz, nz = dx, R = reach(x, z, nx, nz, 1), L = reach(x, z, nx, nz, -1);
      if (R == null || L == null) return;
      const w = R + L, cx = x + nx * (R - L) / 2, cz = z + nz * (R - L) / 2;
      if (w < 2.5) return;
      const sides = new Set<number>();
      for (const q of lineGrid.near(cx, cz, 7)) {
        if (Math.abs(q.ux * dx + q.uz * dz) < 0.96) continue;
        const t = (q.x - cx) * dx + (q.z - cz) * dz, o = (q.x - cx) * nx + (q.z - cz) * nz;
        if (Math.abs(t) <= 5.5 && Math.abs(o) >= Math.max(0.6, w / 2 - 2) && Math.abs(o) <= w / 2 + 0.3) sides.add(Math.sign(o));
      }
      if (cls === "minor") for (const side of [1, -1]) {
        const d = side === 1 ? R : L, kerb = sidewalk.has(x + nx * (d + 0.6) * side, z + nz * (d + 0.6) * side);
        footway.n++;
        if (kerb) footway.kerb++; else if (sides.has(side)) footway.line++; else footway.neither++;
      }
      const bucket = WIDTHS.find(([a, b]) => w >= a && w < b)![2], key = cls + "|" + bucket;
      const s = tally.get(key) ?? { n: 0, any: 0, both: 0 };
      s.n++; if (sides.size) s.any++; if (sides.size === 2) s.both++;
      tally.set(key, s);
    });
  }
  const edgeLines = [...tally].map(([k, s]) => { const [cls, width] = k.split("|"); return { cls, width, km: s.n * 10 / 1000, anySide: s.any / s.n, bothSides: s.both / s.n }; })
    .sort((a, b) => a.cls.localeCompare(b.cls) || WIDTHS.findIndex((w) => w[2] === a.width) - WIDTHS.findIndex((w) => w[2] === b.width));
  const minor = [...tally].filter(([k]) => k.startsWith("minor|")).reduce((s, [, v]) => ({ n: s.n + v.n, any: s.any + v.any }), { n: 0, any: 0 });
  const minorShare = minor.n ? minor.any / minor.n : NaN;
  row("rosoku", "路側帯 / edge line on minor roads (108 / 103)", "solid white 0.15-0.20 m, strip >= 0.5 m (標識令 別表第六; 規制基準 p.73)", `${f(minorShare * 100, 1)}% of ${f(minor.n * 10 / 1000, 1)} km sampled carry one`, minorShare,
    !Number.isFinite(minorShare) ? "no data" : minorShare < 0.05 ? "missing" : minorShare < 0.5 ? "partial" : "present",
    "標識令 別表第六; 規制基準 p.73", { share: minorShare, km: minor.n * 10 / 1000 }, "share of the km sampled");

  // symbols
  const names = Object.fromEntries(Object.entries(DECAL as Record<string, number>).map(([k, v]) => [v, k]));
  const decalCount: Record<string, number> = {};
  for (const p of decals) { const n = names[p.variant] ?? `variant ${p.variant}`; decalCount[n] = (decalCount[n] ?? 0) + 1; }
  const variantsLike = (re: RegExp) => Object.entries(DECAL as Record<string, number>).filter(([k]) => re.test(k)).map(([, v]) => v);
  const diamond = variantsLike(/DIAMOND|CROSSING_AHEAD|DIA/), yabane = variantsLike(/YABANE|CHEVRON|CYCLE|BIKE/);
  const nDiamond = decals.filter((p) => diamond.includes(p.variant)).length, nYabane = decals.filter((p) => yabane.includes(p.variant)).length;
  row("diamond", "◇ crossing-ahead marks (210)", "1.5 m wide; about 30 m before an unsignalled crossing, 1-2 more at 10-20 m (規制基準 p.79)",
    `${nDiamond}${diamond.length ? "" : " (no DECAL variant)"}; ${unsignalled} of ${crossings.length} crossings unsignalled (>= ${unsignalled * 2} expected)`, nDiamond, nDiamond >= unsignalled * 2 && unsignalled > 0 ? "ok" : nDiamond ? "partial" : "missing",
    "規制基準 p.79", { marks: nDiamond, unsignalled, crossings: crossings.length }, "count");
  row("yabane", "Cycle 矢羽根 marks", "0.75 m wide, >= 1.5 m long, every 10 m (自転車GL p.II-6-7)", `${nYabane}${yabane.length ? "" : " (no DECAL variant)"}`, nYabane, nYabane ? "present" : "missing",
    "自転車GL p.II-6-7", { marks: nYabane }, "count");

  if (shapes) {
    const stop = shapes.get(DECAL.STOP), speed = shapes.get(DECAL.SPEED_30), arrow = shapes.get(DECAL.THROUGH);
    if (stop) {
      const g = stopGlyphs(raster(stop.tris), cell(DECAL.STOP)), across = median(g.chars.map((c) => c.across)), along = median(g.chars.map((c) => c.along));
      row("stop-text", "止まれ character (法定外表示)", "2.4 m along x 0.8 m across, 3:1 (規制基準 p.149 図例(1))", `${f(along)} m along x ${f(across)} m across, ${f(along / across)}:1 (${g.chars.length} characters)`, along / across,
        Math.abs(along / across - 3) < 0.3 ? "ok" : "aspect off", "規制基準 p.149 図例(1)", { along, across, aspect: along / across, characters: g.chars.length }, "m");
      row("stop-strokes", "止まれ strokes", "0.15 m across, 0.30 m along (規制基準 p.149)", `about ${f(g.strokeAcross)} m across, ${f(g.strokeAlong)} m along (median runs)`, g.strokeAcross, Math.abs(g.strokeAcross - 0.15) < 0.04 && Math.abs(g.strokeAlong - 0.3) < 0.06 ? "ok" : "off",
        "規制基準 p.149", { across: g.strokeAcross, along: g.strokeAlong }, "m");
      row("stop-length", "止まれ painted length", ">= 7.2 m (3 x 2.4 m)", `${f(g.painted)} m`, g.painted, g.painted >= 7.195 ? "ok" : "short", "規制基準 p.149", { length: g.painted }, "m");
    }
    if (speed) {
      const g = speedGlyphs(raster(speed.tris), cell(DECAL.SPEED_30)), d = g.digits[0];
      row("speed-digit", "Speed numeral digit (105)", "0.5 m wide x 5 m long, 0.2 m apart; \"30\" 1.2 m wide (標識令 別表第六)",
        d ? `${f(d.across)} x ${f(d.along)} m, ${f(g.gap)} m apart; "30" ${f(g.total)} m wide (${f(d.across / 0.5)}x)` : "no digits found", d ? d.across : null, d && Math.abs(d.across - 0.5) < 0.08 && Math.abs(d.along - 5) < 0.3 ? "ok" : "off",
        "標識令 別表第六", { width: d?.across, length: d?.along, gap: g.gap, total: g.total }, "m");
    }
    if (arrow) {
      const g = arrowGlyph(raster(arrow.tris), cell(DECAL.THROUGH));
      row("arrow", "Through arrow (204 / 110)", "5 m long, shaft 0.15 m, head 2.5 m long (標識令 別表第六)", `${f(g.length)} m long, shaft ${f(g.shaft)} m, head ${f(g.head)} m long x ${f(g.headWidth)} m wide`, g.head,
        Math.abs(g.head - 2.5) < 0.2 && Math.abs(g.length - 5) < 0.3 ? "ok" : "head short",
        "標識令 別表第六", { length: g.length, shaft: g.shaft, head: g.head, headWidth: g.headWidth }, "m");
    }
  } else row("glyphs", "Symbol shapes", "-", "not read (the decal atlas could not be drawn: needs sharp and its fonts)", null, "no data", "-", {}, "-");

  // poles and spans
  const poles = tiles.flatMap((t) => t.props.filter((p) => p.kind === PROP.POLE && inBox(bbox, p.x, p.z)));
  const poleGrid = new Grid(16, poles), nn: number[] = [];
  for (const p of poles) { let best = Infinity; for (const o of poleGrid.near(p.x, p.z, 80)) if (o !== p) best = Math.min(best, Math.hypot(o.x - p.x, o.z - p.z)); if (best < Infinity) nn.push(best); }
  const spans: number[] = [];
  for (const t of tiles) for (let i = 0; i + 3 < t.wires.length; i += 4) if (inBox(bbox, t.wires[i], t.wires[i + 1])) spans.push(Math.hypot(t.wires[i + 2] - t.wires[i], t.wires[i + 3] - t.wires[i + 1]));
  const ms = median(spans);
  row("pole-spacing", "Pole spacing (span length)", "about 30 m (ROADMAP 6h; no public standard found)", `spans p10 ${f(pct(spans, 0.1), 1)} / median ${f(ms, 1)} / p90 ${f(pct(spans, 0.9), 1)} m (${spans.length} spans, ${poles.length} poles; nearest pole median ${f(median(nn), 1)} m)`, ms,
    !Number.isFinite(ms) ? "no data" : Math.abs(ms - 30) <= 5 ? "ok" : "off",
    "ROADMAP 6h", { p10: pct(spans, 0.1), median: ms, p90: pct(spans, 0.9), spans: spans.length, poles: poles.length, nearestPole: median(nn) }, "m");
  const spacing: { bin: string; n: number }[] = [];
  for (let b = 0; b < 60; b += 5) spacing.push({ bin: `${b}-${b + 5} m`, n: spans.filter((s) => s >= b && s < b + 5).length });

  if (rig.poleHeight != null && rig.conductors) {
    const at = rig.conductors.map((yy) => rig.poleHeight! + yy).sort((a, b) => b - a), sag = rig.sag ? rig.sag[0] * (Number.isFinite(ms) ? ms : 30) + rig.sag[1] : 0;
    const low = Math.min(...at) - sag;
    row("cable-band", "Cable heights (near rig)", "telecom >= 5 m over a road, >= 2.5 m over a separated footway (有線電気通信設備令施行規則 第7条1号)",
      `${[...new Set(at.map((h) => f(h, 2)))].join(" / ")} m at the pole; lowest ${f(low, 2)} m at mid-span (sag ${f(sag, 2)} m on ${f(Number.isFinite(ms) ? ms : 30, 1)} m)`, low, low > 7 ? "top band only" : low >= 5 ? "ok" : "below 5 m",
      "有線電気通信設備令施行規則 第7条1号", { top: Math.max(...at), lowestAtPole: Math.min(...at), lowestMidSpan: low, sag }, "m");
    row("cable-count", "Cables per span (near rig)", "\"a dozen\" (ROADMAP 6h; no standard)", `${rig.conductors.length}`, rig.conductors.length, rig.conductors.length >= 10 ? "ok" : "fewer", "ROADMAP 6h", { cables: rig.conductors.length }, "count");
  } else row("cable-band", "Cable heights (near rig)", "telecom >= 5 m over a road", "rig not found in scene/hero/dress.ts (the parser needs updating)", null, "no data", "有線電気通信設備令施行規則 第7条1号", {}, "m");
  if (rig.poleHeight != null || rig.farPoleHeight != null)
    row("pole-height", "Pole height near / far, lamp near / far", "about 12 m shared poles (NTT East, secondary); near and far should agree",
      `${f(rig.poleHeight ?? NaN, 2)} / ${f(rig.farPoleHeight ?? NaN, 2)} m; lamp ${f(rig.nearLamp ?? NaN, 2)} / ${f(rig.farLamp ?? NaN, 2)} m`, rig.poleHeight,
      rig.poleHeight != null && rig.farPoleHeight != null && Math.abs(rig.poleHeight - rig.farPoleHeight) < 0.3 && rig.nearLamp != null && rig.farLamp != null && Math.abs(rig.nearLamp - rig.farLamp) < 0.3 ? "ok" : "near and far differ",
      "NTT East", { near: rig.poleHeight, far: rig.farPoleHeight, nearLamp: rig.nearLamp, farLamp: rig.farLamp }, "m");
  const furniture = streetFurniture(tiles, edges, bbox, footway);
  const buildings = code ? streetBuildings(tiles, edges, bbox, code) : undefined;
  return { rows, furniture, ...(buildings ? { buildings } : {}), edgeLines, spacing, decals: decalCount };
}

export function formatReport(r: Report, title: string): string {
  const out = [`# Street audit: ${title}`, "", "| Item | Standard (source) | Measured | Verdict |", "|---|---|---|---|"];
  for (const x of r.rows) out.push(`| ${x.item} | ${x.standard} | ${x.measured} | ${x.verdict} |`);
  out.push("", "Edge or 路側帯 line beside the carriageway, by road class and measured width (samples every 10 m):", "", "| Class | Width | km | Line on a side | Both sides |", "|---|---|---|---|---|");
  for (const e of r.edgeLines) out.push(`| ${e.cls} | ${e.width} | ${f(e.km, 1)} | ${f(e.anySide * 100, 1)}% | ${f(e.bothSides * 100, 1)}% |`);
  out.push("", "Span lengths between poles:", "", "| Span | Count |", "|---|---|");
  for (const s of r.spacing) if (s.n) out.push(`| ${s.bin} | ${s.n} |`);
  out.push("", `Road symbols: ${Object.entries(r.decals).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  if (r.furniture?.length) {
    out.push("", `The street furniture of ROADMAP 6h along minor roads (a prop counts for the nearest road centreline within ${BESIDE} m):`, "", "| Item | Standard (source) | Measured | Verdict |", "|---|---|---|---|");
    for (const x of r.furniture) out.push(`| ${x.item} | ${x.standard} | ${x.measured} | ${x.verdict} |`);
  }
  if (r.buildings?.length) {
    out.push("", `The buildings of ROADMAP 6h along minor roads (outline within ${FRONTING} m of the centreline; counts from the tiles, features from the dressing code):`, "", "| Item | Standard (source) | Measured | Verdict |", "|---|---|---|---|");
    for (const x of r.buildings) out.push(`| ${x.item} | ${x.standard} | ${x.measured} | ${x.verdict} |`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- before / after
/** A report as --json writes it (rows, furniture and buildings, or rows alone). */
export type ReportJson = { rows: Row[]; furniture?: Row[]; buildings?: Row[] };
const WITHIN = new Set(["ok", "present"]);
const g = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))));
/** The rows whose measured values (to four significant figures, as shown) or verdict changed between two reports, as a
 * Markdown table, and a count. "Within standard" is an "ok" or "present" verdict. */
export function diffReports(before: ReportJson, after: ReportJson): string {
  const all = (r: ReportJson) => [...r.rows, ...(r.furniture ?? []), ...(r.buildings ?? [])];
  const was = new Map(all(before).map((r) => [r.id, r])), now = new Map(all(after).map((r) => [r.id, r]));
  const ids = [...now.keys(), ...[...was.keys()].filter((k) => !now.has(k))];
  const lines: string[] = [];
  let changed = 0, nowWithin = 0, noLonger = 0;
  for (const id of ids) {
    const a = was.get(id), b = now.get(id);
    const keys = [...new Set([...Object.keys(a?.values ?? {}), ...Object.keys(b?.values ?? {})])];
    const moved = keys.filter((k) => g(a?.values?.[k]) !== g(b?.values?.[k]));
    if (a && b && !moved.length && a.verdict === b.verdict) continue;
    changed++;
    const okA = !!a && WITHIN.has(a.verdict), okB = !!b && WITHIN.has(b.verdict);
    if (!okA && okB) nowWithin++;
    if (okA && !okB) noLonger++;
    const values = !a ? "(new row)" : !b ? "(row gone)" : !moved.length ? "-"
      : moved.map((k) => `${k} ${g(a.values[k])} -> ${g(b.values[k])}`).join("; ");
    const verdict = a?.verdict === b?.verdict ? `${b!.verdict} (same)` : `${a?.verdict ?? "-"} -> ${b?.verdict ?? "-"}`;
    lines.push(`| ${(b ?? a)!.item} | ${values} | ${(b ?? a)!.unit} | ${b?.measured ?? "-"} | ${verdict} |`);
  }
  const count = `${changed} of ${ids.length} rows changed, ${nowWithin} now within standard${noLonger ? `, ${noLonger} no longer` : ""}`;
  if (!changed) return count;
  return ["| Item | Before -> after | Unit (lengths) | Measured after | Verdict |", "|---|---|---|---|---|", ...lines, "", count].join("\n");
}

// ---------------------------------------------------------------- command line
async function main() {
  const argv = process.argv;
  const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const at = argv.indexOf("--diff");
  if (at >= 0) {
    const [a, b] = argv.slice(at + 1, at + 3);
    if (!a || !b) { console.log("usage: street-audit.ts --diff before.json after.json"); return; }
    console.log(diffReports(JSON.parse(readFileSync(a, "utf8")), JSON.parse(readFileSync(b, "utf8"))));
    return;
  }
  // --json <file> (or --json=<file>) writes the report as data beside the Markdown; a bare --json prints it instead
  const j = argv.indexOf("--json"), next = j >= 0 ? argv[j + 1] : undefined;
  const jsonFile = arg("json") ?? (next && !next.startsWith("--") ? next : undefined);
  const area = arg("area") ?? "shinjuku", dir = resolve(arg("tiles") ?? join(repoRoot, "assets/city/tiles", area));
  const bb = arg("bbox")?.split(",").map(Number), bbox: Box | null = bb?.length === 4 ? { minX: bb[0], minZ: bb[1], maxX: bb[2], maxZ: bb[3] } : null;
  if (!existsSync(dir)) { console.log(`no compiled tiles at ${dir} (compile the area with tools/city first)`); return; }
  const tiles: Tile[] = readdirSync(dir).filter((n) => /^t_-?\d+_-?\d+\.bin$/.test(n)).map((n) => { const b = readFileSync(join(dir, n)); return decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); });
  const roads = existsSync(join(dir, "roads.json")) ? JSON.parse(readFileSync(join(dir, "roads.json"), "utf8")) as { nodes: number[][]; edges: Edge[]; signals?: number[] } : { nodes: [], edges: [], signals: [] };
  const signals = (roads.signals ?? []).map((i): [number, number] => [roads.nodes[i][0], roads.nodes[i][2]]);
  const src = (p: string) => (existsSync(join(repoRoot, p)) ? readFileSync(join(repoRoot, p), "utf8") : "");
  const rig = parseRig(src("scene/hero/dress.ts"), src("scene/hero/streetprops.ts"));
  const code = parseBuildingCode(src("scene/hero/dress.ts"), src("scene/hero/materials.ts"));
  let shapes: Input["shapes"] = null;
  try { shapes = await (await import("./decals.ts")).decalShapes(); } catch { shapes = null; }
  // the symbol's cell as the mesher lays it: one symbol, heading +z, on flat ground
  const cell = (variant: number): [number, number] => {
    const m = decalMesh([{ kind: PROP.DECAL, variant, rot: 0, x: 0, z: 0, scale: 1 }], { height: () => 0, triangle: (a: number[], b: number[], c: number[], emit: (...v: number[][]) => void) => emit(a, b, c) });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < m.position.length; i += 3) { x0 = Math.min(x0, m.position[i]); x1 = Math.max(x1, m.position[i]); z0 = Math.min(z0, m.position[i + 2]); z1 = Math.max(z1, m.position[i + 2]); }
    return [x1 - x0, z1 - z0];
  };
  const report = audit({ tiles, edges: roads.edges, signals, rig, shapes, cell, bbox, code });
  const data = JSON.stringify({ area, bbox, tiles: tiles.length, ...report }, null, 1);
  if (jsonFile) writeFileSync(jsonFile, data + "\n");
  if (j >= 0 && !jsonFile) console.log(data);
  else console.log(formatReport(report, `${area}${bbox ? ` [${bb!.join(", ")}]` : ""}, ${tiles.length} tiles`));
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename))
  main().catch((e) => console.log(`street audit failed: ${e instanceof Error ? e.message : e}`)).finally(() => { process.exitCode = 0; });
