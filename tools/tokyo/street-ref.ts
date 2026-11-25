// Candidate poses for ROADMAP 6h's `street-ref` (the ordinary street, judged beside a photograph): the compiled area's
// minor roads read for the street the photograph shows, and ranked. A stretch scores on its own form, measured from the
// tiles: a two-lane carriageway (5-7 m), no kerbed footway beside it (a 路側帯 strip or nothing), utility poles along it
// about every 30 m, buildings of 3-7 storeys close on both sides, straight for 60 m or more, few towers at the end of
// the view; and on the late-afternoon sun: the clock's sun (the engine's own solar position, `sunAt` in
// engine/games/tokyo/tokyo-tod.game.ts, NOAA's approximations) 20-60 degrees off the street's axis, so that it rakes
// along one side, with the camera looking away from it, and how much of the lit side's facades the other side leaves
// in the sun. It reads the tiles and changes nothing.
//   node tools/tokyo/street-ref.ts [N] [--area=shinjuku] [--hour=15.5] [--date=2026-11-09] [--tiles=<dir>] [--json]
// Poses are in the city's frame (Shinjuku's: metres east, up, south), as tools/quality.ts POSES has them, the eye
// 1.7 m over the road. The sun's azimuth is given as `DirectionalLight.setSunAngles` takes it (from the south, +z,
// towards the east, +x) and as a compass bearing.
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { AREA, PROP, decodeTile } from "../city/shared/tileformat.js";
import { makeProjection } from "../city/shared/geo.js";
import { PolyIndex, inRings } from "../city/pipeline/landscape.mjs";
import { paintQuads, type Tile as AuditTile } from "./street-audit.ts";

type V3 = [number, number, number];
export type Building = { storeys: number; base: number; height: number; polygons: ArrayLike<number>[][] };
export type Tile = AuditTile & { buildings: Building[] };
export type Edge = { a: number; b: number; highway: string; lanes?: number | null; name?: string | null; bridge?: number; tunnel?: number; pts: number[] };
/** The sun: elevation and azimuth (degrees, azimuth as `setSunAngles` takes it: from +z towards +x). */
export type Sun = { elevation: number; azimuth: number };
export type Run = { pts: V3[]; len: number; names: string[]; highway: string; lanes: number | null };
export type Measure = {
  len: number; width: number; kerbed: number; rosoku: number; poles: number; poleSpacing: number;
  /** per side (left, right as one walks from the run's first point): share of samples with a building within 12 m of
   *  the carriageway, the mean storeys and height of those, the mean setback */
  sides: { frontage: number; storeys: number; height: number; setback: number }[];
  trees: number; vending: number; parked: number;
};
export type Candidate = {
  pos: V3; target: V3; lat: number; lon: number; names: string[]; highway: string; m: Measure;
  /** the sun against the view: degrees between the street's axis and the sun's bearing, the camera's back to it */
  sunOff: number; litSide: "left" | "right"; litFacade: number; towers: number;
  parts: Record<string, number>; score: number;
};

const MINOR = new Set(["residential", "unclassified", "living_street"]);
const EYE = 1.7;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
/** 1 on [lo, hi], falling linearly to 0 at lo - fall and hi + fall. */
export const band = (v: number, lo: number, hi: number, fall: number) => (!Number.isFinite(v) ? 0 : v < lo ? clamp01(1 - (lo - v) / fall) : v > hi ? clamp01(1 - (v - hi) / fall) : 1);
const toRings = (rings: ArrayLike<number>[]) => rings.map((r) => { const p: [number, number][] = []; for (let i = 0; i + 1 < r.length; i += 2) p.push([r[i], r[i + 1]]); return p; });

// ---------------------------------------------------------------- straight stretches of the minor roads
/** The minor roads' edges joined through their nodes where the way runs on (within 12 degrees), then cut where they
 *  bend (more than 1.5 m off the chord): the straight stretches at least `minLen` long. */
