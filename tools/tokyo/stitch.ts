// The stitched city: the areas the scene streams side by side (scene/city.game.ts `AREAS`, with the offsets below),
// each compiled and baked in its own frame (tools/city: metres east and south of its own origin). The city's frame
// is the first area's; an area's offset is its origin projected into it (the frames differ by that shift: their
// scales differ by 4e-4, under a metre at Shibuya's far edge). The areas' rectangles abut: Shibuya's north edge is
// Shinjuku's south edge, to the centimetre.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { AREAS } from "../city/pipeline/config.mjs";
import { makeProjection } from "../city/shared/geo.js";

export const CITY = ["shinjuku", "shibuya"];
export type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const config = AREAS as unknown as Record<string, { origin: [number, number] }>;
const frame = makeProjection(...config[CITY[0]].origin);

/** Where an area's origin lies in the city's frame. */
export function offsetOf(name: string): [number, number] {
  const [x, z] = frame.project(...config[name].origin);
  return [x, z];
}
/** The area's compiled rectangle, in its own frame (tools/city manifest). */
export function boundsOf(name: string): Box {
  return (JSON.parse(readFileSync(join(repoRoot, `assets/city/tiles/${name}/manifest.json`), "utf8")) as { bounds: Box }).bounds;
}
/** The area's rectangle in the city's frame. */
export function cityBounds(name: string): Box {
  const b = boundsOf(name), [ox, oz] = offsetOf(name);
  return { minX: b.minX + ox, maxX: b.maxX + ox, minZ: b.minZ + oz, maxZ: b.maxZ + oz };
}

/** A half-plane an area's ground keeps to (in its own frame): `axis` (0 x, 2 z) `sign` x `at` (sign 1: ≤ at, -1: ≥ at). */
export type Seam = { axis: 0 | 2; sign: 1 | -1; at: number };
/** Where the area meets another of the city's: its edges there. Its ground (terrain, which its tiles carry to their
 *  256 m edges, past the area's) stops at them; elsewhere it runs on to the tiles' edges, under the city beyond. */
export function seamsOf(name: string): Seam[] {
  if (!CITY.includes(name)) return [];
  const a = cityBounds(name), own = boundsOf(name), seams: Seam[] = [];
  const near = (u: number, v: number) => Math.abs(u - v) < 1;
  for (const other of CITY) {
    if (other === name) continue;
    const b = cityBounds(other);
    const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0, overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0;
    if (overlapX && near(b.minZ, a.maxZ)) seams.push({ axis: 2, sign: 1, at: own.maxZ });
    if (overlapX && near(b.maxZ, a.minZ)) seams.push({ axis: 2, sign: -1, at: own.minZ });
    if (overlapZ && near(b.minX, a.maxX)) seams.push({ axis: 0, sign: 1, at: own.maxX });
    if (overlapZ && near(b.maxX, a.minX)) seams.push({ axis: 0, sign: -1, at: own.minX });
  }
  return seams;
}

/** Triangles (positions, normals, uvs or null; indexed) cut to the seams' half-planes: those beyond go, those across
 *  are cut along the seam (their attributes interpolated). A soup back. */
export function clipToSeams(seams: Seam[], pos: ArrayLike<number>, nor: ArrayLike<number>, uv: ArrayLike<number> | null, index: ArrayLike<number>) {
  type V = { p: number[]; n: number[]; t: number[] };
  const vert = (i: number): V => ({ p: [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], n: [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]], t: uv ? [uv[i * 2], uv[i * 2 + 1]] : [] });
  const lerp = (a: V, b: V, u: number): V => ({ p: a.p.map((v, k) => v + (b.p[k] - v) * u), n: a.n.map((v, k) => v + (b.n[k] - v) * u), t: a.t.map((v, k) => v + (b.t[k] - v) * u) });
  const P: number[] = [], N: number[] = [], T: number[] = [];
  for (let f = 0; f < index.length; f += 3) {
    let poly: V[] = [vert(index[f]), vert(index[f + 1]), vert(index[f + 2])];
    for (const s of seams) {
      const d = (v: V) => s.sign * (s.at - v.p[s.axis]);
      if (poly.every((v) => d(v) >= 0)) continue;
      const next: V[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], da = d(a), db = d(b);
        if (da >= 0) next.push(a);
        if ((da >= 0) !== (db >= 0)) next.push(lerp(a, b, da / (da - db)));
      }
      poly = next;
      if (poly.length < 3) break;
    }
    for (let k = 1; k + 1 < poly.length; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) { P.push(...v.p); N.push(...v.n); T.push(...v.t); }
  }
  return { pos: Float32Array.from(P), nor: Float32Array.from(N), uv: uv ? Float32Array.from(T) : null, index: Uint32Array.from({ length: P.length / 3 }, (_, i) => i) };
}
