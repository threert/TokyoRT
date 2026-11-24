// The street's ground at street level (roadmap § 0 step 6a): what years of use leave on a Tokyo road, placed by the
// cell's own road areas (the compiled tiles' carriageways, roads and sidewalks), not as a tiled noise.
//   - manholes down the carriageways, every few tens of metres, clear of the kerbs;
//   - repairs: rectangles where a service was dug up and filled with fresher asphalt, and trench strips along the
//     road, each with the dark sealed seam round it;
//   - the kerb's gutter line: a dark wet band where water runs along the kerb, and the dust and grit beside it.
// All of it lies a few millimetres over the far level's road surface (the source mesher lifts a carriageway 6 cm
// over the terrain, a road 4 cm, a sidewalk 20 cm), as decals in the cell's meshes.
import type { MeshStandardMaterial } from "@threert/scene";
import type { Batches, V3 } from "./builder.ts";

/** The compiled tiles' area kinds this reads (tools/city/shared/tileformat.js `AREA`). */
const AREA_KIND = { ROAD: 0, CARRIAGEWAY: 1, SIDEWALK: 2, PATH: 11 } as const;
type Area = { kind: number; code: number; rings: number[][] };
type Rng = { next(): number; range(a: number, b: number): number; chance(p: number): boolean };
export type GroundMats = { patch: MeshStandardMaterial; seam: MeshStandardMaterial; gutterWet: MeshStandardMaterial; gutterDust: MeshStandardMaterial; lane: MeshStandardMaterial; stain: MeshStandardMaterial[] };

/** How far over the terrain each kind of area's surface lies (the source mesher's lifts). */
const LIFT: Record<number, number> = { [AREA_KIND.ROAD]: 0.04, [AREA_KIND.CARRIAGEWAY]: 0.06, [AREA_KIND.SIDEWALK]: 0.2, [AREA_KIND.PATH]: 0.035 };

