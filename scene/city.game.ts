// Tokyo, the whole compiled area, streamed by level of detail around a first-person flying camera (ROADMAP § 0 step 2):
//   - far: the compiled tiles (tools/tokyo/to-glb.ts --city), always resident: the ground of every tile, and per 128 m
//     quadrant its buildings, props and trees as objects of their own, hidden in place where a nearer level shows them;
//   - L1, mid distance (within R1): each 128 m cell dressed (windows, signs, roofs, poles, trees), baked by
//     tools/tokyo/city-bake.ts and read with `readAsset`;
//   - L0, street level (within R0): the same cells dressed in full (doors, shops, clutter, wires, props).
// What repeats (windows, gratings, street models, props) is the kit's (kit.bin): each piece's geometry once, a cell's
// copies of it one instanced mesh a material. A cell's level arrives in place, a frame budget at a time (its meshes,
// its trees, its kit pieces, then what emits, together); the level it replaces goes when it is complete.
//
// Room id: "tokyo-night" | "tokyo-day" | "tokyo-dusk", with "-at=x,z" or "-at=x,y,z" (where to start; the first cells
// load with the scene), "-look=yaw,pitch" (degrees) and "-tour" (the camera flies a set path: clips and benchmarks).
// Controls (pointer "look": click to capture, Esc to let go): mouse to look, W A S D to move, Space / E up, C / Q down,
// Shift faster, the wheel scales the speed. T cycles day/dusk/night, or 1/2/3 selects a preset; M switches the
// denoiser (MetalFX / ThreeRT; room suffix "-builtin" starts with ThreeRT's).
import { DirectionalLight, GLTFModel, Group, Mesh, MaterialFunction, MeshStandardMaterial, readAsset, rendering, PerspectiveCamera, InstancedMesh, PlaneGeometry, Scene, SurfaceMaterial, BufferGeometry, wetLayer, type Object3D } from "@threert/scene";
import { defineGame, type FrameContext } from "@threert/gameplay";
import { tokyoSky } from "./sky.ts";
import { finishMap } from "./hero/finish.ts";
import { heroMaterials } from "./hero/materials.ts";
import { propMaterials } from "./hero/props.ts";
import { streetMaterials } from "./hero/street.ts";
import { streetPropMaterials } from "./hero/streetprops.ts";
import { MODELS } from "./hero/dress.ts";
import { SHOP_PAGES } from "./hero/shops.ts";
import type { V3 } from "./hero/builder.ts";
import far from "../assets/city/glb/shinjuku-far/index.json";
import baked from "../assets/city/baked/shinjuku/index.json";

const AREA = "shinjuku";
/** The baked cells and their kit (tools/tokyo/city-bake.ts). */
const BAKED = `assets/city/baked/${AREA}`;
const CELL = 128;
/** Level radii (m, from the camera to the cell's box) and the margin a level is kept beyond them. */
let KEEP = 50;
let R0 = 140, R1 = 480;
/** Triangles added in place per frame (the commit pays ~80 ns a triangle), and the frame script's time for it (ms). */
const FRAME_TRIS = 50_000, FRAME_MS = 5, FRAME_OBJECTS = 30;

/** A cell: the level it shows and the group that holds it (two for L0: a time-of-day change loads the cell again
 *  in the other one while this one shows), the night its L0 was made for, the level loading. */
type Cell = { i: number; j: number; level: number; roots: [Group, Group, Group]; shown: Group | null; night: boolean; loading: Job | null };
type Job = { level: number; night: boolean; path: string; meshes: { material: string; v: number; i: number; at: number; emits: boolean }[]; placements: Placement[]; kit: { k: number; n: number; at: number }[]; kitLit: { k: number; n: number; at: number }[]; off: number; k: number; p: number; q: number; root: Group };
type Placement = { m: string; at: V3; ry: number; s: number } | { p: string; v: number; at: V3; ry: number };

const engine = { readAsset };

