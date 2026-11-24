// The streamed city's near levels, baked: every 128 m cell of a compiled area dressed by scene/hero/dress.ts at
// two levels — L1 (mid distance: windows, signs, roofs, poles, trees) and L0 (street level: everything) — and written
// as one binary per cell and level that scene/city.game.ts reads (`readAsset`) and adds as meshes in place.
//
//   node --max-old-space-size=16384 tools/tokyo/city-bake.ts [--area=shinjuku] [--only=i_j,...] [--levels=0,1] [--out=baked]
//     -> assets/city/<out>/<area>/L<level>/c_<i>_<j>.bin, kit.bin, index.json, looks.json
//   (--looks-only: looks.json alone, quickly: the buildings' looks without their dressing)
//
// A cell file: "TKC1", u32 header bytes, the header (JSON: its meshes — material name, vertex and index counts — its
// placements, and its kit instances — kit piece and count), padded to 4 bytes; then per mesh positions (3 x f32), normals
// (3 x f32), UVs (2 x f32), indices (u32); then per kit entry its instances' frames (12 x f32 each: the columns of a 3 x 4
// matrix).
// The kit (kit.bin, the same layout: "TKK1", its header — per piece its parts, material name, vertex and index counts,
// and how often it is used — then per part positions, normals, UVs, indices): every repeated element the dressing made (windows, ...), once, in its
// own frame. A cell holds where its elements stand; the scene places them as instances of the kit's meshes.
// looks.json: each building's look as the dress drew it (wall finish, curtain wall, windows; `BuildingLook`) by its id
// (the order of the tiles' buildings, as tools/tokyo/to-glb.ts reads them), and each material named there with its mean
// linear albedo: the far level's colours (to-glb.ts --city), so a building does not change colour between levels.
// Derived from PLATEAU / OSM / GSI: ODbL, kept out of git like the tiles.
import sharp from "sharp";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeTile } from "../city/shared/tileformat.js";
import { makeSurface } from "../city/shared/decks.js";
import { repoRoot } from "../lib/paths.ts";
import { dressDistrict, type BuildingLook, type HeroData, type Placement } from "../../scene/hero/dress.ts";
import { Batches, rng, type KitPiece, type V3 } from "../../scene/hero/builder.ts";
import { STREET_MODELS, streetModel } from "../../scene/hero/street.ts";
import { LIFT, streetPropParts } from "../../scene/hero/streetprops.ts";
import { PROP } from "../city/shared/tileformat.js";
import { propMaterials, aBoard, beerCases, bicycle, scooter, umbrellaStand, vendingMachine } from "../../scene/hero/props.ts";
import { heroMaterials } from "../../scene/hero/materials.ts";

const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1];
const area = arg("area", "shinjuku"), only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1].split(",");
const levels = arg("levels", "0,1").split(",").map(Number);
export const CELL = 128;
const MARGIN = 40;
const tilesDir = join(repoRoot, "assets/city/tiles", area);
const manifest = JSON.parse(readFileSync(join(tilesDir, "manifest.json"), "utf8"));
const t = manifest.terrain, tb = readFileSync(join(tilesDir, t.file));
const grid = { x0: t.x0, z0: t.z0, step: t.step, w: t.w, h: t.h, data: new Float32Array(tb.buffer, tb.byteOffset, tb.byteLength / 4) };
const surface = makeSurface(grid, manifest.decks ?? []);
const outDir = join(repoRoot, "assets/city", arg("out", "baked"), area);