export function straightRuns(edges: Edge[], minLen = 60): Run[] {
  const minor = edges.filter((e) => MINOR.has(e.highway) && !e.bridge && !e.tunnel && e.pts.length >= 6);
  const at = new Map<number, number[]>();
  minor.forEach((e, i) => { for (const n of [e.a, e.b]) { if (!at.has(n)) at.set(n, []); at.get(n)!.push(i); } });
  const pts = (e: Edge): V3[] => { const o: V3[] = []; for (let i = 0; i + 2 < e.pts.length; i += 3) o.push([e.pts[i], e.pts[i + 1], e.pts[i + 2]]); return o; };
  const head = (p: V3[], k: number) => { const a = p[k], b = p[k + 1]; const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[2] - a[2]) / l]; };
  const used = new Set<number>(), out: Run[] = [];
  for (let s = 0; s < minor.length; s++) {
    if (used.has(s)) continue;
    used.add(s);
    let line = pts(minor[s]), endNode = minor[s].b, startNode = minor[s].a;
    const ids = [s];
    // extend at the end, then (reversed) at the start
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        const n = line.length, d = head(line, n - 2);
        let best = -1, bestCos = Math.cos(12 * Math.PI / 180), bestPts: V3[] = [], bestEnd = 0;
        for (const j of at.get(endNode) ?? []) {
          if (used.has(j)) continue;
          const e = minor[j], p = e.a === endNode ? pts(e) : pts(e).reverse();
          const h = head(p, 0), c = h[0] * d[0] + h[1] * d[1];
          if (c > bestCos) { bestCos = c; best = j; bestPts = p; bestEnd = e.a === endNode ? e.b : e.a; }
        }
        if (best < 0) break;
        used.add(best); ids.push(best);
        line = line.concat(bestPts.slice(1)); endNode = bestEnd;
      }
      line.reverse(); [startNode, endNode] = [endNode, startNode];
    }
    const es = ids.map((i) => minor[i]);
    const names = [...new Set(es.map((e) => e.name).filter((v): v is string => !!v))];
    const lanes = es.map((e) => e.lanes).find((v) => v != null) ?? null;
    for (const piece of straighten(line, 1.5)) {
      const len = polyLen(piece);
      if (len >= minLen) out.push({ pts: piece, len, names, highway: es[0].highway, lanes });
    }
  }
  return out;
}
const polyLen = (p: V3[]) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]); return s; };
/** A polyline cut at its farthest point from the chord until every piece lies within `tol` of its own chord. */
function straighten(p: V3[], tol: number): V3[][] {
  if (p.length <= 2) return [p];
  const a = p[0], b = p[p.length - 1], l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  let worst = 0, at = -1;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs((p[i][0] - a[0]) * (b[2] - a[2]) - (p[i][2] - a[2]) * (b[0] - a[0])) / l;
    if (d > worst) { worst = d; at = i; }
  }
  return worst <= tol ? [p] : [...straighten(p.slice(0, at + 1), tol), ...straighten(p.slice(at), tol)];
}

// ---------------------------------------------------------------- what stands along a stretch
type Item = { rings: [number, number][][]; x0: number; x1: number; z0: number; z1: number; b: Building };
class BuildingIndex {
  grid = new Map<string, Item[]>();
  all: { x: number; z: number; top: number }[] = [];
  cell: number;
  constructor(tiles: Tile[], cell = 32) {
    this.cell = cell;
    for (const t of tiles) for (const b of t.buildings ?? []) for (const poly of b.polygons) {
      const rings = toRings(poly);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of rings[0] ?? []) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      if (!Number.isFinite(x0)) continue;
      const it = { rings, x0, x1, z0, z1, b };
      this.all.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, top: b.base + b.height });
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
        for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) { const k = i + "," + j; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k)!.push(it); }
    }
  }
  at(x: number, z: number): Building | null {
    for (const it of this.grid.get(Math.floor(x / this.cell) + "," + Math.floor(z / this.cell)) ?? [])
      if (x >= it.x0 && x <= it.x1 && z >= it.z0 && z <= it.z1 && inRings(x, z, it.rings)) return it.b;
    return null;
  }
}
const storeysOf = (b: Building) => (b.storeys > 0 && b.storeys < 255 ? b.storeys : Math.max(1, Math.round(b.height / 3.3)));