// ---------------------------------------------------------------- the world as the scene keeps it
let lib = new Map<string, MeshStandardMaterial>();
// The L1 glow is visible to the camera and in mirrors. Only close emitters enter the light sampler.
// By day a room behind a window (`Room`: its nits) is its picture at a daylight interior's brightness and takes no light
// itself: the only light it could take is the sky's through the pane, which a path finds by chance (a black window
// that sparkles from frame to frame). Not a light either: nothing in it enters the light sampler.
const midOf = new Map<MeshStandardMaterial, MeshStandardMaterial>();
const midGlow = new MaterialFunction("TokyoMidGlow", {
  params: { IsNight: 0, DayNits: 0, NightNits: 0, Tint: [1, 1, 1, 0], Room: 0 },
  textures: ["Glow"],
  code: `
    let light = msample_color(m, i, $Glow, i.uv, exp2(i.uvd)).rgb * $Tint.rgb;
    if ($IsNight > 0.5) {
      if ($NightNits > 0.0) {
        o.base = vec3<f32>(0.0); o.specular = 0.0; o.metallic = 0.0;
        o.emissive = select(vec3<f32>(0.0), light * $NightNits, i.near);
      }
    } else if ($Room > 0.0) {
      o.base = vec3<f32>(0.0); o.specular = 0.0; o.metallic = 0.0;
      o.emissive = light * $Room;
    } else {
      o.emissive = light * $DayNits;
    }`,
});
/** A room's brightness by day (nits): homes and offices with the lights off, shops with theirs on. */
const ROOM_DAY = { room: 1300, shop: 2500 };
// The far tile already has each window, sign and lamp in its night nodes. Keep that geometry resident.
// Unlit glTF materials carry their authored glow as base colour. Restore their daylight surfaces when power is off.
const farWindows = new MaterialFunction("TokyoFarGlass", {
  code: `if (i.power < 0.5) {
    o.base = vec3<f32>(0.02, 0.022, 0.025); o.emissive = vec3<f32>(0.0); o.specular = 0.5;
  }`,
}).with();
const farSigns = new MaterialFunction("TokyoFarSign", {
  code: `if (i.power < 0.5) {
    var paper = vec3<f32>(1.0);
    if (m.tex0.x >= 0) { paper = srgb_to_linear(tex(m.tex0.x, i.uv, i.lod + i.uvd).rgb); }
    o.base = paper; o.emissive = paper * 20.0; o.specular = 0.5;
  }`,
}).with();
// Lawns and hedges (the far ground's grass layer: one colour each, as compiled): leaves. Clumps of light and dark,
// small leaves over them, a bumped surface; a third darker than the compiled colour, which read as painted plastic.
const foliage = new MaterialFunction("TokyoFoliage", {
  helpers: `
fn tk_hash(x: i32, y: i32) -> f32 {
    var v = (bitcast<u32>(x) * 73856093u) ^ (bitcast<u32>(y) * 19349663u);
    v = v * 747796405u + 2891336453u;
    v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
    return f32((v >> 22u) ^ v) * (1.0 / 4294967296.0);
}
fn tk_noise(p: vec2<f32>) -> f32 {
    let c = floor(p);
    let f = p - c;
    let u = f * f * (3.0 - 2.0 * f);
    let x = i32(c.x);
    let y = i32(c.y);
    return mix(mix(tk_hash(x, y), tk_hash(x + 1, y), u.x), mix(tk_hash(x, y + 1), tk_hash(x + 1, y + 1), u.x), u.y);
}`,
  code: `
    // (the face's own plane: the ground's xz, a hedge side's along-and-up)
    let side = vec3<f32>(i.ng.z, 0.0, -i.ng.x);
    let q = select(vec2<f32>(dot(i.wp, side), i.wp.y), i.wp.xz, abs(i.ng.y) > 0.5);
    let clump = tk_noise(q * 0.9) * 0.6 + tk_noise(q * 2.3) * 0.4;
    let leaf = tk_noise(q * 47.0) * 0.6 + tk_noise(q * 113.0) * 0.4;
    let e = 0.01;
    let dx = tk_noise((q + vec2<f32>(e, 0.0)) * 47.0) - tk_noise(q * 47.0);
    let dy = tk_noise((q + vec2<f32>(0.0, e)) * 47.0) - tk_noise(q * 47.0);
    let tone = (0.7 + 0.3 * clump) * (0.86 + 0.22 * leaf);
    let yellow = smoothstep(0.55, 0.95, tk_noise(q * 0.4 + vec2<f32>(7.3, 1.9)));
    o.base = o.base * 0.68 * tone * mix(vec3<f32>(1.0), vec3<f32>(1.25, 1.15, 0.75), yellow * 0.5);
    o.roughness = 0.85;
    o.specular = 0.35;
    o.normal = tangent_normal(i, normalize(vec3<f32>(-dx * 6.0, -dy * 6.0, 1.0)));`,
}).with();
const TIMES = {
  day: { elevation: 38, azimuth: 247.5, ev: 11.5 },
  dusk: { elevation: 3, azimuth: 250, ev: 8.5 },
  night: { elevation: -40, azimuth: 0, ev: 3.2 },
} as const;
type Time = keyof typeof TIMES;
let time: Time = "night";
let sun: DirectionalLight;
// A material that glows less by day has a daytime twin at that glow (none, for most: then it is no light at all). The
// near meshes drawn with it take the twin by day: a light kept in the sampler at no power still costs every streamed
// cell a light-tree update. (So a change between night and day loads the near cells again, the nearest first.)
const dayOf = new Map<MeshStandardMaterial, MeshStandardMaterial>();
const lit = (m: MeshStandardMaterial) => (time === "night" ? m : dayOf.get(m) ?? m);
const cells = new Map<string, Cell>();
/** Far objects by tile and quadrant: buildings (with their lit windows and signs) and trees. */
type FarQuadrant = { covered: boolean; base: GLTFModel | null; lights: GLTFModel | null };
const farQ = new Map<string, FarQuadrant>();
let scene: Scene;
const cam = { pos: [0, 0, 0] as V3, yaw: 0, pitch: 0, speed: 6 };