// ---------------------------------------------------------------- the area's buildings, props and wires
type B = HeroData["buildings"][number] & { cx: number; cz: number };
const buildings: B[] = [], props: HeroData["props"] = [], wires: number[][] = [];
/** The tiles' road and sidewalk areas (the ground dressing's: scene/hero/ground.ts), each with its bounds. */
type A = HeroData["areas"][number] & { bb: [number, number, number, number] };
const roadAreas: A[] = [];
const GROUND_KINDS = new Set([0, 1, 2, 11]); // AREA.ROAD, CARRIAGEWAY, SIDEWALK, PATH
let id = 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
for (const f of readdirSync(tilesDir).filter((f) => /^t_.*\.bin$/.test(f)).sort()) {
  const b = readFileSync(join(tilesDir, f));
  const tile = decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  for (const bd of tile.buildings) {
    for (const p of bd.polygons) {
      if (!p[0]) continue;
      let cx = 0, cz = 0;
      for (let i = 0; i < p[0].length; i += 2) { cx += p[0][i]; cz += p[0][i + 1]; }
      cx /= p[0].length / 2; cz /= p[0].length / 2;
      buildings.push({ id: id++, usage: bd.usage, storeys: bd.storeys, flags: bd.flags, base: r2(bd.base), height: r2(bd.height), ring: Array.from(p[0], r2), holes: [], cx, cz });
    }
  }
  for (const p of tile.props) props.push({ kind: p.kind, variant: p.variant, rot: p.rot, x: p.x, z: p.z, scale: p.scale });
  for (const a of tile.areas) {
    if (!GROUND_KINDS.has(a.kind)) continue;
    for (const poly of a.polygons) {
      if (!poly[0]) continue;
      const rings = poly.map((r: Float32Array) => Array.from(r, r2));
      const o = rings[0];
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (let i = 0; i < o.length; i += 2) { bx0 = Math.min(bx0, o[i]); bx1 = Math.max(bx1, o[i]); bz0 = Math.min(bz0, o[i + 1]); bz1 = Math.max(bz1, o[i + 1]); }
      roadAreas.push({ kind: a.kind, code: a.code, rings, bb: [bx0, bz0, bx1, bz1] });
    }
  }
  for (let i = 0; i < tile.wires.length; i += 4) wires.push(Array.from(tile.wires.subarray(i, i + 4)));
}
// a coarse index for the neighbours of a cell
const near = new Map<string, B[]>();
for (const b of buildings) {
  const k = `${Math.floor(b.cx / CELL)}_${Math.floor(b.cz / CELL)}`;
  (near.get(k) ?? near.set(k, []).get(k)!).push(b);
}
const cells = [...near.keys()].map((k) => k.split("_").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// ---------------------------------------------------------------- materials (names are what the scene looks up)
const M = heroMaterials(true);

function cellData(i: number, j: number): HeroData {
  const x0 = i * CELL, z0 = j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  const bs: B[] = [];
  for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) for (const b of near.get(`${a}_${c}`) ?? []) if (b.cx > x0 - MARGIN && b.cx < x1 + MARGIN && b.cz > z0 - MARGIN && b.cz < z1 + MARGIN) bs.push(b);
  const tx0 = Math.floor(x0 - MARGIN), tz0 = Math.floor(z0 - MARGIN), w = CELL + 2 * MARGIN + 1, h = w;
  const y: number[] = [];
  for (let q = 0; q < h; q++) for (let p = 0; p < w; p++) y.push(r2(surface(tx0 + p, tz0 + q, -2)));
  const inside = (x: number, z: number, m: number) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
  return {
    box: [x0, z0, x1, z1], hero: [x0, z0, x1, z1],
    buildings: bs,
    areas: roadAreas.filter((a) => a.bb[0] < x1 + 10 && a.bb[2] > x0 - 10 && a.bb[1] < z1 + 10 && a.bb[3] > z0 - 10).map(({ kind, code, rings }) => ({ kind, code, rings })),
    props: props.filter((p) => inside(p.x, p.z, 20)),
    wires: wires.filter((w) => inside(w[0], w[1], 20) || inside(w[2], w[3], 20)),
    terrain: { x0: tx0, z0: tz0, step: 1, w, h, y },
  };
}

// ---------------------------------------------------------------- the kit: every repeated element once
const kit = new Map<string, { id: number; parts: KitPiece["parts"]; uses: number }>();
const kitList: KitPiece["parts"][] = [];
/** A cell's kit instances, by piece: their frames. */
type Instances = Map<number, number[]>;
function add(into: Instances, key: string, parts: () => KitPiece["parts"], matrix: number[]) {
  let k = kit.get(key);
  if (!k) {
    k = { id: kitList.length, parts: parts(), uses: 0 };
    kit.set(key, k);
    kitList.push(k.parts);
  }
  k.uses++;
  (into.get(k.id) ?? into.set(k.id, []).get(k.id)!).push(...matrix);
}
const collect = (into: Instances) => (piece: KitPiece) => add(into, piece.key, () => piece.parts, piece.matrix);

/** A piece a cell has fewer copies of than this, of fewer triangles in all than `MERGE_TRIS`, goes into the cell's
 *  meshes: each piece placed is an object of the scene's a material, and many objects of a few small copies cost every
 *  commit more than their triangles would. */
const MIN_COPIES = 8, MERGE_TRIS = 600;
const pieceTris = (k: number) => kitList[k].reduce((s, p) => s + p.index.length / 3, 0);