export type Index = { carriageway: PolyIndex; sidewalk: PolyIndex; buildings: BuildingIndex; lines: ReturnType<typeof paintQuads>; props: Tile["props"] };
export function indexTiles(tiles: Tile[]): Index {
  const carriageway = new PolyIndex(24), sidewalk = new PolyIndex(24);
  for (const t of tiles) for (const a of t.areas) for (const rings of a.polygons) {
    if (a.kind === AREA.CARRIAGEWAY || a.kind === AREA.ROAD) carriageway.add(toRings(rings));
    else if (a.kind === AREA.SIDEWALK) sidewalk.add(toRings(rings));
  }
  const lines = paintQuads(tiles).filter((q) => q.kind === AREA.MARK_WHITE && q.wid >= 0.08 && q.wid <= 0.25 && q.len >= 0.5);
  return { carriageway, sidewalk, buildings: new BuildingIndex(tiles), lines, props: tiles.flatMap((t) => t.props) };
}

/** A stretch measured every 5 m: the carriageway's width, kerbed footway and 路側帯 line beside it, the buildings on
 *  each side, the poles and the street furniture along it. */
export function measure(run: Run, ix: Index): Measure {
  const p0 = run.pts[0], p1 = run.pts[run.pts.length - 1], L = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  const dx = (p1[0] - p0[0]) / L, dz = (p1[2] - p0[2]) / L, nx = -dz, nz = dx; // n: the right as one walks along d
  const widths: number[] = [];
  let kerbed = 0, rosoku = 0, n = 0;
  const side = [0, 1].map(() => ({ hits: 0, storeys: [] as number[], height: [] as number[], setback: [] as number[] }));
  const reach = (x: number, z: number, s: number) => { for (let d = 0.25; d <= 12; d += 0.25) if (!ix.carriageway.has(x + nx * d * s, z + nz * d * s)) return d; return null; };
  for (let t = 5; t <= L - 5; t += 5) {
    const x = p0[0] + dx * t, z = p0[2] + dz * t;
    n++;
    const R = ix.carriageway.has(x, z) ? reach(x, z, 1) : null, Lf = R != null ? reach(x, z, -1) : null;
    const w = R != null && Lf != null ? R + Lf : NaN;
    if (Number.isFinite(w)) widths.push(w);
    const half = Number.isFinite(w) ? w / 2 : 3, cx = Number.isFinite(w) ? x + nx * (R! - Lf!) / 2 : x, cz = Number.isFinite(w) ? z + nz * (R! - Lf!) / 2 : z;
    let kerb = false;
    for (const s of [1, -1]) for (const o of [0.6, 1.5, 2.5]) if (ix.sidewalk.has(cx + nx * s * (half + o), cz + nz * s * (half + o))) kerb = true;
    if (kerb) kerbed++;
    // buildings: the first met walking out from the carriageway's edge, within 12 m
    [-1, 1].forEach((s, k) => {
      for (let o = 0.5; o <= 12; o += 0.5) {
        const b = ix.buildings.at(cx + nx * s * (half + o), cz + nz * s * (half + o));
        if (b) { side[k].hits++; side[k].storeys.push(storeysOf(b)); side[k].height.push(b.height); side[k].setback.push(o); break; }
      }
    });
  }
  // a 路側帯 line: a white line piece along the road, within 1.2 m of the carriageway's edge
  const width = median(widths), half = (Number.isFinite(width) ? width : 6) / 2;
  const near = (x: number, z: number, lat: number) => { const t = (x - p0[0]) * dx + (z - p0[2]) * dz, o = (x - p0[0]) * nx + (z - p0[2]) * nz; return t >= 0 && t <= L && Math.abs(o) <= lat ? { t, o } : null; };
  const lineAt = new Set<number>();
  for (const q of ix.lines) {
    if (Math.abs(q.ux * dx + q.uz * dz) < 0.96) continue;
    const h = near(q.x, q.z, half + 0.3);
    if (h && Math.abs(h.o) >= half - 1.2) lineAt.add(Math.floor(h.t / 5));
  }
  rosoku = n ? Math.min(1, lineAt.size / n) : 0;
  const along = (kind: number, lat: number) => ix.props.filter((p) => p.kind === kind && near(p.x, p.z, lat));
  const poles = along(PROP.POLE, half + 5).map((p) => near(p.x, p.z, half + 5)!.t).sort((a, b) => a - b);
  const gaps = poles.slice(1).map((t, i) => t - poles[i]).filter((g) => g > 3);
  return {
    len: L, width, kerbed: n ? kerbed / n : 0, rosoku, poles: poles.length, poleSpacing: median(gaps),
    sides: side.map((s) => ({ frontage: n ? s.hits / n : 0, storeys: mean(s.storeys), height: mean(s.height), setback: mean(s.setback) })),
    trees: along(PROP.TREE, half + 6).length, vending: along(PROP.VENDING, half + 6).length, parked: along(PROP.PARKED, half + 6).length,
  };
}