function ascii(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i++) if (b[i]) s += String.fromCharCode(b[i]);
  return s;
}

/** A cell's level: its header now, its meshes a few at a time (ranged reads: the rest of the file is not read yet). */
function startJob(c: Cell, level: number): Job | null {
  const path = `${BAKED}/L${level}/c_${c.i}_${c.j}.bin`;
  let n: number;
  try {
    n = new DataView(engine.readAsset(path, 0, 8)).getUint32(4, true);
  } catch {
    return null;
  }
  const head = JSON.parse(ascii(new Uint8Array(engine.readAsset(path, 8, n))));
  // (each cell keeps a group per level, made with the scene: a group removed rebuilds the scene, its children do not)
  const root = level === 1 ? c.roots[1] : c.shown === c.roots[0] ? c.roots[2] : c.roots[0];
  clear(root);
  // (each mesh's place in the file, then the order to add them: what emits last, all in one frame, since every commit
  // that adds emitters rebuilds the light list over all of them)
  let off = 8 + n;
  // (what emits: at street level as the time of day has it, by day its twin; the mid level's glow is its shader's,
  // no light. What does not emit goes within the frames' budget: unbudgeted, a cell's lit windows read by day took
  // 50-110 ms of one frame)
  const meshes = (head.meshes as { material: string; v: number; i: number }[]).map((m) => {
    const at = off, mat = lib.get(m.material);
    off += m.v * 32 + m.i * 4;
    return { ...m, at, emits: level === 0 && !!mat && emits(lit(mat)) };
  });
  meshes.sort((a, b) => Number(a.emits) - Number(b.emits));
  // (its kit instances after the meshes: 12 floats each)
  const kit = ((head.kit ?? []) as { k: number; n: number }[]).map((e) => { const at = off; off += e.n * 48; return { ...e, at }; });
  return { level, night: time === "night", path, meshes, placements: head.placements, kit, kitLit: [], off: 8 + n, k: 0, p: 0, q: 0, root };
}

/** Adds the job's next meshes and placements within the frame's budget (they show as they come: for a few frames the
 *  level they replace shows with them); true when the job is complete. */
function step(job: Job, budget: { tris: number; until: number; objects: number }): boolean {
  while (job.k < job.meshes.length && (budget.tris > 0 && Date.now() < budget.until || job.meshes[job.k].emits)) {
    const m = job.meshes[job.k];
    // (the emitting ones wait until the rest are in, then go together)
    if (m.emits && (job.k === 0 || !job.meshes[job.k - 1].emits) && (job.p < job.placements.length || job.q < job.kit.length)) break;
    // (and with them the kit's that emit)
    if (m.emits && (job.k === 0 || !job.meshes[job.k - 1].emits) && job.kitLit.length) {
      for (const e of job.kitLit) addKit(job, e);
      job.kitLit = [];
    }
    job.k++;
    const bytes = m.v * 32 + m.i * 4;
    const buf = engine.readAsset(job.path, m.at, bytes);
    const pos = new Float32Array(buf, 0, m.v * 3);
    const nor = new Float32Array(buf, m.v * 12, m.v * 3);
    const uv = new Float32Array(buf, m.v * 24, m.v * 2);
    const idx = new Uint32Array(buf, m.v * 32, m.i);
    const mat = lib.get(m.material);
    if (!mat) continue;
    const g = new BufferGeometry();
    g.positions = pos;
    g.normals = nor;
    g.uvs = uv;
    g.index = idx;
    job.root.add(new Mesh(g, job.level === 1 ? midOf.get(mat) ?? mat : lit(mat)));
    budget.tris -= m.i / 3;
  }
  let n = 0;
  while (job.p < job.placements.length && n < budget.objects && Date.now() < budget.until) {
    for (const o of place(job.placements[job.p++])) job.root.add(o);
    n++;
  }
  // the kit's pieces where the cell has them: one object per piece and material, its copies instances (those that
  // emit kept for the frame the cell's emitters go in)
  while (job.p >= job.placements.length && job.q < job.kit.length && n < budget.objects && Date.now() < budget.until) {
    const e = job.kit[job.q++];
    const piece = kitPiece(e.k);
    if (!piece) continue;
    if (job.level === 0 && piece.some((part) => emits(lit(part.material)))) {
      job.kitLit.push(e);
      continue;
    }
    n += addKit(job, e);
    budget.tris -= e.n * 4;
  }
  // (a cell without emitting meshes: the kit's that emit now)
  if (job.q >= job.kit.length && job.k >= job.meshes.length && job.kitLit.length) {
    for (const e of job.kitLit) addKit(job, e);
    job.kitLit = [];
  }
  return job.k >= job.meshes.length && job.p >= job.placements.length && job.q >= job.kit.length && !job.kitLit.length;
}