function inRing(x: number, z: number, r: number[]) {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Inside an area: its outer ring, none of its holes. */
const inArea = (x: number, z: number, a: Area) => inRing(x, z, a.rings[0]) && !a.rings.slice(1).some((h) => inRing(x, z, h));
/**
 * The cell's ground dressing. `box` the cell (x0, z0, x1, z1), `terrain` its height, `place` a street model (the
 * manhole), `B` the cell's batches.
 */
export function dressGround(o: { areas: Area[]; box: [number, number, number, number]; terrain: (x: number, z: number) => number; B: Batches; R: Rng; M: GroundMats; place: (key: string, at: V3, facing: V3, scale?: number, spin?: number) => void }) {
  const { areas, box, terrain, B, R, M } = o;
  const [x0, z0, x1, z1] = box;
  // (a lane's footpath strip too: the compiler cuts it out of the lane's road pieces, and left as the far level's
  // concrete it read as a dark arrow down the worn lane)
  const roads = areas.filter((a) => a.kind === AREA_KIND.CARRIAGEWAY || a.kind === AREA_KIND.ROAD || a.kind === AREA_KIND.PATH);
  const roadAt = (x: number, z: number) => roads.find((a) => inArea(x, z, a));
  // (the compiler cuts a road into pieces: its clearance is to the union's edge, its direction the longest run on road)
  const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)] as [number, number]);
  const clear = (x: number, z: number, r: number) => DIRS.every(([dx, dz]) => roadAt(x + dx * r, z + dz * r) && roadAt(x - dx * r, z - dz * r));
  const along = (x: number, z: number): [number, number] => {
    let best = DIRS[0], run = -1;
    for (const d of DIRS) {
      let n = 0;
      for (let t = 1; t <= 8; t++) if (roadAt(x + d[0] * t, z + d[1] * t)) n++; else break;
      for (let t = 1; t <= 8; t++) if (roadAt(x - d[0] * t, z - d[1] * t)) n++; else break;
      if (n > run) { run = n; best = d; }
    }
    return best;
  };
  /** How far the road reaches across `dir` from here (m, up to 6). */
  const across = (x: number, z: number, dir: [number, number]) => {
    let w = 0;
    for (let t = 0.25; t <= 6; t += 0.25) { if (roadAt(x - dir[1] * t, z + dir[0] * t) && roadAt(x + dir[1] * t, z - dir[0] * t)) w = t; else break; }
    return w;
  };
  const counts: { manholes: number; patches: number; trenches: number; kerbs: number; lanes: number; stains?: number } = { manholes: 0, patches: 0, trenches: 0, kerbs: 0, lanes: 0 };

  /** A rectangle on the road (centre, along-direction, length, width), draped on the terrain in quads ~4 m along and
   *  ~2 m across (a road bends that little over them; 1 m quads were 5.7 M triangles more at street level). */
  const drape = (m: MeshStandardMaterial, cx: number, cz: number, dir: [number, number], len: number, wid: number, lift: number) => {
    const [ux, uz] = dir, vx = -uz, vz = ux;
    const nu = Math.max(1, Math.ceil(len / 4)), nv = Math.max(1, Math.ceil(wid / 2));
    const at = (a: number, b: number): V3 => {
      const x = cx + ux * (a - 0.5) * len + vx * (b - 0.5) * wid, z = cz + uz * (a - 0.5) * len + vz * (b - 0.5) * wid;
      return [x, terrain(x, z) + lift, z];
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a0 = i / nu, a1 = (i + 1) / nu, b0 = j / nv, b1 = (j + 1) / nv;
      B.quad(m, at(a0, b0), at(a0, b1), at(a1, b1), at(a1, b0), [0, 1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]]);
    }
  };
  /** A repair: its fresher asphalt and the dark sealed seam round it. */
  const repair = (cx: number, cz: number, dir: [number, number], len: number, wid: number, lift: number) => {
    drape(M.patch, cx, cz, dir, len, wid, lift + 0.016);
    const [ux, uz] = dir, vx = -uz, vz = ux, s = 0.04;
    for (const side of [-1, 1]) {
      drape(M.seam, cx + vx * side * wid / 2, cz + vz * side * wid / 2, dir, len + s, s, lift + 0.018);
      drape(M.seam, cx + ux * side * len / 2, cz + uz * side * len / 2, dir, s, wid + s, lift + 0.018);
    }
  };
  const inside = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;

  // the lanes (a road piece under ~6 m across): their own worn surface, lighter than a street's asphalt, as Golden Gai's
  // lanes are (on the far level's near-black asphalt in the shade a stain or a patch could not show)
  for (const a of roads) {
    const ring = a.rings[0];
    let cx = 0, cz = 0;
    for (let k = 0; k < ring.length; k += 2) { cx += ring[k]; cz += ring[k + 1]; }
    cx /= ring.length / 2; cz /= ring.length / 2;
    if (!inside(cx, cz) || !inArea(cx, cz, a) || across(cx, cz, along(cx, cz)) > 3) continue;
    // (draped on the terrain in 1 m cells inside the piece: triangulated at its outline's corners alone, the far level's
    // road, draped finer, came through it where the ground bulges)
    const lift = (LIFT[a.kind] ?? 0.06) + 0.01;
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (let k = 0; k < ring.length; k += 2) { bx0 = Math.min(bx0, ring[k]); bx1 = Math.max(bx1, ring[k]); bz0 = Math.min(bz0, ring[k + 1]); bz1 = Math.max(bz1, ring[k + 1]); }
    const g = (x: number, z: number): V3 => [x, terrain(x, z) + lift, z];
    for (let x = Math.floor(bx0); x < bx1; x += 1) for (let z = Math.floor(bz0); z < bz1; z += 1) {
      // (the outline alone, holes and all, and a cell kept if any corner is inside: the lane covered to its edges)
      if (![[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]].some(([u, v]) => inRing(x + u, z + v, ring))) continue;
      B.quad(M.lane, g(x, z), g(x, z + 1), g(x + 1, z + 1), g(x + 1, z), [0, 1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]]);
    }
    counts.lanes++;
    // on it, what a lane collects: stains (oil, spilt drink, water that stood), dark on the worn grey; a manhole in
    // its middle on some
    const n = Math.ceil(((bx1 - bx0) * (bz1 - bz0)) / 8);
    for (let k = 0; k < n; k++) {
      const x = R.range(bx0, bx1), z = R.range(bz0, bz1);
      // (all over the piece: the cell that has its centroid draws all of it, its surface and its stains)
      if (!inRing(x, z, ring)) continue;
      // (soft, not cut out: three nested rings of the lane's own surface, a shade darker at the rim to dark at the
      // heart; an outline of 16 points from two overlapping lobes, so no two are alike and none is a polygon)
      const rad = R.range(0.25, 0.8), sq = R.range(0.5, 1), rot = R.next() * Math.PI, ox = R.range(-0.4, 0.4), oz = R.range(-0.4, 0.4), lobe = R.range(0.4, 0.8);
      const wob = Array.from({ length: 16 }, () => R.range(0.8, 1.15));
      const outline = (scale: number, y: number): V3[] => Array.from({ length: 16 }, (_, q) => {
        const an = (q / 16) * Math.PI * 2, c = Math.cos(an), sn = Math.sin(an);
        // (the farther of two ellipses' edges along the ray: a blob of two lobes)
        const e1 = 1, e2 = lobe * Math.max(0, 1 + (c * ox + sn * oz) / rad);
        const rr = rad * scale * Math.max(e1, e2) * wob[q], u = c * rr, v = sn * rr * sq;
        const px = x + u * Math.cos(rot) - v * Math.sin(rot), pz = z + u * Math.sin(rot) + v * Math.cos(rot);
        return [px, terrain(px, pz) + y, pz];
      });
      const fan = Array.from({ length: 14 }, (_, q) => [0, q + 1, q + 2]).flat();
      const base = lift;
      [[1, M.stain[0], 0.002], [0.72, M.stain[1], 0.003], [0.45, M.stain[2], 0.004]].forEach(([sc, m, dy]) => B.polygon(m as MeshStandardMaterial, outline(sc as number, base + (dy as number)), fan, [0, 1, 0]));
      counts.stains = (counts.stains ?? 0) + 1;
    }
    if (R.chance(0.5) && clear(cx, cz, 0.7)) {
      o.place("manhole", [cx, terrain(cx, cz) + lift + 0.006, cz], [0, 0, 1], 1, R.next() * 6);
      counts.manholes++;
    }
  }
  // manholes: a jittered 9 m grid over the cell, on a carriageway or road and clear of its edges; about one in five
  // (on a 10 m road, one every 40 m or so)
  for (let gx = x0 + 4.5; gx < x1; gx += 9) for (let gz = z0 + 4.5; gz < z1; gz += 9) {
    const x = gx + R.range(-3, 3), z = gz + R.range(-3, 3);
    if (!R.chance(0.22)) continue;
    const a = roadAt(x, z);
    // (a lane too: a smaller clearance, a manhole down its middle)
    if (!a || !clear(x, z, 0.9)) continue;
    o.place("manhole", [x, terrain(x, z) + (LIFT[a.kind] ?? 0.06) + 0.004, z], [0, 0, 1], 1, R.next() * 6);
    counts.manholes++;
  }
  // repairs: a rectangle every ~500 m² of road, along the road's nearest edge; a trench strip along some edges
  for (let gx = x0 + 6; gx < x1; gx += 12) for (let gz = z0 + 6; gz < z1; gz += 12) {
    const x = gx + R.range(-5, 5), z = gz + R.range(-5, 5);
    const a = roadAt(x, z);
    if (!a) continue;
    const dir = along(x, z), half = across(x, z, dir);
    // (in a lane a small one: a dug-up pipe's patch)
    const len = half < 1.5 ? R.range(0.6, 1.8) : R.range(1.5, 6), wid = half < 1.5 ? R.range(0.5, 1.0) : R.range(0.9, Math.min(3, Math.max(1, half * 1.2)));
    if (half < wid / 2 + 0.15 || !clear(x, z, Math.min(len / 2, half < 1.5 ? 0.7 : 2))) continue;
    repair(x, z, dir, len, wid, LIFT[a.kind] ?? 0.06);
    counts.patches++;
  }
  for (const a of roads) for (const r of a.rings.slice(0, 1)) for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], dx = r[j * 2] - ax, dz = r[j * 2 + 1] - az, l = Math.hypot(dx, dz);
    if (l < 16 || !R.chance(0.25)) continue;
    const ux = dx / l, uz = dz / l;
    // (inward: the side of the edge the road is on)
    const off = R.range(1.2, 3.5), mx = ax + dx / 2, mz = az + dz / 2;
    const s = inArea(mx - uz * off, mz + ux * off, a) ? 1 : -1;
    const len = Math.min(l - 2, R.range(8, 28)), t = R.range(len / 2 + 1, l - len / 2 - 1);
    const cx = ax + ux * t - s * uz * off, cz = az + uz * t + s * ux * off;
    if (!inside(cx, cz) || !inArea(cx, cz, a)) continue;
    repair(cx, cz, [ux, uz], len, R.range(0.5, 0.8), LIFT[a.kind] ?? 0.06);
    counts.trenches++;
  }
  // the kerbs: every sidewalk edge that has road beside it, in the cell: a wet dark line at the kerb, grit beside it
  for (const a of areas) {
    if (a.kind !== AREA_KIND.SIDEWALK) continue;
    for (const r of a.rings) for (let i = 0, n = r.length / 2; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], dx = r[j * 2] - ax, dz = r[j * 2 + 1] - az, l = Math.hypot(dx, dz);
      if (l < 0.5) continue;
      const ux = dx / l, uz = dz / l, mx = ax + dx / 2, mz = az + dz / 2;
      if (!inside(mx, mz)) continue;
      // the road's side of the edge: 0.3 m out, off the sidewalk and on a road
      let s = 0;
      for (const sg of [1, -1]) {
        const px = mx - sg * uz * 0.3, pz = mz + sg * ux * 0.3;
        if (!inArea(px, pz, a) && roadAt(px, pz)) s = sg;
      }
      if (!s) continue;
      const road = roadAt(mx - s * uz * 0.3, mz + s * ux * 0.3)!, lift = LIFT[road.kind] ?? 0.06;
      const wet = R.range(0.1, 0.16), dust = R.range(0.2, 0.35);
      drape(M.gutterWet, mx - s * uz * (wet / 2), mz + s * ux * (wet / 2), [ux, uz], l, wet, lift + 0.005);
      drape(M.gutterDust, mx - s * uz * (wet + dust / 2), mz + s * ux * (wet + dust / 2), [ux, uz], l, dust, lift + 0.003);
      counts.kerbs++;
    }
  }
  return counts;
}