// ---------------------------------------------------------------- the sun against the street
/** The sun's horizontal direction (towards it) in the frame's x, z. */
export const sunDir = (s: Sun): [number, number] => [Math.sin(s.azimuth * Math.PI / 180), Math.cos(s.azimuth * Math.PI / 180)];
/** The street's axis against the sun, for a camera looking along (dx, dz): the view turned to have the sun behind it,
 *  the angle between the axis and the sun's bearing (0: the sun straight down the street from behind; 90: across it),
 *  the side whose facades face the sun (as the camera sees it), and the share of that side's facades left in the sun by
 *  the buildings across the street (heights hSun on the sun's side, hLit on the lit side, facades `gap` m apart). */
export function sunAgainst(dx: number, dz: number, sun: Sun, hSun: number, hLit: number, gap: number) {
  const [sx, sz] = sunDir(sun);
  if (dx * sx + dz * sz > 0) { dx = -dx; dz = -dz; }
  const off = Math.acos(Math.min(1, Math.abs(dx * sx + dz * sz))) * 180 / Math.PI;
  const right = -dz * sx + dx * sz > 0; // the sun on the camera's right lights the left side's facades
  const across = Math.sin(off * Math.PI / 180), el = Math.max(0.5, sun.elevation) * Math.PI / 180;
  const shadow = across > 1e-3 ? Math.max(0, hSun - (gap / across) * Math.tan(el)) : hSun;
  const lit = sun.elevation <= 0 ? 0 : hLit > 0 ? clamp01(1 - shadow / hLit) : 0;
  return { dx, dz, off, litSide: (right ? "left" : "right") as "left" | "right", litFacade: lit };
}

/** The score's parts, each 0-1, and their weights. */
export const WEIGHTS = { width: 0.2, kerbless: 0.1, poles: 0.1, flats: 0.2, straight: 0.05, skyline: 0.15, sun: 0.2 };
export function score(m: Measure, sunOff: number, litFacade: number, towers: number): { parts: Record<keyof typeof WEIGHTS, number>; score: number } {
  const flats = m.sides.map((s) => s.frontage * band(s.storeys, 3, 7, 2)), expected = m.len / 30;
  const parts = {
    width: band(m.width, 5, 7, 1.5),
    kerbless: clamp01(1 - m.kerbed),
    poles: m.poles ? clamp01(m.poles / expected) * (Number.isFinite(m.poleSpacing) ? band(m.poleSpacing, 20, 40, 20) : 0.5) : 0,
    flats: Math.sqrt(flats[0] * flats[1]),
    straight: clamp01(m.len / 120),
    skyline: Math.exp(-towers / 3),
    sun: band(sunOff, 20, 60, 20) * (0.5 + 0.5 * litFacade),
  };
  let s = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) s += WEIGHTS[k] * parts[k];
  return { parts, score: s };
}

/** Towers in a view: buildings 45 m tall or more within 35 degrees of the view's axis, 60-1500 m out, rising 3 degrees
 *  or more over the eye. */
export function towersInView(all: { x: number; z: number; top: number }[], pos: V3, dx: number, dz: number, groundOf: (b: { top: number }) => number = () => 0) {
  let n = 0;
  for (const b of all) {
    const vx = b.x - pos[0], vz = b.z - pos[2], d = Math.hypot(vx, vz);
    if (d < 60 || d > 1500 || b.top - groundOf(b) < 45) continue;
    if ((vx * dx + vz * dz) / d < Math.cos(35 * Math.PI / 180)) continue;
    if (Math.atan2(b.top - pos[1], d) * 180 / Math.PI >= 3) n++;
  }
  return n;
}

