// The city's benchmark routes (ROADMAP § 0 step 2's acceptance), across the stitched areas in the city's frame
// (Shinjuku's: the scene puts Shibuya at its origin projected into it):
//   - drive: Meiji-dōri from Shinjuku 6-chōme south over the areas' seam to Shibuya, at 60 km/h, the driver's eye
//     1.2 m over the carriageway (its own one-way way: Meiji-dōri is mapped as two);
//   - expressway: Shuto Route 3 (Shibuya line), inbound on its elevated deck across Shibuya, at 100 km/h;
//   - flight: over Meiji-dōri's line at roof height (the highest roof within 40 m, 25 m over it, climbing and
//     descending at most 1 in 4), at 150 km/h.
// From the compiled road graphs (tools/city: roads.json, the road's level on bridges and the elevated expressway) and
// the compiled tiles' buildings. Written to assets/city/routes.json (OSM-derived: not in the repository):
//   { <name>: { speed (m/s), look (m: the camera looks at the route this far ahead), pts: [x, y, z, ...] every 2 m } }
//   node tools/tokyo/routes.ts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { CITY, cityBounds, offsetOf } from "./stitch.ts";
import { decodeTile } from "../city/shared/tileformat.js";

type Edge = { a: number; b: number; oneway: number; lanes: number | null; highway: string; name: string | null; ref: string | null; flyover: number; tunnel: number; pts: number[] };
const names = CITY;

// ---------------------------------------------------------------- the road graph, both areas, one frame
// Every vertex of a way a node (the areas cut a way that crosses their seam at different vertices: a way's vertex in
// one area is the other's too, the same OSM node projected in each, within a metre); an edge per segment.
type GEdge = { to: number; e: Edge };
const nodes: [number, number, number][] = [];
const out: GEdge[][] = [];
const bounds = names.map(cityBounds);
const hash = new Map<string, number[]>();
function node(p: [number, number, number]) {
  const cx = Math.floor(p[0]), cz = Math.floor(p[2]);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const k of hash.get(`${cx + dx}_${cz + dz}`) ?? []) {
    const q = nodes[k];
    if (Math.hypot(q[0] - p[0], q[2] - p[2]) < 1.5 && Math.abs(q[1] - p[1]) < 2) return k;
  }
  nodes.push(p);
  out.push([]);
  const key = `${cx}_${cz}`;
  (hash.get(key) ?? hash.set(key, []).get(key)!).push(nodes.length - 1);
  return nodes.length - 1;
}
for (const name of names) {
  const [ox, oz] = offsetOf(name);
  const roads = JSON.parse(readFileSync(join(repoRoot, `assets/city/tiles/${name}/roads.json`), "utf8")) as { edges: Edge[] };
  for (const e of roads.edges) {
    let prev = -1;
    for (let i = 0; i < e.pts.length; i += 3) {
      const k = node([e.pts[i] + ox, e.pts[i + 1], e.pts[i + 2] + oz]);
      if (prev >= 0 && prev !== k) {
        out[prev].push({ to: k, e });
        if (!e.oneway) out[k].push({ to: prev, e });
      }
      prev = k;
    }
  }
}

/** The cheapest way from any of `from` to any of `to`, a segment's cost its length times `cost(e)` (Infinity: closed). */
function path(from: number[], to: Set<number>, cost: (e: Edge) => number) {
  const dist = new Float64Array(nodes.length).fill(Infinity), back = new Int32Array(nodes.length).fill(-1);
  // (a binary heap of [distance, node])
  const heap: [number, number][] = [];
  const push = (d: number, k: number) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  for (const f of from) { dist[f] = 0; push(0, f); }
  while (heap.length) {
    const [d0, u] = pop();
    if (d0 > dist[u]) continue;
    if (to.has(u)) {
      const pts: [number, number, number][] = [];
      for (let v = u; v >= 0; v = back[v]) pts.unshift(nodes[v]);
      return pts;
    }
    for (const g of out[u]) {
      const c = cost(g.e);
      if (!isFinite(c)) continue;
      const q = nodes[g.to], d = dist[u] + Math.hypot(q[0] - nodes[u][0], q[2] - nodes[u][2]) * c;
      if (d < dist[g.to]) { dist[g.to] = d; back[g.to] = u; push(d, g.to); }
    }
  }
  throw new Error("no way");
}
const near = (x: number, z: number, ok: (k: number) => boolean = () => true) => {
  let best = -1, bd = Infinity;
  nodes.forEach((p, k) => { const d = Math.hypot(p[0] - x, p[2] - z); if (d < bd && ok(k)) { bd = d; best = k; } });
  return best;
};
const inArea = (x: number, z: number, m = 0) => bounds.some((b) => x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m);

// ---------------------------------------------------------------- resampled and smoothed
/** Every `step` metres along the polyline. */
function resample(p: [number, number, number][], step = 2) {
  const r: [number, number, number][] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    let s = step - carry;
    while (s <= l) { const t = s / l; r.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); s += step; }
    carry = l - (s - step);
  }
  return r;
}
/** A moving average over ±n points of the chosen axes (corners rounded, a level's steps eased). */
function smooth(p: [number, number, number][], n: number, axes: number[]) {
  return p.map((q, i) => {
    const r: [number, number, number] = [...q];
    for (const ax of axes) {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - n); k <= Math.min(p.length - 1, i + n); k++) { s += p[k][ax]; c++; }
      r[ax] = s / c;
    }
    return r;
  });
}
const flat = (p: [number, number, number][], dy = 0) => p.flatMap(([x, y, z]) => [+x.toFixed(2), +(y + dy).toFixed(2), +z.toFixed(2)]);