/** A kit entry of a cell's: its copies' frames read, an instanced mesh per material of the piece. The objects made. */
function addKit(job: Job, e: Job["kit"][number]) {
  const piece = kitPiece(e.k);
  if (!piece) return 0;
  {
    const src = new Float32Array(engine.readAsset(job.path, e.at, e.n * 48));
    const m = new Float32Array(e.n * 16);
    for (let i = 0; i < e.n; i++) {
      const a = i * 12, o = i * 16;
      m[o] = src[a]; m[o + 1] = src[a + 1]; m[o + 2] = src[a + 2];
      m[o + 4] = src[a + 3]; m[o + 5] = src[a + 4]; m[o + 6] = src[a + 5];
      m[o + 8] = src[a + 6]; m[o + 9] = src[a + 7]; m[o + 10] = src[a + 8];
      m[o + 12] = src[a + 9]; m[o + 13] = src[a + 10]; m[o + 14] = src[a + 11]; m[o + 15] = 1;
    }
    // (one object a material: an instanced mesh draws with one; by level and time as the cells' meshes are)
    for (const part of piece) {
      const inst = new InstancedMesh(part.geometry, job.level === 1 ? midOf.get(part.material) ?? part.material : lit(part.material), e.n);
      inst.instanceMatrix.array.set(m);
      job.root.add(inst);
    }
    return piece.length;
  }
}

// ---------------------------------------------------------------- the kit: repeated elements, one mesh each
/** The kit's pieces as the file lists them (their parts' materials and sizes, where their data is), and the geometry of
 *  those a cell has placed (one geometry each, a group per material: every copy of it in every cell shares it). */
let kitIndex: { parts: { material: string; v: number; i: number }[]; at: number }[] = [];
const kitMade = new Map<number, { geometry: BufferGeometry; material: MeshStandardMaterial }[] | null>();
function loadKit() {
  const path = `${BAKED}/kit.bin`;
  let n: number;
  try {
    n = new DataView(engine.readAsset(path, 0, 8)).getUint32(4, true);
  } catch {
    kitIndex = [];
    return;
  }
  const head = JSON.parse(ascii(new Uint8Array(engine.readAsset(path, 8, n)))) as { pieces: { material: string; v: number; i: number }[][] };
  let off = 8 + n;
  kitIndex = head.pieces.map((parts) => {
    const at = off;
    for (const p of parts) off += p.v * 32 + p.i * 4;
    return { parts, at };
  });
}
function kitPiece(k: number) {
  if (kitMade.has(k)) return kitMade.get(k)!;
  const e = kitIndex[k];
  let made: { geometry: BufferGeometry; material: MeshStandardMaterial }[] | null = null;
  if (e) {
    const buf = engine.readAsset(`${BAKED}/kit.bin`, e.at, e.parts.reduce((s, p) => s + p.v * 32 + p.i * 4, 0));
    made = [];
    let o = 0;
    for (const p of e.parts) {
      const material = lib.get(p.material);
      if (material) {
        const g = new BufferGeometry();
        g.positions = new Float32Array(buf, o, p.v * 3);
        g.normals = new Float32Array(buf, o + p.v * 12, p.v * 3);
        g.uvs = new Float32Array(buf, o + p.v * 24, p.v * 2);
        g.index = new Uint32Array(buf, o + p.v * 32, p.i);
        made.push({ geometry: g, material });
      }
      o += p.v * 32 + p.i * 4;
    }
  }
  kitMade.set(k, made);
  return made;
}

/** A placement (a tree: the street models and props are the kit's) as its model, turned and moved to the place. */
function place(p: Placement): Object3D[] {
  if (!("m" in p)) return [];
  const m = MODELS[p.m];
  if (!m) return [];
  const model = new GLTFModel(m.uri);
  model.position.set(...p.at);
  model.rotation.y = p.ry;
  model.scale.setScalar(p.s);
  return [model];
}

function emits(m?: MeshStandardMaterial) {
  return !!m && m.emissiveIntensity > 0 && m.emissive.r + m.emissive.g + m.emissive.b > 0;
}

const fmod = (a: number, b: number) => ((a % b) + b) % b;
/** The far tile and quadrant a cell lies in. */
const farKey = (i: number, j: number) => `${Math.floor(i / 2)}_${Math.floor(j / 2)}_${fmod(i, 2) + 2 * fmod(j, 2)}`;

function setFar(c: Cell) {
  const f = farQ.get(farKey(c.i, c.j));
  if (!f) return;
  // (moved out of sight rather than hidden: an object hidden when the scene is rebuilt is left out of it, and showing it
  // again would rebuild the scene once more)
  f.covered = c.level >= 0;
  if (f.base) f.base.position.y = f.covered ? -10000 : 0;
  if (f.lights) {
    f.lights.position.y = f.covered ? -10000 : 0;
    f.lights.power = !f.covered && time === "night" ? 1 : 0;
  }
}

