// The Shuto expressway's elevated decks over the stitched city (the compiled areas carry the road graph's levels, the
// expressway's above the streets, but no structure for it): a deck on its way's line at its level (asphalt, its lanes'
// dashed lines and edge lines), a parapet each side, the girder under it, and a pier every ~30 m down to the ground.
// Motorways and their ramps only (the streets' bridges are the compiled ground's). From the road graphs (tools/city
// roads.json: OSM-derived, as the rest of assets/city) into one GLB in the city's frame:
//   node tools/tokyo/viaducts.ts   -> assets/city/glb/tokyo-viaducts.glb
// Materials: "road 0 viaduct" (the scene's asphalt), "viaduct concrete", "viaduct paint".
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { sampleGrid } from "../city/shared/terrain.js";
import { GlbBuilder } from "./glb.ts";
import { CITY, boundsOf, offsetOf } from "./stitch.ts";

type Edge = { highway: string; flyover: number; lanes: number | null; oneway: number; pts: number[] };
type P = [number, number, number];
const LANE = 3.5, GIRDER = 2.2, PARAPET = 0.95, WALL = 0.35, PIER_EVERY = 30;
const deck: { pos: number[]; nor: number[] } = { pos: [], nor: [] }, concrete: { pos: number[]; nor: number[] } = { pos: [], nor: [] }, paint: { pos: number[]; nor: number[] } = { pos: [], nor: [] };
/** A quad (its corners in order round it) into a soup, facing `toward` (its normal turned that way). */
function quad(s: { pos: number[]; nor: number[] }, toward: number[], a: P, b: P, c: P, d: P) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const flip = n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] < 0;
  n = n.map((x) => (flip ? -x : x) / l);
  for (const p of flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]) { s.pos.push(...p); s.nor.push(...n); }
}
const UP = [0, 1, 0], DOWN = [0, -1, 0];
/** A box from its four bottom corners (in order round it) up `h`: its sides and top facing out. */
function box(s: { pos: number[]; nor: number[] }, c: P[], h: number) {
  const top = c.map((p) => [p[0], p[1] + h, p[2]] as P);
  const cx = c.reduce((t, p) => t + p[0], 0) / 4, cz = c.reduce((t, p) => t + p[2], 0) / 4;
  for (let k = 0; k < 4; k++) { const a = c[k], b = c[(k + 1) % 4]; quad(s, [(a[0] + b[0]) / 2 - cx, 0, (a[2] + b[2]) / 2 - cz], a, b, top[(k + 1) % 4], top[k]); }
  quad(s, UP, top[0], top[1], top[2], top[3]);
}