const routes: Record<string, { speed: number; look: number; pts: number[] }> = {};

// drive: Meiji-dōri, the southbound carriageway, Shinjuku 6-chōme to Shibuya (Miyashita Park); other streets cost 20 x
{
  const meiji = (e: Edge) => (e.name === "明治通り" ? 1 : e.highway.startsWith("motorway") ? Infinity : e.tunnel ? 40 : 20);
  const p = path([near(430, -880, (k) => out[k].some((g) => g.e.name === "明治通り"))], new Set([near(150, 3260, (k) => out[k].some((g) => g.e.name === "明治通り"))]), meiji);
  const r = smooth(smooth(resample(p), 6, [0, 2]), 10, [1]);
  routes.drive = { speed: 60 / 3.6, look: 18, pts: flat(r, 1.2) };
}

// expressway: Route 3 inbound (eastward), across Shibuya within the area
{
  const r3 = (e: Edge) => (e.highway === "motorway" && e.ref === "3" ? 1 : Infinity);
  const on3 = (k: number) => out[k].some((g) => r3(g.e) === 1) && inArea(nodes[k][0], nodes[k][2], 30);
  const ends = nodes.map((_, k) => k).filter(on3);
  // (the inbound carriageway's: its ways run east)
  const eastward = ends.filter((k) => out[k].some((g) => r3(g.e) === 1 && nodes[g.to][0] > nodes[k][0]));
  const west = eastward.reduce((a, k) => (nodes[k][0] < nodes[a][0] ? k : a));
  const east = new Set(ends.filter((k) => nodes[k][0] > 1900));
  const p = path([west], east, r3).filter(([x, , z]) => inArea(x, z, 20));
  const r = smooth(smooth(resample(p), 8, [0, 2]), 15, [1]);
  routes.expressway = { speed: 100 / 3.6, look: 40, pts: flat(r, 1.2) };
}

// flight: the drive's line at roof height
{
  // (the highest roof on a 10 m grid, every compiled building's top over its outline's box)
  const roof = new Map<string, number>();
  for (const name of names) {
    const [ox, oz] = offsetOf(name);
    const dir = join(repoRoot, `assets/city/tiles/${name}`);
    for (const f of readdirSync(dir).filter((f) => /^t_-?\d+_-?\d+\.bin$/.test(f))) {
      const buf = readFileSync(join(dir, f));
      const t = decodeTile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as { buildings: { base: number; height: number; polygons: Float32Array[][] }[] };
      for (const b of t.buildings) {
        const ring = b.polygons[0]?.[0];
        if (!ring) continue;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i] + ox); x1 = Math.max(x1, ring[i] + ox); z0 = Math.min(z0, ring[i + 1] + oz); z1 = Math.max(z1, ring[i + 1] + oz); }
        const top = b.base + b.height;
        for (let gx = Math.floor(x0 / 10); gx <= Math.floor(x1 / 10); gx++) for (let gz = Math.floor(z0 / 10); gz <= Math.floor(z1 / 10); gz++) {
          const k = `${gx}_${gz}`;
          roof.set(k, Math.max(roof.get(k) ?? -Infinity, top));
        }
      }
    }
  }
  const drive = routes.drive.pts;
  const line: [number, number, number][] = [];
  for (let i = 0; i < drive.length; i += 3) line.push([drive[i], drive[i + 1] - 1.2, drive[i + 2]]);
  const xz = smooth(line, 40, [0, 2]);
  const need = xz.map(([x, ground, z]) => {
    let top = ground;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (dx * dx + dz * dz <= 16) top = Math.max(top, roof.get(`${Math.floor(x / 10) + dx}_${Math.floor(z / 10) + dz}`) ?? ground);
    return top + 25;
  });
  // (climbing and descending at most 1 in 4: the lowest profile over every need that keeps that slope, 2 m a point)
  const y = [...need];
  for (let i = 1; i < y.length; i++) y[i] = Math.max(y[i], y[i - 1] - 0.5);
  for (let i = y.length - 2; i >= 0; i--) y[i] = Math.max(y[i], y[i + 1] - 0.5);
  const r = smooth(xz.map(([x, , z], i) => [x, y[i], z] as [number, number, number]), 15, [1]).map(([x, yy, z], i) => [x, Math.max(yy, need[i]), z] as [number, number, number]);
  routes.flight = { speed: 150 / 3.6, look: 80, pts: flat(r) };
}

const file = join(repoRoot, "assets/city/routes.json");
writeFileSync(file, JSON.stringify(routes));
for (const [k, r] of Object.entries(routes)) {
  const n = r.pts.length / 3, ys = r.pts.filter((_, i) => i % 3 === 1);
  console.log(`${k}: ${(n * 2 / 1000).toFixed(2)} km, ${(n * 2 / r.speed).toFixed(0)} s at ${(r.speed * 3.6).toFixed(0)} km/h, from ${r.pts.slice(0, 3).map((v) => v.toFixed(0))} to ${r.pts.slice(-3).map((v) => v.toFixed(0))}, y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}`);
}
console.log(`-> ${file}`);