// the street models and props, whole models: a piece each (one per variant), placed where the dressing recorded them
const parts = (b: Batches): KitPiece["parts"] => b.entries().map((e) => ({ material: e.material, positions: e.positions, normals: e.normals, uvs: e.uvs, index: e.index }));
const PM = propMaterials(true);
const PROPS: Record<string, (b: Batches, pm: typeof PM, a: V3, f: V3, r: ReturnType<typeof rng>) => void> = {
  bike: bicycle, scooter, umbrellas: umbrellaStand, aboard: aBoard, vendingm: vendingMachine,
  beercases: (b, pm, a, f, r) => beerCases(b, pm, a, f, r, 3),
};
/** A placement's frame (turned about y by `ry`, scaled by `s`, at `at`): the columns of a 3 x 4 matrix. */
const frameOf = (at: V3, ry: number, s = 1) => [Math.cos(ry) * s, 0, -Math.sin(ry) * s, 0, s, 0, Math.sin(ry) * s, 0, Math.cos(ry) * s, at[0], at[1], at[2]];
/** The placements that are kit pieces into `into`; the rest (trees: glTF files) returned. */
function placementsToKit(placements: Placement[], into: Instances): Placement[] {
  const rest: Placement[] = [];
  for (const p of placements) {
    if ("m" in p) {
      if (!(STREET_MODELS as readonly string[]).includes(p.m)) { rest.push(p); continue; }
      add(into, `model ${p.m}`, () => parts(streetModel(p.m as (typeof STREET_MODELS)[number])), frameOf(p.at, p.ry, p.s));
    } else {
      const fn = PROPS[p.p];
      if (!fn) { rest.push(p); continue; }
      add(into, `prop ${p.p} ${p.v}`, () => {
        const b = new Batches();
        // (the seed the scene's prototypes had)
        fn(b, PM, [0, 0, 0], [0, 0, 1], rng(11 * 7919 + p.v * 104729 + p.p.length));
        return parts(b);
      }, frameOf(p.at, p.ry));
    }
  }
  return rest;
}

/** The city's own street furniture in a cell (street lights, signals, parked cars; utility poles at mid distance, which
 *  the street level draws itself), as the far level has it: its models as kit pieces where the compiled props stand. */
function streetPropsToKit(i: number, j: number, level: number, into: Instances) {
  const x0 = i * CELL, z0 = j * CELL;
  for (const p of props) {
    if (p.x < x0 || p.x >= x0 + CELL || p.z < z0 || p.z >= z0 + CELL) continue;
    if (!(p.kind === PROP.LIGHT || p.kind === PROP.SIGNAL || p.kind === PROP.PARKED || (p.kind === PROP.POLE && level === 1))) continue;
    const parts = streetPropParts(p.kind, p.variant);
    if (!parts) continue;
    add(into, `street prop ${p.kind} ${p.variant}`, () => parts, frameOf([p.x, surface(p.x, p.z) + (LIFT[p.kind] ?? 0), p.z], p.rot, p.scale || 1));
  }
}

type Entry = { material: { name: string }; positions: Float32Array; normals: Float32Array; uvs: Float32Array; index: Uint32Array };
/** A cell's pieces placed fewer than `MIN_COPIES` times, into its meshes as they stand. */
function mergeRare(entries: Entry[], instances: Instances): Entry[] {
  const add: Map<string, { material: { name: string }; pos: number[]; nor: number[]; uv: number[]; idx: number[] }> = new Map();
  for (const [k, m] of [...instances]) {
    const n = m.length / 12;
    if (n >= MIN_COPIES || n * pieceTris(k) >= MERGE_TRIS) continue;
    instances.delete(k);
    for (let c = 0; c < n; c++) {
      const M = m.slice(c * 12, c * 12 + 12);
      // (normals by the inverse transpose: each column's share divided by its squared length)
      const l2 = [0, 3, 6].map((o) => M[o] ** 2 + M[o + 1] ** 2 + M[o + 2] ** 2 || 1);
      for (const p of kitList[k]) {
        const e = add.get(p.material.name) ?? add.set(p.material.name, { material: p.material, pos: [], nor: [], uv: [], idx: [] }).get(p.material.name)!;
        const base = e.pos.length / 3, P = p.positions, N = p.normals;
        for (let i = 0; i < P.length; i += 3) {
          const x = P[i], y = P[i + 1], z = P[i + 2];
          e.pos.push(M[0] * x + M[3] * y + M[6] * z + M[9], M[1] * x + M[4] * y + M[7] * z + M[10], M[2] * x + M[5] * y + M[8] * z + M[11]);
          const a = N[i] / l2[0], b = N[i + 1] / l2[1], d = N[i + 2] / l2[2];
          const nx = M[0] * a + M[3] * b + M[6] * d, ny = M[1] * a + M[4] * b + M[7] * d, nz = M[2] * a + M[5] * b + M[8] * d, l = Math.hypot(nx, ny, nz) || 1;
          e.nor.push(nx / l, ny / l, nz / l);
        }
        for (let i = 0; i < p.uvs.length; i++) e.uv.push(p.uvs[i]);
        for (let i = 0; i < p.index.length; i++) e.idx.push(base + p.index[i]);
      }
    }
  }
  const out = entries.slice();
  for (const [name, a] of add) {
    const i = out.findIndex((e) => e.material.name === name);
    const was = i >= 0 ? out[i] : { material: a.material, positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), index: new Uint32Array(0) };
    const v0 = was.positions.length / 3;
    const cat = <T extends Float32Array | Uint32Array>(x: T, y: number[], make: (n: number) => T, shift = 0) => { const r = make(x.length + y.length); r.set(x); for (let j = 0; j < y.length; j++) r[x.length + j] = y[j] + shift; return r; };
    const merged = {
      material: was.material,
      positions: cat(was.positions, a.pos, (n) => new Float32Array(n)),
      normals: cat(was.normals, a.nor, (n) => new Float32Array(n)),
      uvs: cat(was.uvs, a.uv, (n) => new Float32Array(n)),
      index: cat(was.index, a.idx, (n) => new Uint32Array(n), v0),
    };
    if (i >= 0) out[i] = merged;
    else out.push(merged);
  }
  return out;
}