/** Shows a finished job's objects, removes the level it replaces. */
/** Objects to take out, a few hundred a frame (each removal costs the sync and the engine): a level retired. */
const retiring: Object3D[] = [];
function clear(g: Group) {
  for (const o of g.children) retiring.push(o);
}
function retire(n: number) {
  for (let k = 0; k < n && retiring.length; k++) {
    const o = retiring.pop()!;
    o.parent?.remove(o);
  }
}

function finish(c: Cell, job: Job) {
  if (c.shown && c.shown !== job.root) clear(c.shown);
  c.shown = job.root;
  c.night = job.night;
  c.level = job.level;
  c.loading = null;
  setFar(c);
}

function unload(c: Cell) {
  for (const g of c.roots) clear(g);
  c.shown = null;
  c.loading = null;
  c.level = -1;
  setFar(c);
}

function boxDist(c: Cell, x: number, z: number) {
  const x0 = c.i * CELL, z0 = c.j * CELL;
  const dx = Math.max(x0 - x, 0, x - (x0 + CELL)), dz = Math.max(z0 - z, 0, z - (z0 + CELL));
  return Math.hypot(dx, dz);
}

/** The level a cell should show from here, with hysteresis against its current one. */
function want(c: Cell, x: number, y: number, z: number) {
  const d = Math.hypot(boxDist(c, x, z), Math.max(0, y - 60) * 0.7);
  const cur = c.loading?.level ?? c.level;
  if (d < R0 || (cur === 0 && d < R0 + KEEP)) return 0;
  if (d < R1 || (cur === 1 && d < R1 + KEEP)) return 1;
  return -1;
}

/** One frame of streaming: retire what is out of range, then load the nearest cell whose level is wrong. */
function stream(x: number, y: number, z: number, budget: { tris: number; until: number; objects: number }) {
  // the job in progress, if its cell still wants it
  for (const c of cells.values()) {
    if (!c.loading) continue;
    if (want(c, x, y, z) !== c.loading.level || c.loading.night !== (time === "night") && c.loading.level === 0) {
      if (c.loading.root !== c.shown) clear(c.loading.root);
      c.loading = null;
      continue;
    }
    if (step(c.loading, budget)) finish(c, c.loading);
    return;
  }
  // out of range: back to far
  for (const c of cells.values()) if (c.level >= 0 && want(c, x, y, z) < 0) unload(c);
  // the nearest cell that needs another level
  let best: Cell | null = null, bd = Infinity;
  for (const c of cells.values()) {
    const w = want(c, x, y, z);
    if (w < 0 || (w === c.level && (w === 1 || c.night === (time === "night")))) continue;
    const d = boxDist(c, x, z) + (w === 0 ? -50 : 0);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) {
    best.loading = startJob(best, want(best, x, y, z));
    // (no file: nothing to show at that level)
    if (!best.loading) { best.level = want(best, x, y, z); best.night = time === "night"; }
    else if (step(best.loading, budget)) finish(best, best.loading);
  }
}

// ---------------------------------------------------------------- the tour (clips, benchmarks)
const TOUR: [number, number, number, number, number][] = [
  // t (s), x, y, z, look yaw (degrees from +x toward +z)
  [0, 359.8, 32.3, -496.6, 22], [12, 376, 32.3, -489.8, 22], [18, 392, 40, -484, 10], [26, 430, 90, -520, -60],
  [40, 300, 140, -700, -120], [55, 0, 160, -400, 170], [70, -300, 120, -100, 160], [85, -650, 220, 120, 120],
];
function tourAt(t: number): { pos: V3; yaw: number } {
  const T = TOUR;
  let k = 0;
  while (k + 2 < T.length && T[k + 1][0] <= t) k++;
  const a = T[k], b = T[k + 1], u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
  const s = u * u * (3 - 2 * u);
  return { pos: [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s], yaw: (a[4] + (b[4] - a[4]) * s) * (Math.PI / 180) };
}

// ---------------------------------------------------------------- measurement (tools/tokyo/quality.ts)
// Events a script sends to hold the city at a pose and compare frames ("event" commands of `threert-render live`):
//   pose {pos: [x, y, z], yaw, pitch} (degrees): the camera there (a tour stops); radii {r0, r1, keep} (m): the level
//   radii and their hysteresis; hold: the camera and the streaming stop where they are (a tour's pose is logged);
//   settle: every cell to its level now, whole (logged "tokyo: settled" when done).
let held = false;
function settle() {
  for (let n = 0; n < 100_000; n++) {
    let busy = false;
    for (const c of cells.values()) if (c.loading || (want(c, ...cam.pos) >= 0 && want(c, ...cam.pos) !== c.level) || (c.level >= 0 && want(c, ...cam.pos) < 0)) busy = true;
    if (!busy) break;
    stream(cam.pos[0], cam.pos[1], cam.pos[2], { tris: Infinity, until: Infinity, objects: Infinity });
  }
  retire(Infinity);
  const n = [0, 1].map((l) => [...cells.values()].filter((c) => c.level === l).length);
  console.log(`tokyo: settled with ${n[0]} cells at L0, ${n[1]} at L1 (r0 ${R0}, r1 ${R1}, keep ${KEEP})`);
}
const deg = (r: number) => +(r * 180 / Math.PI).toFixed(3);