/** The candidates, best first; a candidate within 80 m of a better one is left out, and so is one whose eye or target
 *  `inside` rejects (the CLI: outside the near level's baked cells, where the street is not dressed). */
export function refPoses(tiles: Tile[], edges: Edge[], sun: Sun, unproject: (x: number, z: number) => [number, number], n = 5, inside: (x: number, z: number) => boolean = () => true): Candidate[] {
  const ix = indexTiles(tiles), out: Candidate[] = [];
  const tall = ix.buildings.all.filter((b) => b.top > 0);
  for (const run of straightRuns(edges)) {
    if (run.lanes != null && run.lanes > 2) continue;
    const m = measure(run, ix);
    const p0 = run.pts[0], p1 = run.pts[run.pts.length - 1];
    const dx0 = (p1[0] - p0[0]) / m.len, dz0 = (p1[2] - p0[2]) / m.len;
    const gap = (Number.isFinite(m.width) ? m.width : 6) + (Number.isFinite(m.sides[0].setback) ? m.sides[0].setback : 3) + (Number.isFinite(m.sides[1].setback) ? m.sides[1].setback : 3);
    // the sun's side and the lit side as the run is walked (left = 0, right = 1); sunAgainst may turn the view round
    const pre = sunAgainst(dx0, dz0, sun, 0, 1, gap), flipped = pre.dx !== dx0 || pre.dz !== dz0;
    const litK = (pre.litSide === "left") !== flipped ? 0 : 1, sunK = 1 - litK;
    const h = (k: number) => (Number.isFinite(m.sides[k].height) ? m.sides[k].height : 0);
    const s = sunAgainst(dx0, dz0, sun, h(sunK), h(litK), gap);
    // the eye: 8 m in from the end the camera starts at, a quarter of the width over towards the sun's side (the lit
    // facades across the view), 1.7 m over the road; looking 50 m down the street, a little up (the poles' tops)
    const from = flipped ? p1 : p0, nx = -s.dz, nz = s.dx, sunSide = s.litSide === "left" ? 1 : -1;
    const lat = sunSide * (Number.isFinite(m.width) ? m.width : 6) / 4;
    const ground = from[1] + (flipped ? p0[1] - p1[1] : p1[1] - p0[1]) * (8 / m.len);
    const pos: V3 = [from[0] + s.dx * 8 + nx * lat, ground + EYE, from[2] + s.dz * 8 + nz * lat];
    const target: V3 = [pos[0] + s.dx * 50, pos[1] + 1.5, pos[2] + s.dz * 50];
    if (!inside(pos[0], pos[2]) || !inside(target[0], target[2])) continue;
    const towers = towersInView(tall, pos, s.dx, s.dz, () => ground);
    const r = score(m, s.off, s.litFacade, towers);
    const [lon, lat_] = unproject(pos[0], pos[2]);
    const seen = flipped ? { ...m, sides: [m.sides[1], m.sides[0]] } : m; // the sides as the camera sees them
    out.push({ pos: pos.map((v) => +v.toFixed(2)) as V3, target: target.map((v) => +v.toFixed(2)) as V3, lat: +lat_.toFixed(6), lon: +lon.toFixed(6), names: run.names, highway: run.highway, m: seen, sunOff: s.off, litSide: s.litSide, litFacade: s.litFacade, towers, parts: r.parts, score: r.score });
  }
  out.sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const c of out) { if (kept.length >= n) break; if (!kept.some((k) => Math.hypot(k.pos[0] - c.pos[0], k.pos[2] - c.pos[2]) < 80)) kept.push(c); }
  return kept;
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
export function formatPoses(cs: Candidate[], sun: Sun, clock: string): string {
  const bearing = (((180 - sun.azimuth) % 360) + 360) % 360;
  const out = [`# street-ref candidates: the sun at ${clock}, elevation ${f(sun.elevation)} deg, azimuth ${f(sun.azimuth)} deg (setSunAngles; compass bearing ${f(bearing)} deg)`, "",
    "| # | Score | Road | lat, lon | Width | Kerbed | 路側帯 line | Poles (spacing) | Storeys L / R (frontage) | Length | Sun off axis | Lit side (facade in sun) | Towers in view | Trees / vending / parked |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  cs.forEach((c, i) => {
    const sd = c.m.sides.map((s) => `${f(s.storeys)} (${f(s.frontage * 100, 0)}%)`).join(" / ");
    out.push(`| ${i + 1} | ${c.score.toFixed(3)} | ${c.names.join(", ") || "(unnamed)"} ${c.highway} | ${c.lat}, ${c.lon} | ${f(c.m.width)} m | ${f(c.m.kerbed * 100, 0)}% | ${f(c.m.rosoku * 100, 0)}% | ${c.m.poles} (${f(c.m.poleSpacing)} m) | ${sd} | ${f(c.m.len, 0)} m | ${f(c.sunOff, 0)} deg | ${c.litSide} (${f(c.litFacade * 100, 0)}%) | ${c.towers} | ${c.m.trees} / ${c.m.vending} / ${c.m.parked} |`);
  });
  out.push("", "Score parts (weights " + Object.entries(WEIGHTS).map(([k, v]) => `${k} ${v}`).join(", ") + "):", "");
  cs.forEach((c, i) => out.push(`${i + 1}. ` + Object.entries(c.parts).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")));
  out.push("", "As tools/quality.ts POSES entries (left and right as the camera sees them):", "");
  cs.forEach((c, i) => out.push(`  "street-ref-${i + 1}": { pos: [${c.pos.join(", ")}], target: [${c.target.join(", ")}] },`));
  return out.join("\n");
}

// ---------------------------------------------------------------- command line
async function main() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 5);
  const area = arg("area") ?? "shinjuku", dir = resolve(arg("tiles") ?? join(repoRoot, "assets/city/tiles", area));
  if (!existsSync(join(dir, "manifest.json"))) { console.log(`no compiled tiles at ${dir} (compile the area with tools/city first)`); return; }
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { origin: { lon: number; lat: number } };
  const tiles = readdirSync(dir).filter((nm) => /^t_-?\d+_-?\d+\.bin$/.test(nm)).map((nm) => { const b = readFileSync(join(dir, nm)); return decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) as Tile; });
  if (!tiles.length) { console.log(`no tiles in ${dir}`); return; }
  const roads = JSON.parse(readFileSync(join(dir, "roads.json"), "utf8")) as { edges: Edge[] };
  // the clock: the engine's own solar position (its time-of-day game), at the area's origin, on its date
  const hour = Number(arg("hour") ?? 15.5), date = (arg("date") ?? "2026-11-09").split("-").map(Number);
  const day = Math.round((Date.UTC(date[0], date[1] - 1, date[2]) - Date.UTC(date[0], 0, 1)) / 86400000) + 1;
  const { sunAt } = await import("../../engine/games/tokyo/tokyo-tod.game.ts");
  const sun: Sun = sunAt(hour, manifest.origin.lat, manifest.origin.lon, day);
  const proj = makeProjection(manifest.origin.lon, manifest.origin.lat);
  // only where the near level is baked (the street dressed: poles, cables, props), when the area has been baked
  const bakedAt = join(repoRoot, "assets/city/baked", area, "index.json");
  const baked = existsSync(bakedAt) ? JSON.parse(readFileSync(bakedAt, "utf8")) as { cell: number; cells: Record<string, unknown> } : null;
  const inside = baked ? (x: number, z: number) => `${Math.floor(x / baked.cell)}_${Math.floor(z / baked.cell)}` in baked.cells : undefined;
  const cs = refPoses(tiles, roads.edges, sun, (x, z) => proj.unproject(x, z) as [number, number], n, inside);
  const clock = `${date.join("-")} ${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")} JST`;
  if (process.argv.includes("--json")) console.log(JSON.stringify({ area, clock, sun, candidates: cs }, null, 1));
  else console.log(formatPoses(cs, sun, clock) + (baked ? "" : "\n\n(no baked cells found: candidates not limited to the near level)"));
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename))
  main().catch((e) => console.log(`street-ref failed: ${e instanceof Error ? e.stack : e}`)).finally(() => { process.exitCode = 0; });