/** looks.json (see the top): the looks, and the mean linear albedo of each material they name. */
async function writeLooks() {
  if (only) return;
  const byName = new Map<string, { color: { r: number; g: number; b: number }; transmission?: number; p?: { map?: { uri: string } } }>();
  const collectMats = (v: unknown, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 3) return;
    const m = v as { name?: string; color?: { r: number } };
    if (typeof m.name === "string" && m.color && typeof m.color.r === "number") { if (!byName.has(m.name)) byName.set(m.name, v as never); return; }
    for (const x of Object.values(v)) collectMats(x, depth + 1);
  };
  collectMats(M);
  const used = new Set<string>();
  for (const l of looks.values()) {
    used.add(l.wall);
    used.add(l.windows.frame);
    if (l.curtain) for (const k of [l.curtain.glass, l.curtain.spandrel, l.curtain.fin]) used.add(k);
  }
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const texMean = new Map<string, number[]>();
  const materials: Record<string, { albedo: number[]; transmission?: number }> = {};
  for (const name of used) {
    const m = byName.get(name);
    if (!m) { console.warn(`looks: no material ${name}`); continue; }
    let base = [1, 1, 1];
    const uri = m.p?.map?.uri;
    if (uri) {
      if (!texMean.has(uri)) {
        const { data, info } = await sharp(join(repoRoot, uri)).resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const s = [0, 0, 0];
        for (let k = 0; k < data.length; k++) s[k % 3] += lin(data[k] / 255);
        texMean.set(uri, s.map((v) => v / (info.width * info.height)));
      }
      base = texMean.get(uri)!;
    }
    const c = [m.color.r, m.color.g, m.color.b];
    materials[name] = { albedo: base.map((v, k) => +(v * c[k]).toFixed(4)), ...(m.transmission ? { transmission: m.transmission } : {}) };
  }
  writeFileSync(join(outDir, "looks.json"), JSON.stringify({ looks: Object.fromEntries(looks), materials }));
  console.log(`looks: ${looks.size} buildings, ${Object.keys(materials).length} materials -> ${join(outDir, "looks.json")}`);
}