// ---------------------------------------------------------------- the scene
let tour = false;
function collectMaterials(M: ReturnType<typeof heroMaterials>, P: ReturnType<typeof propMaterials>, night: boolean) {
  const materials = new Map<string, MeshStandardMaterial>();
  const collect = (v: unknown, depth = 0) => {
    if (v instanceof MeshStandardMaterial) { if (!materials.has(v.name)) materials.set(v.name, v); return; }
    if (depth > 3 || !v || typeof v !== "object") return;
    for (const x of Object.values(v)) collect(x, depth + 1);
  };
  collect(M);
  collect(P);
  for (let p = 0; p < SHOP_PAGES; p++) collect(M.shop(p));
  collect(streetMaterials());
  collect(streetPropMaterials(night));
  return materials;
}

// The denoiser: the device's joint denoiser (it removes the noise and upscales in one pass: steadier on sunlit walls than
// ThreeRT's own at the same cost), MetalFX's on a Mac, DLSS Ray Reconstruction on an RTX GPU, else ThreeRT's. M switches
// between it and ThreeRT's.
let metalfx = true;
function setDenoiser(on: boolean) {
  metalfx = on;
  rendering.set({ reconstruction: on ? ["metalfx-denoised", "dlss-rr", "builtin"] : "builtin" });
  console.log(`Tokyo · denoiser ${on ? "the device's (MetalFX / DLSS-RR, where available)" : "ThreeRT"} · M to switch`);
}

function setTime(next: Time, camera: PerspectiveCamera) {
  const wasNight = time === "night";
  time = next;
  const night = time === "night";
  const preset = TIMES[time];
  sun.setSunAngles(preset.elevation, preset.azimuth);
  camera.setManualExposure(preset.ev);
  scene.wetness = night ? 1 : 0;
  if (wasNight !== night) {
    for (const mat of midOf.values()) {
      const binding = mat.shader!;
      mat.shader = midGlow.with({ ...binding.params, IsNight: night ? 1 : 0 }, binding.textures);
    }
    for (const f of farQ.values()) if (f.lights && !f.covered) f.lights.power = night ? 1 : 0;
  }
  console.log(`Tokyo · ${time} · 1 Day / 2 Dusk / 3 Night / T Cycle`);
}