let km = 0, piers = 0;
for (const name of CITY) {
  const [ox, oz] = offsetOf(name), b = boundsOf(name);
  const dir = join(repoRoot, `assets/city/tiles/${name}`);
  const man = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { terrain: { file: string; x0: number; z0: number; step: number; w: number; h: number } };
  const tb = readFileSync(join(dir, man.terrain.file));
  const grid = { ...man.terrain, data: new Float32Array(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength)) };
  const ground = (x: number, z: number) => sampleGrid(grid, x, z);
  const roads = JSON.parse(readFileSync(join(dir, "roads.json"), "utf8")) as { edges: Edge[] };
  const inside = (x: number, z: number) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  for (const e of roads.edges) {
    if (!e.flyover || !e.highway.startsWith("motorway")) continue;
    // (the line every ~4 m, its level eased over ~12 m: the graph's levels step at its nodes)
    const raw: P[] = [];
    for (let i = 0; i < e.pts.length; i += 3) raw.push([e.pts[i], e.pts[i + 1], e.pts[i + 2]]);
    const line: P[] = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1], c = raw[i], n = Math.max(1, Math.round(Math.hypot(c[0] - a[0], c[2] - a[2]) / 4));
      for (let k = 1; k <= n; k++) line.push([a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n, a[2] + (c[2] - a[2]) * k / n]);
    }
    if (line.length < 2) continue;
    const ys = line.map((_, i) => { if (i === 0 || i === line.length - 1) return line[i][1]; let s = 0, c = 0; for (let k = Math.max(0, i - 3); k <= Math.min(line.length - 1, i + 3); k++) { s += line[k][1]; c++; } return s / c; });
    line.forEach((p, i) => { p[1] = ys[i]; });
    const lanes = e.lanes ?? (e.highway === "motorway" ? 2 : 1);
    const half = (lanes * LANE + (e.highway === "motorway" ? 2 : 1.5)) / 2;
    // (each point's sideways: the bisector of its segments, so the deck's pieces meet)
    const side = line.map((_, i) => {
      const a = line[Math.max(0, i - 1)], c = line[Math.min(line.length - 1, i + 1)];
      const dx = c[0] - a[0], dz = c[2] - a[2], l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    });
    const at = (i: number, off: number, dy = 0): P => [line[i][0] + side[i][0] * off + ox, line[i][1] + dy, line[i][2] + side[i][1] * off + oz];
    let run = 0;
    for (let i = 1; i < line.length; i++) {
      const len = Math.hypot(line[i][0] - line[i - 1][0], line[i][2] - line[i - 1][2]);
      const mid = [(line[i][0] + line[i - 1][0]) / 2, (line[i][2] + line[i - 1][2]) / 2];
      run += len;
      if (!inside(mid[0], mid[1])) continue;
      km += len / 1000;
      const j = i - 1;
      // the deck: the road, the girder's sides and soffit
      const sd = [side[i][0], 0, side[i][1]], sn = sd.map((x) => -x);
      quad(deck, UP, at(j, half), at(j, -half), at(i, -half), at(i, half));
      quad(concrete, sn, at(j, -half, -GIRDER), at(i, -half, -GIRDER), at(i, -half), at(j, -half));
      quad(concrete, sd, at(i, half, -GIRDER), at(j, half, -GIRDER), at(j, half), at(i, half));
      quad(concrete, DOWN, at(i, half, -GIRDER), at(i, -half, -GIRDER), at(j, -half, -GIRDER), at(j, half, -GIRDER));
      // the parapets: inner face, top, outer face
      for (const s of [1, -1]) {
        const o = s * half, w = o - s * WALL;
        const out_ = sd.map((x) => x * s), in_ = out_.map((x) => -x);
        quad(concrete, in_, at(i, w), at(j, w), at(j, w, PARAPET), at(i, w, PARAPET));
        quad(concrete, UP, at(i, w, PARAPET), at(j, w, PARAPET), at(j, o, PARAPET), at(i, o, PARAPET));
        quad(concrete, out_, at(j, o), at(i, o), at(i, o, PARAPET), at(j, o, PARAPET));
      }
      // the paint: edge lines 0.6 m in from the parapets, the lanes' dashes (6 m, 9 m apart)
      const line_ = (off: number) => quad(paint, UP, at(j, off + 0.075, 0.02), at(j, off - 0.075, 0.02), at(i, off - 0.075, 0.02), at(i, off + 0.075, 0.02));
      line_(half - WALL - 0.6);
      line_(-(half - WALL - 0.6));
      if (run % 15 < 6) for (let k = 1; k < lanes; k++) line_(-lanes * LANE / 2 + k * LANE);
      // a pier: a column from the ground to the girder, a cap across under it
      if (Math.floor(run / PIER_EVERY) !== Math.floor((run - len) / PIER_EVERY)) {
        const g = ground(line[i][0], line[i][2]), top = line[i][1] - GIRDER;
        if (top - g > 3) {
          const cw = 1.1, cap = Math.min(half * 0.8, half - 0.5);
          const fwd = [side[i][1], -side[i][0]];
          const corner = (u: number, v: number, y: number): P => [line[i][0] + side[i][0] * u + fwd[0] * v + ox, y, line[i][2] + side[i][1] * u + fwd[1] * v + oz];
          box(concrete, [corner(-cw, -cw, g - 0.5), corner(-cw, cw, g - 0.5), corner(cw, cw, g - 0.5), corner(cw, -cw, g - 0.5)], top - 1.4 - (g - 0.5));
          box(concrete, [corner(-cap, -0.9, top - 1.4), corner(-cap, 0.9, top - 1.4), corner(cap, 0.9, top - 1.4), corner(cap, -0.9, top - 1.4)], 1.4);
          piers++;
        }
      }
    }
  }
}
const g = new GlbBuilder();
const soup = (name: string, color: [number, number, number], roughness: number, s: { pos: number[]; nor: number[] }) => {
  if (!s.pos.length) return;
  const pos = Float32Array.from(s.pos);
  // (uv in metres, along the ground: the scene's road material is in world space anyway)
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) { uv[j] = pos[i] / 4; uv[j + 1] = pos[i + 2] / 4; }
  g.triangles(g.material({ name, color, roughness }), pos, Float32Array.from(s.nor), uv, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), "viaducts");
};
soup("road 0 viaduct", [0.1, 0.1, 0.1], 0.85, deck);
soup("viaduct concrete", [0.52, 0.51, 0.48], 0.88, concrete);
soup("viaduct paint", [0.78, 0.78, 0.75], 0.6, paint);
const out = join(repoRoot, "assets/city/glb/tokyo-viaducts.glb");
writeFileSync(out, g.build("tokyo-viaducts"));
const tris = (deck.pos.length + concrete.pos.length + paint.pos.length) / 9;
console.log(`viaducts: ${km.toFixed(1)} km of deck, ${piers} piers, ${(tris / 1e3).toFixed(0)} k triangles -> ${out}`);