function header(magic: string, json: unknown) {
  const head = Buffer.from(JSON.stringify(json));
  const pad = (4 - ((8 + head.length) % 4)) % 4;
  const out: Buffer[] = [Buffer.from(magic), Buffer.alloc(4), head, Buffer.alloc(pad)];
  out[1].writeUInt32LE(head.length + pad);
  return out;
}
const bytes = (a: Float32Array | Uint32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function write(file: string, entries: Entry[], placements: Placement[], instances: Instances) {
  const meshes = entries.map((e) => ({ material: e.material.name, v: e.positions.length / 3, i: e.index.length }));
  const kitIn = [...instances].sort((a, b) => a[0] - b[0]);
  const parts = header("TKC1", {
    meshes,
    placements: placements.map((p) => ("m" in p ? { m: p.m, at: p.at.map(r2), ry: +p.ry.toFixed(3), s: +p.s.toFixed(3) } : { p: p.p, v: p.v, at: p.at.map(r2), ry: +p.ry.toFixed(3) })),
    kit: kitIn.map(([k, m]) => ({ k, n: m.length / 12 })),
  });
  for (const e of entries) for (const a of [e.positions, e.normals, e.uvs, e.index]) parts.push(bytes(a));
  for (const [, m] of kitIn) parts.push(bytes(new Float32Array(m)));
  const buf = Buffer.concat(parts);
  writeFileSync(file, buf);
  let kitTris = 0, inst = 0;
  for (const [k, m] of kitIn) { inst += m.length / 12; kitTris += (m.length / 12) * kitList[k].reduce((s, p) => s + p.index.length / 3, 0); }
  return { bytes: buf.length, tris: entries.reduce((s, e) => s + e.index.length / 3, 0), placements: placements.length, instances: inst, instancedTris: kitTris };
}

function writeKit(file: string) {
  const uses = [...kit.values()].sort((a, b) => a.id - b.id).map((k) => k.uses);
  const parts = header("TKK1", { pieces: kitList.map((ps) => ps.map((p) => ({ material: p.material.name, v: p.positions.length / 3, i: p.index.length }))), uses });
  for (const ps of kitList) for (const p of ps) for (const a of [p.positions, p.normals, p.uvs, p.index]) parts.push(bytes(a));
  const buf = Buffer.concat(parts);
  writeFileSync(file, buf);
  return buf.length;
}

for (const L of levels) mkdirSync(join(outDir, `L${L}`), { recursive: true });
const indexFile = join(outDir, "index.json");
let index: { cell: number; cells: Record<string, Record<string, { tris: number; bytes: number; placements: number; instances: number; instancedTris: number }>> } = { cell: CELL, cells: {} };
try { index = JSON.parse(readFileSync(indexFile, "utf8")); } catch { /* new */ }
const t0 = Date.now();
let n = 0, tris = [0, 0], inst = [0, 0], instTris = [0, 0];
const looks = new Map<number, BuildingLook>();
const looksOnly = process.argv.includes("--looks-only");
for (const [i, j] of cells) {
  const key = `${i}_${j}`;
  if (only && !only.includes(key)) continue;
  const data = cellData(i, j);
  if (looksOnly) {
    dressDistrict(data, M, true, 11, { cell: data.box, noMid: true, noProps: true, record: [], kit: () => {}, looks });
    continue;
  }
  for (const L of levels) {
    const record: Placement[] = [], instances: Instances = new Map();
    const d = dressDistrict(data, M, true, 11, { cell: data.box, full: L === 0, record, kit: collect(instances), looks });
    const rest = placementsToKit(record, instances);
    streetPropsToKit(i, j, L, instances);
    const r = write(join(outDir, `L${L}`, `c_${key}.bin`), mergeRare(d.batches.entries(), instances), rest, instances);
    (index.cells[key] ??= {})[`L${L}`] = r;
    tris[L] += r.tris;
    inst[L] += r.instances;
    instTris[L] += r.instancedTris;
  }
  if (++n % 25 === 0) console.log(`  ${n} cells, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await writeLooks();
if (looksOnly) process.exit(0);
if (only) console.log("(--only: the kit holds those cells' pieces alone; bake every cell before streaming them)");
{
  const uses = [...kit.values()].map((k) => k.uses).sort((a, b) => b - a), total = uses.reduce((a, b) => a + b, 0);
  const at = (n: number) => uses.filter((u) => u >= n).length;
  console.log(`kit reuse: ${uses.length} pieces for ${total} elements; used >= 2: ${at(2)}, >= 10: ${at(10)}, >= 100: ${at(100)}; top ${uses.slice(0, 5).join(" ")}`);
}
const kitBytes = writeKit(join(outDir, "kit.bin"));
const kitTris = kitList.reduce((s, ps) => s + ps.reduce((t, p) => t + p.index.length / 3, 0), 0);
writeFileSync(indexFile, JSON.stringify(index));
console.log(`kit: ${kitList.length} pieces, ${(kitTris / 1e6).toFixed(2)} M triangles, ${(kitBytes / 1e6).toFixed(1)} MB; placed L0 ${(inst[0] / 1e3).toFixed(0)} k (${(instTris[0] / 1e6).toFixed(1)} M triangles), L1 ${(inst[1] / 1e3).toFixed(0)} k (${(instTris[1] / 1e6).toFixed(1)} M)`);
console.log(`${area}: ${n} cells baked (L0 ${(tris[0] / 1e6).toFixed(1)} M, L1 ${(tris[1] / 1e6).toFixed(1)} M triangles) in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outDir}`);