export function sceneFor(room: string) {
  const requested = room.split("-")[1];
  time = requested === "day" || requested === "dusk" ? requested : "night";
  const night = time === "night";
  tour = room.includes("-tour");
  // "-lowmem": for a GPU of 8 GB (an RTX laptop's): the mid level to 320 m, the far level without its props and trees
  // (18 % of the resident acceleration structures; past a few hundred metres they are a pixel or less)
  const lowmem = room.includes("-lowmem");
  R1 = lowmem ? 320 : 480;
  R0 = 140;
  // ("-r0=m", "-r1=m": the near and mid levels' radii)
  const r0 = /-r0=(\d+)/.exec(room), r1 = /-r1=(\d+)/.exec(room);
  if (r0) R0 = Number(r0[1]);
  if (r1) R1 = Number(r1[1]);
  setDenoiser(!room.includes("-builtin"));
  const at = /-at=(-?[\d.]+),(-?[\d.]+)(?:,(-?[\d.]+))?/.exec(room);
  const look = /-look=(-?[\d.]+),(-?[\d.]+)/.exec(room);
  cells.clear();
  farQ.clear();
  dayOf.clear();
  midOf.clear();
  kitMade.clear();
  retiring.length = 0;
  scene = new Scene();
  sun = new DirectionalLight(0xfff4e8, 100000);
  scene.add(sun);
  scene.environment = tokyoSky(sun, { dynamic: true });
  const b = far.bounds;
  const land = new Mesh(new PlaneGeometry(200000, 200000), new MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.95 }));
  land.rotation.x = -Math.PI / 2;
  land.position.set((b.minX + b.maxX) / 2, 15, (b.minZ + b.maxZ) / 2);
  scene.add(land);
  // the ground of every tile: its roads in generated asphalt and pavers, wet by night
  const tex = (id: string, size: number) => { const t = finishMap(id, "color"); t.repeat = [1 / size, 1 / size]; return t; };
  const road = (id: string, size: number, puddles: number) => new SurfaceMaterial({ map: tex(id, size), normalMap: finishMap(id, "normal"), roughnessMap: finishMap(id, "rough"), worldScale: size, wet: 1, puddles: { scale: 2.5, amount: puddles }, grime: { amount: 0.3, scale: 3 } });
  const functions = { "road 0 ": road("asphalt", 3.5, 0.2).shader!, "road 1 ": road("pavers", 1.6, 0.12).shader!, "road 2 ": foliage, "road 3 ": road("concrete-worn", 2.5, 0.12).shader!, paint: wetLayer({ puddles: 0.4 }) };
  for (const t of far.tiles) {
    const uri = `assets/city/glb/${AREA}-far/${t.file}`;
    scene.add(new GLTFModel(uri, { nodes: ["ground"], functions }));
    const has = new Set((t as { nodes?: string[] }).nodes ?? []);
    for (let q = 0; q < 4; q++) {
      // (only the nodes the tile has: a model of none draws nothing and cannot be hidden in place)
      const model = (names: string[], lights = false) => {
        const nodes = names.filter((n) => has.has(n));
        if (!nodes.length) return null;
        const m = new GLTFModel(uri, { nodes, ...(lights ? { functions: { "window lit far ": farWindows, "signs night ": farSigns } } : {}) });
        if (lights && !night) m.power = 0;
        scene.add(m);
        return m;
      };
      farQ.set(`${t.x}_${t.z}_${q}`, {
        covered: false,
        base: model(lowmem ? [`b${q}`] : [`b${q}`, `p${q}`, `t${q}`]),
        lights: model([`b${q}-night`, `p${q}-night`], true),
      });
    }
  }
  // the library: every material and model the baked cells use, in the scene from the start (so cells add in place)
  lib = collectMaterials(heroMaterials(true), propMaterials(true), true);
  const daylight = collectMaterials(heroMaterials(false), propMaterials(false), false);
  for (const m of [...lib.values()]) {
    // (rooms behind windows, lit by night or not: their daylight look)
    const room = m.name.startsWith("room ") ? (m.name.includes("shop") ? ROOM_DAY.shop : ROOM_DAY.room) : 0;
    if (!emits(m) && !room) continue;
    const k = emits(m) ? m.emissiveIntensity : 0;
    const day = daylight.get(m.name)?.emissiveIntensity ?? 0;
    const glow = m.emissiveMap ?? m.map;
    // (a room that stays dark by night is a little darker by day too: curtains open, no lamp; its base colour would
    // make it black against a sunlit wall)
    const dim = m.name === "room dark" ? 0.65 : 1;
    const tint: [number, number, number, number] = room ? [dim, dim, dim, 0] : [m.emissive.r, m.emissive.g, m.emissive.b, 0];
    const params = { DayNits: day, NightNits: k, Tint: tint, Room: room };
    if (room) {
      const d = m.clone();
      d.name = `${m.name} ~day`;
      d.emissiveIntensity = 0;
      d.shader = midGlow.with({ ...params, IsNight: 0 }, glow ? { Glow: glow } : {});
      dayOf.set(m, d);
    } else if (day !== k || day > 0) {
      // (by day what still glows, a sign, a signal, a vending machine's front, shows its glow and is no light: in the
      // sun it would light nothing one could see, and every cell streamed in with lights updates the light tree)
      const d = m.clone();
      d.name = `${m.name} ~day`;
      d.emissiveIntensity = 0;
      if (day > 0) d.shader = midGlow.with({ ...params, IsNight: 0 }, glow ? { Glow: glow } : {});
      dayOf.set(m, d);
    }
    const mid = m.clone();
    mid.name = `${m.name} ~mid`;
    mid.emissiveIntensity = 0;
    mid.shader = midGlow.with({ ...params, IsNight: night ? 1 : 0 }, glow ? { Glow: glow } : {});
    midOf.set(m, mid);
    lib.set(mid.name, mid);
  }
  for (const d of dayOf.values()) lib.set(d.name, d);
  const swatch = new BufferGeometry();
  swatch.positions = new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0, 0.01]);
  swatch.normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  swatch.uvs = new Float32Array(6);
  swatch.index = new Uint32Array([0, 1, 2]);
  let k = 0;
  for (const m of lib.values()) {
    const s = new Mesh(swatch, m);
    s.position.set(b.minX + (k++ % 50) * 0.1, -50, b.minZ);
    scene.add(s);
  }
  // the kit's index, and an instanced mesh from the start (the scene's first one rebuilds it: not while streaming)
  loadKit();
  const firstCopies = new InstancedMesh(swatch, lib.values().next().value!, 1);
  firstCopies.position.set(b.minX, -55, b.minZ);
  scene.add(firstCopies);
  for (const [key, m] of Object.entries(MODELS)) {
    const g = new GLTFModel(m.uri);
    g.position.set(b.minX, -60 - Object.keys(MODELS).indexOf(key) * 5, b.minZ);
    scene.add(g);
  }
  // the cells of the baked area
  for (const key of Object.keys((baked as { cells: Record<string, unknown> }).cells)) {
    const [i, j] = key.split("_").map(Number);
    const roots: [Group, Group, Group] = [new Group(), new Group(), new Group()];
    roots.forEach((g, l) => { g.name = `cell ${i} ${j} ${["L0", "L1", "L0b"][l]}`; scene.add(g); });
    cells.set(key, { i, j, level: -1, roots, shown: null, night: time === "night", loading: null });
  }
  // the camera: Golden Gai's middle alley by default
  // ("-at=x,z" at street level, "-at=x,y,z" anywhere)
  const [sx, sy, sz] = at ? (at[3] ? [Number(at[1]), Number(at[2]), Number(at[3])] : [Number(at[1]), 34, Number(at[2])]) : [359.8, 32.3, -496.6];
  cam.pos = [sx, sy, sz];
  cam.yaw = (look ? Number(look[1]) : 22) * Math.PI / 180;
  cam.pitch = look ? Math.max(-1.5, Math.min(1.5, Number(look[2]) * Math.PI / 180)) : 0;
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 30000);
  camera.name = "camera";
  aim(camera);
  setTime(time, camera);
  scene.add(camera);
  // the first cells round the start, whole, so the first frame shows them
  for (let n = 0; n < 100_000; n++) {
    const budget = { tris: Infinity, until: Infinity, objects: Infinity };
    let busy = false;
    for (const c of cells.values()) if (c.loading || (want(c, ...cam.pos) >= 0 && want(c, ...cam.pos) !== c.level)) busy = true;
    if (!busy) break;
    stream(cam.pos[0], cam.pos[1], cam.pos[2], budget);
  }
  console.log(`city: ${far.tiles.length} far tiles, ${cells.size} cells, ${lib.size} materials; started with ${[...cells.values()].filter((c) => c.level === 0).length} cells at L0, ${[...cells.values()].filter((c) => c.level === 1).length} at L1`);
  return { scene, camera, options: { name: `tokyo-city-${time}`, width: 1280, height: 720 } };
}

