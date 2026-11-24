// The city past the compiled areas (roadmap § 0, the user's: from above 140 m the world stopped at a grey plain a
// kilometre out). Blocks of 3 to 60 m and a tower here and there on a jittered 46 m grid, out to ~6 km from the areas'
// edges, thinning with distance; boxes without bottoms, three facades (their windows are the scene's: SurfaceMaterial's
// procedural facade windows on the material names "distant facade <n>"). One GLB in the first area's frame (where the
// scene puts the others: their origins projected into it), nodes by 1 km sector:
//   node tools/tokyo/distant.ts [--areas=shinjuku,shibuya]   -> assets/city/glb/tokyo-distant.glb
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { GlbBuilder } from "./glb.ts";
import { CITY, cityBounds, type Box } from "./stitch.ts";

const names = (process.argv.find((a) => a.startsWith("--areas=")) ?? `--areas=${CITY.join(",")}`).split("=")[1].split(",");
const boxes: Box[] = names.map(cityBounds);
// (the ground's lowest is Shibuya's valley, 8 m: the blocks stand on the plain the scene lays at 7 m)
const margin = 60, reach = 5000, step = 46, base = 7;
const b: Box = { minX: Math.min(...boxes.map((q) => q.minX)), maxX: Math.max(...boxes.map((q) => q.maxX)), minZ: Math.min(...boxes.map((q) => q.minZ)), maxZ: Math.max(...boxes.map((q) => q.maxZ)) };
const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
const boxDist = (q: Box, x: number, z: number) => Math.hypot(Math.max(q.minX - x, 0, x - q.maxX), Math.max(q.minZ - z, 0, z - q.maxZ));
const COLOURS: [number, number, number][] = [[0.62, 0.6, 0.56], [0.72, 0.68, 0.6], [0.48, 0.5, 0.52]];
let h = 1234567;
const rnd = () => ((h = (h * 16807) % 2147483647) / 2147483647);
const sectors = new Map<string, { pos: number[]; nor: number[]; idx: number[] }>();
let count = 0;
for (let x = cx - reach - (b.maxX - b.minX) / 2; x < cx + reach + (b.maxX - b.minX) / 2; x += step) {
  for (let z = cz - reach - (b.maxZ - b.minZ) / 2; z < cz + reach + (b.maxZ - b.minZ) / 2; z += step) {
    const jx = x + (rnd() - 0.5) * step * 0.6, jz = z + (rnd() - 0.5) * step * 0.6, r = rnd(), hr = rnd(), wr = rnd(), dr = rnd(), mr = rnd(), ar = rnd();
    if (boxes.some((q) => jx > q.minX - margin && jx < q.maxX + margin && jz > q.minZ - margin && jz < q.maxZ + margin)) continue;
    const d = Math.min(...boxes.map((q) => boxDist(q, jx, jz)));
    if (d > reach || r > 1 - (d / reach) * 0.6) continue;
    const height = hr < 0.02 ? 80 + hr * 5000 : hr < 0.12 ? 30 + hr * 250 : 6 + hr * hr * 40;
    const w = 14 + wr * 20, dep = 14 + dr * 20, a = (ar - 0.5) * 0.3, ca = Math.cos(a), sa = Math.sin(a);
    const key = `${Math.floor(jx / 1000)}_${Math.floor(jz / 1000)}_${Math.floor(mr * 3)}`;
    const s = sectors.get(key) ?? sectors.set(key, { pos: [], nor: [], idx: [] }).get(key)!;
    const P = (u: number, y: number, v: number) => [jx + u * ca - v * sa, y, jz + u * sa + v * ca];
    const faces = [
      [[-1, 0, -1], [1, 0, -1], [1, 1, -1], [-1, 1, -1]], [[1, 0, 1], [-1, 0, 1], [-1, 1, 1], [1, 1, 1]],
      [[-1, 0, 1], [-1, 0, -1], [-1, 1, -1], [-1, 1, 1]], [[1, 0, -1], [1, 0, 1], [1, 1, 1], [1, 1, -1]],
      [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]],
    ];
    const ns = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    faces.forEach((f, k) => {
      const v0 = s.pos.length / 3;
      for (const [u, yy, v] of f) s.pos.push(...P((u * w) / 2, base + yy * height, (v * dep) / 2));
      const n = k < 4 ? [ns[k][0] * ca - ns[k][1] * sa, 0, ns[k][0] * sa + ns[k][1] * ca] : [0, 1, 0];
      for (let q = 0; q < 4; q++) s.nor.push(...n);
      s.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    });
    count++;
  }
}
const g = new GlbBuilder();
const mats = COLOURS.map((color, i) => g.material({ name: `distant facade ${i + 1}`, color, roughness: 0.85 }));
let tris = 0;
for (const [key, s] of sectors) {
  const m = Number(key.split("_")[2]);
  g.triangles(mats[m], Float32Array.from(s.pos), Float32Array.from(s.nor), null, Uint32Array.from(s.idx), `d ${key}`);
  tris += s.idx.length / 3;
}
const out = join(repoRoot, "assets/city/glb/tokyo-distant.glb");
writeFileSync(out, g.build("tokyo-distant"));
console.log(`${names.join(" + ")}: beyond the areas: ${count} blocks, ${(tris / 1e6).toFixed(2)} M triangles, ${sectors.size} sectors -> ${out}`);