function aim(camera: PerspectiveCamera) {
  camera.position.set(...cam.pos);
  const c = Math.cos(cam.pitch);
  camera.lookAt(cam.pos[0] + Math.cos(cam.yaw) * c * 10, cam.pos[1] + Math.sin(cam.pitch) * 10, cam.pos[2] + Math.sin(cam.yaw) * c * 10);
}

export default defineGame<Record<string, never>>({
  state: {},
  keys: { "1": "day", "2": "dusk", "3": "night", T: "cycleTime", M: "denoiser" },
  on: {
    denoiser: () => setDenoiser(!metalfx),
    day: (world) => setTime("day", world.camera),
    dusk: (world) => setTime("dusk", world.camera),
    night: (world) => setTime("night", world.camera),
    cycleTime: (world) => setTime(time === "day" ? "dusk" : time === "dusk" ? "night" : "day", world.camera),
    pose: (world, ev: { pos: V3; yaw: number; pitch: number }) => {
      tour = false;
      cam.pos = [...ev.pos];
      cam.yaw = ev.yaw * Math.PI / 180;
      cam.pitch = ev.pitch * Math.PI / 180;
      aim(world.camera);
    },
    radii: (_world, ev: { r0?: number; r1?: number; keep?: number }) => {
      if (ev.r0 !== undefined) R0 = ev.r0;
      if (ev.r1 !== undefined) R1 = ev.r1;
      if (ev.keep !== undefined) KEEP = ev.keep;
    },
    hold: () => {
      tour = false;
      held = true;
      console.log(`tokyo: held at ${cam.pos.map((v) => +v.toFixed(3)).join(",")} look ${deg(cam.yaw)},${deg(cam.pitch)}`);
    },
    settle: () => {
      held = false;
      settle();
    },
  },
  pointer: "look",
  setup(ctx) {
    return sceneFor(ctx.roomId || "tokyo-night");
  },
  frame(f: FrameContext<Record<string, never>>) {
    const dt = f.dt;
    if (tour) {
      const t = tourAt(f.time);
      cam.pos = t.pos;
      cam.yaw = t.yaw;
      cam.pitch = -0.05;
    } else if (dt > 0) {
      const inp = f.input;
      cam.yaw += inp.look.dx;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - inp.look.dy));
      if (inp.wheel) cam.speed = Math.max(0.5, Math.min(400, cam.speed * Math.pow(1.4, inp.wheel)));
      const fast = inp.down("Shift") ? 8 : 1;
      const v = cam.speed * fast * dt;
      const fx = Math.cos(cam.yaw) * Math.cos(cam.pitch), fy = Math.sin(cam.pitch), fz = Math.sin(cam.yaw) * Math.cos(cam.pitch);
      const rx = -Math.sin(cam.yaw), rz = Math.cos(cam.yaw);
      const mv = inp.move;
      const up = (inp.down("Space") || inp.down("E") ? 1 : 0) - (inp.down("C") || inp.down("Q") ? 1 : 0);
      cam.pos = [cam.pos[0] + (fx * mv.y + rx * mv.x) * v, Math.max(18, cam.pos[1] + (fy * mv.y + up) * v), cam.pos[2] + (fz * mv.y + rz * mv.x) * v];
    }
    aim(f.camera);
    if (held) return;
    retire(250);
    stream(cam.pos[0], cam.pos[1], cam.pos[2], { tris: FRAME_TRIS, until: Date.now() + FRAME_MS, objects: FRAME_OBJECTS });
  },
});
