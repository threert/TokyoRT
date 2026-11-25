// Tokyo, the compiled areas (Shinjuku and Shibuya, stitched: `AREAS`), streamed by level of detail around a first-person
// flying camera (ROADMAP § 0 step 2):
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
// load with the scene), "-look=yaw,pitch" (degrees), "-tour" (the camera flies a set path: clips and benchmarks) and
// "-route=drive|expressway|flight" (a benchmark route at its speed, below); "-whole" loads every far tile before the
// first frame (offline stills; live, those past 900 m come after it, the nearest first), "-clock=HH:MM" puts the day
// preset's sun where it stands at that time over Shinjuku (./clock.ts; e.g. "tokyo-day-clock=15:30", 6h's late
// afternoon).
// Controls (pointer "look": click to capture, Esc to let go): mouse to look, W A S D to move, Space / E up, C / Q down,
// Shift faster, the wheel scales the speed. T cycles day/dusk/night, or 1/2/3 selects a preset; M switches the
// denoiser (MetalFX / ThreeRT; room suffix "-builtin" starts with ThreeRT's).
import { facadeWindows, DataTexture, DirectionalLight, preloadModel, GLTFModel, Group, Mesh, MaterialFunction, MeshStandardMaterial, readAsset, rendering, PerspectiveCamera, InstancedMesh, PlaneGeometry, Scene, SurfaceMaterial, BufferGeometry, wetLayer, type Object3D } from "@threert/scene";
import { defineGame, type FrameContext } from "@threert/gameplay";
import { tokyoSky } from "./sky.ts";
import { clockSun, parseClock } from "./clock.ts";
import { finishMap } from "./hero/finish.ts";
import { heroMaterials } from "./hero/materials.ts";
import { propMaterials } from "./hero/props.ts";
import { streetMaterials } from "./hero/street.ts";
import { streetPropMaterials } from "./hero/streetprops.ts";
import { MODELS } from "./hero/dress.ts";
import { SHOP_PAGES } from "./hero/shops.ts";
import type { V3 } from "./hero/builder.ts";
import shinjukuFar from "../assets/city/glb/shinjuku-far/index.json";
import shinjukuBaked from "../assets/city/baked/shinjuku/index.json";
import shibuyaFar from "../assets/city/glb/shibuya-far/index.json";
import shibuyaBaked from "../assets/city/baked/shibuya/index.json";
import ROUTES from "../assets/city/routes.json";

type FarIndex = { bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; tiles: { x: number; z: number; file: string; nodes?: string[] }[] };
/** An area: compiled and baked in its own frame (tools/city: metres east and south of its own origin), placed in the
 *  city's (Shinjuku's) by its origin's offset (tools/tokyo/stitch.ts `offsetOf`, which the tools place the routes, the
 *  viaducts and the city beyond by). Its cells (the baked level, tools/tokyo/city-bake.ts) and their kit; its far
 *  tiles (their terrain stops at the seam). */
type Area = { name: string; far: FarIndex; cells: string[]; ox: number; oz: number; kitIndex: { parts: { material: string; v: number; i: number }[]; at: number }[]; kitMade: Map<number, KitPiece | null> };
type KitPiece = { geometry: BufferGeometry; material: MeshStandardMaterial }[];
const area = (name: string, far: unknown, baked: unknown, ox: number, oz: number): Area =>
  ({ name, far: far as FarIndex, cells: Object.keys((baked as { cells: Record<string, unknown> }).cells), ox, oz, kitIndex: [], kitMade: new Map() });
const AREAS = [area("shinjuku", shinjukuFar, shinjukuBaked, 0, 0), area("shibuya", shibuyaFar, shibuyaBaked, -4.526, 3341.912)];
const baked = (a: Area) => `assets/city/baked/${a.name}`;
const CELL = 128;
/** Level radii (m, from the camera to the cell's box) and the margin a level is kept beyond them. */
let KEEP = 50;
let R0 = 140, R1 = 480;
/** Triangles added in place per frame (the commit pays ~80 ns a triangle), and the frame script's time for it (ms). */
const FRAME_TRIS = 50_000, FRAME_MS = 5, FRAME_OBJECTS = 30;

/** A cell: the level it shows and the group that holds it (two for L0: a time-of-day change loads the cell again
 *  in the other one while this one shows), the night its L0 was made for, the level loading. */
type Cell = { a: Area; i: number; j: number; level: number; roots: [Group, Group, Group]; shown: Group | null; night: boolean; loading: Job | null };
type Job = { a: Area; level: number; night: boolean; path: string; meshes: { material: string; v: number; i: number; at: number; emits: boolean }[]; placements: Placement[]; kit: { k: number; n: number; at: number }[]; kitLit: { k: number; n: number; at: number }[]; off: number; k: number; p: number; q: number; root: Group };
type Placement = { m: string; at: V3; ry: number; s: number } | { p: string; v: number; at: V3; ry: number };

const engine = { readAsset };

// ---------------------------------------------------------------- the world as the scene keeps it
let lib = new Map<string, MeshStandardMaterial>();
// The L1 glow is visible to the camera and in mirrors. Only close emitters enter the light sampler.
// By day a room behind a window (`Room`: its nits) is its picture at a daylight interior's brightness and takes no light
// itself: the only light it could take is the sky's through the pane, which a path finds by chance (a black window
// that sparkles from frame to frame). Not a light either: nothing in it enters the light sampler.
const midOf = new Map<MeshStandardMaterial, MeshStandardMaterial>();
// A room by day is a box behind the glass (interior mapping): a ray from the eye through the window, in the window's own
// frame (u across, up, into the wall), meets the room's back wall (the atlas's room or office picture), its side walls,
// floor or ceiling, or a piece of furniture standing in it; lit from the window, darker deeper in. A window's cell of
// the blinds atlas (hero-textures.ts blinds(): 0 shoji, 1 venetian blind, 2/4/5 curtains with a gap, 3 lace, 6 an
// office, 7 a room's back wall) says what is at the glass: screens stay, curtains part on the room, lace shows it
// faintly. Each window its own room (hashed on where it stands).
const ROOM_HELPERS = `
fn tk_rh(p: vec3<f32>) -> f32 { return fract(sin(dot(p, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453); }
fn tk_room(m: Material, i: MatIn, cell: f32, x: f32, y: f32, seed: f32, glow: u32) -> vec3<f32> {
    let nf = i.ng;
    let rd = -i.view;
    let rx = dot(rd, i.t);
    let ry = dot(rd, i.b);
    let rz = max(dot(i.view, nf), 0.05);
    // the room: 2 windows wide, its floor 0.7 window-heights under the sill, 2.2 deep (window heights)
    let bar0 = cell > 7.5;
    // (a bar's or a shop's front is a whole storey with its counter just behind: the back wall close, filling the glass,
    // dark wood round it; a home's room 2-3 windows deep)
    let x0 = select(-0.5 - seed * 0.4, -0.25 - seed * 0.15, bar0);
    let x1 = select(1.5 + fract(seed * 7.3) * 0.4, 1.25 + fract(seed * 7.3) * 0.15, bar0);
    let y0 = select(-0.7, -0.05, bar0);
    let y1 = select(1.35, 1.15, bar0);
    let D = select(1.8 + fract(seed * 3.1) * 1.0, 0.35 + fract(seed * 3.1) * 0.2, bar0);
    let tx = select((x0 - x) / min(rx, -1e-4), (x1 - x) / max(rx, 1e-4), rx > 0.0);
    let ty = select((y0 - y) / min(ry, -1e-4), (y1 - y) / max(ry, 1e-4), ry > 0.0);
    let tz = D / rz;
    var t = min(tz, min(tx, ty));
    let hx = x + rx * t;
    let hy = y + ry * t;
    let hz = rz * t;
    var col: vec3<f32>;
    let office = cell > 5.5 && cell < 6.5;
    let bar = cell > 7.5;
    if (tz <= tx && tz <= ty) {
        // the back wall: the room's (or office's, or bar's) picture across the room's width
        let u = clamp((hx - x0) / (x1 - x0), 0.02, 0.98);
        let v = clamp(1.0 - (hy - y0) / (y1 - y0), 0.02, 0.98);
        if (bar) {
            col = msample_color(m, i, glow, vec2<f32>((cell - 8.0 + u) / 4.0, v), exp2(i.uvd)).rgb;
        } else {
            let c = select(7.0, 6.0, office);
            col = msample_color(m, i, glow, vec2<f32>((c + u) / 8.0, v), exp2(i.uvd)).rgb;
        }
    } else if (ty < tx) {
        if (ry < 0.0) {
            // the floor: boards (a home, a bar's darker), grey carpet tiles (an office)
            let board = 0.85 + 0.15 * step(0.5, fract(hz * 2.6 + floor(hx * 4.0) * 0.37));
            col = select(vec3<f32>(0.32, 0.22, 0.14) * board, vec3<f32>(0.3, 0.31, 0.32), office);
            if (bar) { col = vec3<f32>(0.08, 0.055, 0.04) * board; }
        } else {
            // the ceiling: an office's light panels; a bar's dark boards and a warm lamp
            let panel = office && fract(hz * 1.2) < 0.35 && fract(hx * 1.5) < 0.6;
            col = select(vec3<f32>(0.8, 0.79, 0.75), vec3<f32>(3.0, 3.0, 2.9), panel);
            if (bar) {
                let lamp = length(vec2<f32>(fract(hx * 0.9) - 0.5, fract(hz * 0.8) - 0.5)) < 0.12;
                col = select(vec3<f32>(0.2, 0.15, 0.11), vec3<f32>(4.0, 2.8, 1.6), lamp);
            }
        }
    } else {
        col = select(vec3<f32>(0.74, 0.69, 0.6), vec3<f32>(0.7, 0.72, 0.72), office) * (0.85 + 0.15 * fract(seed * 11.0));
        if (bar) { col = vec3<f32>(0.16, 0.1, 0.06) * (0.8 + 0.3 * fract(seed * 11.0)); }
    }
    // furniture standing in the room: a low card (a sofa, a desk, a counter) and a tall one (a shelf, a wardrobe); not in
    // a bar or a shop (its picture has its counter and its people)
    for (var k = 0; k < select(2, 0, bar); k++) {
        let kf = f32(k);
        let zc = D * (0.35 + 0.3 * fract(seed * (5.7 + kf * 3.3)));
        let tc = zc / rz;
        if (tc < t) {
            let cx = x + rx * tc;
            let cy = y + ry * tc;
            let a = x0 + (x1 - x0) * fract(seed * (2.3 + kf * 1.9)) * 0.7;
            let w = 0.5 + 0.6 * fract(seed * (8.1 + kf));
            let top = y0 + select(0.55, 1.45, k == 1) * (0.8 + 0.4 * fract(seed * (4.4 + kf)));
            if (cx > a && cx < a + w && cy < top) {
                t = tc;
                col = select(vec3<f32>(0.16, 0.12, 0.1), vec3<f32>(0.28, 0.2, 0.14), k == 1) * (0.7 + 0.6 * fract(seed * (9.0 + kf)));
            }
        }
    }
    // lit from the window: brighter near it and on the floor by it, darker deeper in
    let depth = rz * t;
    return col * (0.35 + 0.65 * exp(-depth * 0.55));
}`;
const midGlow = new MaterialFunction("TokyoMidGlow", {
  params: { IsNight: 0, DayNits: 0, NightNits: 0, Tint: [1, 1, 1, 0], Room: 0, Bar: 0 },
  textures: ["Glow"],
  helpers: ROOM_HELPERS,
  code: `
    let light = msample_color(m, i, $Glow, i.uv, exp2(i.uvd)).rgb * $Tint.rgb;
    if ($IsNight > 0.5) {
      if ($NightNits > 0.0) {
        o.base = vec3<f32>(0.0); o.specular = 0.0; o.metallic = 0.0;
        o.emissive = select(vec3<f32>(0.0), light * $NightNits, i.near);
      }
    } else if ($Room > 0.0) {
      o.base = vec3<f32>(0.0); o.specular = 0.0; o.metallic = 0.0;
      // (the window's cell of the atlas, and where in it: u across the cell, v down)
      let cu = i.uv.x * 8.0;
      let cell = floor(cu);
      let x = clamp(fract(cu), 0.0, 1.0);
      let y = clamp(1.0 - i.uv.y, 0.0, 1.0);
      var pic = light;
      if ($Bar > 0.5 && i.near) {
        // a bar's or a shop's inside (interior.png: 4 cells, each a back wall of shelves and a counter)
        let bu = i.uv.x * 4.0;
        let seed = tk_rh(floor(i.op * 2.0) + vec3<f32>(floor(bu), 3.0, 0.0));
        pic = tk_room(m, i, 8.0 + floor(bu), clamp(fract(bu), 0.0, 1.0), y, seed, $Glow) * $Tint.rgb;
      } else if (cell > 1.5 && i.near) {
        let seed = tk_rh(floor(i.op * 2.0) + vec3<f32>(cell, 0.0, 0.0));
        let room = tk_room(m, i, cell, x, y, seed, $Glow) * $Tint.rgb;
        let lum = dot(pic, vec3<f32>(0.2126, 0.7152, 0.0722)) / max(dot($Tint.rgb, vec3<f32>(0.333)), 0.05);
        if (cell > 5.5) { pic = room; }
        else if (cell > 2.5 && cell < 3.5) { pic = mix(room, pic, 0.45); }
        else { pic = mix(pic, room, smoothstep(0.82, 0.92, lum)); }
      }
      o.emissive = pic * $Room;
    } else {
      o.emissive = light * $DayNits;
    }`,
});
/** A room's brightness by day (nits): homes and offices with the lights off, bars and shops with theirs on. Dimmer than
 *  the street, as a room is: the glass's reflection of the street and the sky leads, the room shows through it where it
 *  is lit (at 1300 a window read as a flat, light picture, its reflection lost). */
const ROOM_DAY = { room: 300, bar: 1200, shop: 2000 };
// The far tile already has each window, sign and lamp in its night nodes. Keep that geometry resident.
// Unlit glTF materials carry their authored glow as base colour. Restore their daylight surfaces when power is off.
// By day a far window is the pane in front of a room, as the near levels' windows are: the room at the brightness it has
// there through the glass (`customData[0]`, nits: 0 by night, when the lit ones are the night nodes' own), so a building
// does not change its tone between the mid level and the far one. Live: the time of day sets it on the far models.
const farWindows = new MaterialFunction("TokyoFarGlass", {
  code: `if (i.power < 0.5) {
    o.base = vec3<f32>(0.02, 0.022, 0.025); o.specular = 0.5;
    o.emissive = vec3<f32>(1.0, 0.93, 0.82) * i.custom.x;
  }`,
}).with();
const farRooms = new MaterialFunction("TokyoFarRoom", {
  code: `o.emissive = vec3<f32>(1.0, 0.93, 0.82) * i.custom.x;`,
}).with();
/** A far window's room by day (nits, through its pane): set where the skyline's 480 m switch changed least (0, 150,
 *  300, 500 nits: mean ΔE 0.68, 0.63, 0.60, 0.59). */
const FAR_ROOM_DAY = 300;
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
/** The room id's clock (hours, JST), or null: the day preset's sun and exposure then are that time's (./clock.ts). */
let clock: number | null = null;
let sun: DirectionalLight;
// A material that glows less by day has a daytime twin at that glow (none, for most: then it is no light at all). The
// near meshes drawn with it take the twin by day: a light kept in the sampler at no power still costs every streamed
// cell a light-tree update. (So a change between night and day loads the near cells again, the nearest first.)
const dayOf = new Map<MeshStandardMaterial, MeshStandardMaterial>();
const lit = (m: MeshStandardMaterial) => (time === "night" ? m : dayOf.get(m) ?? m);
const cells = new Map<string, Cell>();
/** Far objects by tile and quadrant: buildings (with their lit windows and signs) and trees. */
/** (`lights`: its lit windows and signs, which light nothing; `lamps`: its street lamps' heads, which do by night, so
 *  that each model of them added rebuilds the light list, ~100 ms of the GPU's. A quadrant added after the first frame
 *  has its lamps to add (`addLamps`) with every other's once the far level is in, in one commit.) */
type FarQuadrant = { covered: boolean; base: GLTFModel | null; lights: GLTFModel | null; lamps: GLTFModel | null; trees: InstancedMesh[]; addLamps: (() => void) | null };
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
  const path = `${baked(c.a)}/L${level}/c_${c.i}_${c.j}.bin`;
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
  return { a: c.a, level, night: time === "night", path, meshes, placements: head.placements, kit, kitLit: [], off: 8 + n, k: 0, p: 0, q: 0, root };
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
    const mesh = new Mesh(g, job.level === 1 ? midOf.get(mat) ?? mat : lit(mat));
    // (a streak is a decal 4 mm off its wall: no shadow of its own on it)
    if (mat.name.startsWith("streak")) mesh.castShadow = false;
    job.root.add(mesh);
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
    const piece = kitPiece(job.a, e.k);
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
  const piece = kitPiece(job.a, e.k);
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
      if (part.material.name.startsWith("streak")) inst.castShadow = false;
      job.root.add(inst);
    }
    return piece.length;
  }
}

// ---------------------------------------------------------------- the kit: repeated elements, one mesh each
/** The kit's pieces as the file lists them (their parts' materials and sizes, where their data is), and the geometry of
 *  those a cell has placed (one geometry each, a group per material: every copy of it in every cell shares it). */
function loadKit(a: Area) {
  const path = `${baked(a)}/kit.bin`;
  let n: number;
  try {
    n = new DataView(engine.readAsset(path, 0, 8)).getUint32(4, true);
  } catch {
    a.kitIndex = [];
    return;
  }
  const head = JSON.parse(ascii(new Uint8Array(engine.readAsset(path, 8, n)))) as { pieces: { material: string; v: number; i: number }[][] };
  let off = 8 + n;
  a.kitIndex = head.pieces.map((parts) => {
    const at = off;
    for (const p of parts) off += p.v * 32 + p.i * 4;
    return { parts, at };
  });
}
function kitPiece(a: Area, k: number) {
  if (a.kitMade.has(k)) return a.kitMade.get(k)!;
  const e = a.kitIndex[k];
  let made: KitPiece | null = null;
  if (e) {
    const buf = engine.readAsset(`${baked(a)}/kit.bin`, e.at, e.parts.reduce((s, p) => s + p.v * 32 + p.i * 4, 0));
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
  a.kitMade.set(k, made);
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
const farKey = (a: Area, i: number, j: number) => `${a.name}:${Math.floor(i / 2)}_${Math.floor(j / 2)}_${fmod(i, 2) + 2 * fmod(j, 2)}`;

function setFar(c: Cell) {
  const f = farQ.get(farKey(c.a, c.i, c.j));
  if (!f) return;
  // (moved out of sight rather than hidden: an object hidden when the scene is rebuilt is left out of it, and showing it
  // again would rebuild the scene once more)
  f.covered = c.level >= 0;
  if (f.base) f.base.position.y = f.covered ? -10000 : 0;
  for (const t of f.trees) t.position.y = f.covered ? -10000 : 0;
  for (const m of [f.lights, f.lamps]) if (m) {
    m.position.y = f.covered ? -10000 : 0;
    m.power = !f.covered && time === "night" ? 1 : 0;
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
  const x0 = c.i * CELL + c.a.ox, z0 = c.j * CELL + c.a.oz;
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

/** Whether a cell's level is loading. */
const loading = () => { for (const c of cells.values()) if (c.loading) return true; return false; };

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

// ---------------------------------------------------------------- the routes (benchmarks: ROADMAP § 0 step 2)
// "-route=drive" (Meiji-dōri, Shinjuku to Shibuya over the areas' seam, 60 km/h), "-route=expressway" (Shuto Route 3
// across Shibuya, 100 km/h), "-route=flight" (Meiji-dōri's line at roof height, 150 km/h): tools/tokyo/routes.ts.
// The camera at the speed along the route, looking at the route ahead; at its end it stops ("tokyo: route end").
type Route = { speed: number; look: number; pts: number[] };
let route: Route | null = null;
let routeEnded = false;
function routePoint(r: Route, s: number): V3 {
  const n = r.pts.length / 3, f = Math.min(Math.max(s / 2, 0), n - 1), k = Math.min(Math.floor(f), n - 2), u = f - k;
  return [0, 1, 2].map((a) => r.pts[k * 3 + a] + (r.pts[k * 3 + 3 + a] - r.pts[k * 3 + a]) * u) as V3;
}
function routeAt(r: Route, t: number) {
  const s = r.speed * t, end = (r.pts.length / 3 - 1) * 2;
  const pos = routePoint(r, Math.min(s, end));
  // (the look: at the route a little ahead, the way it bends averaged over three points; from a flight, down at the
  // roofs)
  const ahead = [0.5, 1, 1.5].map((k) => routePoint(r, Math.min(s, end) + r.look * k));
  const tx = ahead.reduce((a, p) => a + p[0], 0) / 3 - pos[0], tz = ahead.reduce((a, p) => a + p[2], 0) / 3 - pos[2];
  const ty = ahead[1][1] - pos[1];
  const flight = r.look > 60;
  return { pos, yaw: Math.atan2(tz, tx), pitch: Math.atan2(ty, Math.hypot(tx, tz)) - (flight ? 0.14 : 0.02), ended: s >= end };
}

// ---------------------------------------------------------------- measurement (tools/tokyo/quality.ts)
// Events a script sends to hold the city at a pose and compare frames ("event" commands of `threert-render live`):
//   pose {pos: [x, y, z], yaw, pitch} (degrees): the camera there (a tour stops); radii {r0, r1, keep} (m): the level
//   radii and their hysteresis; hold: the camera and the streaming stop where they are (a tour's pose is logged);
//   settle: every cell to its level now, whole (logged "tokyo: settled" when done).
let held = false;
function settle() {
  for (const step of farSteps.splice(0)) step();
  for (const f of farQ.values()) f.addLamps?.();
  farLamps = false;
  for (const n of farNext.splice(0)) for (const step of farTile(n.p.a, n.p.t, n.p.group)) step();
  loadFar(cam.pos, Infinity);
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

// ---------------------------------------------------------------- the far tiles, the nearest first
type FarTile = { x: number; z: number; file: string; nodes?: string[] };
/** Far tiles not loaded yet, and how a tile loads (set by the scene's setup: it needs its materials). */
const farPending: { a: Area; t: FarTile; group: Group }[] = [];
let farTile: (a: Area, t: FarTile, group: Group) => (() => void)[] = () => [];
/** The node sets of a tile's models (as `farTile` makes them): what a tile's preload reads the triangles of. */
let farNodes: (t: FarTile) => string[][] = () => [];
/** The tiles next in line, their files parsed meanwhile on a worker thread (`preloadModel`): a tile added whole in one
 *  frame's commit (its ~13 models: ~10 ms once parsed; parsed in the commit, 30-90 ms more). */
const farNext: { p: (typeof farPending)[number]; since: number }[] = [];
/** The models of the tile being added, still to go (`FAR_STEPS` a frame). */
const farSteps: (() => void)[] = [];
const FAR_STEPS = 7;
/** Whether the scene's setup is adding tiles (their lit windows with them: the build has them at no cost). */
let farSetup = false;
/** Whether quadrants have their lamps still to add (`FarQuadrant.addLamps`). */
let farLamps = false;
let farFrame = 0, farLast = 0;
/** One frame of the far tiles' loading: the next ones preloaded, a tile's models added every other frame, `FAR_STEPS`
 *  at a time (not while a cell's level loads, unless 12 frames went by without). */
function farStep(busy: boolean) {
  farFrame++;
  // (every tile in: the lamps of those added after the first frame, 150 models a frame: a few commits, each rebuilding
  // the light list once; the scene binding binds a frame's new objects within the frame script's 50 ms, and ~1,100
  // models at once took longer)
  if (!farPending.length && !farNext.length && !farSteps.length) {
    if (busy && farFrame - farLast < 12) return;
    let n = 0;
    for (const f of farQ.values()) {
      if (!f.addLamps) continue;
      if (n++ >= 150) return;
      f.addLamps();
    }
    farLamps = false;
    return;
  }
  while (farNext.length < 4 && farPending.length) {
    loadFar(cam.pos, Infinity, 0);
    const p = farPending.shift()!;
    preloadModel(`assets/city/glb/${p.a.name}-far/${p.t.file}`, farNodes(p.t));
    farNext.push({ p, since: farFrame });
  }
  if (farFrame - farLast < 2 || (busy && farFrame - farLast < 12)) return;
  if (!farSteps.length) {
    const next = farNext[0];
    if (!next || farFrame - next.since < 4) return;
    farNext.shift();
    farSteps.push(...farTile(next.p.a, next.p.t, next.p.group));
  }
  const until = Date.now() + 15;
  for (let n = 0; n < FAR_STEPS && farSteps.length && Date.now() < until; n++) farSteps.shift()!();
  farLast = farFrame;
}
const FAR_FIRST = 900;
/** Loads the pending tiles within `reach` of (x, z) (from the tile's box), or with `count`, the nearest that many. */
function loadFar([x, , z]: V3, reach: number, count = Infinity) {
  const size = 256;
  const dist = (p: (typeof farPending)[number]) => {
    const x0 = p.t.x * size + p.a.ox, z0 = p.t.z * size + p.a.oz;
    return Math.hypot(Math.max(x0 - x, 0, x - (x0 + size)), Math.max(z0 - z, 0, z - (z0 + size)));
  };
  farPending.sort((p, q) => dist(p) - dist(q));
  let n = 0;
  while (farPending.length && n < count && dist(farPending[0]) <= reach) {
    const p = farPending.shift()!;
    for (const step of farTile(p.a, p.t, p.group)) step();
    n++;
  }
}

// ---------------------------------------------------------------- the far level's trees
// Copies of six forms (tools/tokyo/to-glb.ts --city, trees.bin): each form one geometry, a quadrant's copies of it one
// instanced mesh (as triangles of their own they were 7.8 M of the two areas' far level, 30 %). One material for all:
// a form's bark and three leaf shades are swatches of a palette texture, its uvs pick theirs (the colour and the
// roughness each part had as a material of its own).
function farTrees(a: Area) {
  const path = `assets/city/glb/${a.name}-far/trees.bin`;
  let n: number;
  try {
    n = new DataView(engine.readAsset(path, 0, 8)).getUint32(4, true);
  } catch {
    return null;
  }
  const head = JSON.parse(ascii(new Uint8Array(engine.readAsset(path, 8, n)))) as { palette: number[][]; forms: { v: number; i: number; at: number }[]; quads: Record<string, [number, number, number][]> };
  const base = 8 + n;
  const swatches = (f: (c: number[]) => number[], space: "srgb" | "linear") => {
    const P = head.palette.length, px = new Uint8Array(P * 32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < P * 32; x++) {
      const v = f(head.palette[Math.floor(x / 32)]);
      px.set([...v.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)), 255], (y * P * 32 + x) * 4);
    }
    return new DataTexture(P * 32, 32, px, space);
  };
  const srgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const material = new MeshStandardMaterial({ map: swatches((c) => c.slice(0, 3).map(srgb), "srgb"), roughnessMap: swatches((c) => [1, c[3], 1], "linear"), roughness: 1 });
  material.name = "far trees";
  const geometries = head.forms.map((f) => {
    const buf = engine.readAsset(path, base + f.at, f.v * 32 + f.i * 4);
    const g = new BufferGeometry();
    g.positions = new Float32Array(buf, 0, f.v * 3);
    g.normals = new Float32Array(buf, f.v * 12, f.v * 3);
    g.uvs = new Float32Array(buf, f.v * 24, f.v * 2);
    g.index = new Uint32Array(buf, f.v * 32, f.i);
    return g;
  });
  /** A quadrant's trees: an instanced mesh a form. */
  const quadrant = (key: string) => (head.quads[key] ?? []).map(([form, count, at]) => {
    const src = new Float32Array(engine.readAsset(path, base + at, count * 48));
    const inst = new InstancedMesh(geometries[form], material, count);
    const m = inst.instanceMatrix.array;
    for (let i = 0; i < count; i++) {
      const s = i * 12, o = i * 16;
      m[o] = src[s]; m[o + 1] = src[s + 1]; m[o + 2] = src[s + 2];
      m[o + 4] = src[s + 3]; m[o + 5] = src[s + 4]; m[o + 6] = src[s + 5];
      m[o + 8] = src[s + 6]; m[o + 9] = src[s + 7]; m[o + 10] = src[s + 8];
      m[o + 12] = src[s + 9]; m[o + 13] = src[s + 10]; m[o + 14] = src[s + 11]; m[o + 15] = 1;
    }
    inst.position.set(a.ox, 0, a.oz);
    return inst;
  });
  return { quadrant };
}

// ---------------------------------------------------------------- beyond the area
// The city goes on past the compiled area (the user: from above 140 m the world stopped at a grey plain a kilometre
// out): blocks and towers out to ~6 km, baked (tools/tokyo/distant.ts: one GLB, static, never streamed). Their facades
// take the library surface's procedural windows (lit by night by the model's power); the sky's aerial perspective hazes
// them.
let distant: GLTFModel | null = null;
function distantCity(night: boolean) {
  const facade = new SurfaceMaterial({ roughness: 0.85, windows: facadeWindows({ floorHeight: 3.3, bayWidth: 3.2, windowWidth: 1.5, windowHeight: 1.4, groundHeight: 4, sill: 0.9, litChance: 0.45, brightness: 25, seed: 7 }) });
  distant = new GLTFModel(`assets/city/glb/tokyo-distant.glb`, { functions: { "distant facade ": facade.shader! } });
  distant.power = night ? 1 : 0;
  scene.add(distant);
}

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
  const preset = time === "day" && clock !== null ? clockSun(clock, TIMES.day) : TIMES[time];
  sun.setSunAngles(preset.elevation, preset.azimuth);
  camera.setManualExposure(preset.ev);
  scene.wetness = night ? 1 : 0;
  if (wasNight !== night) {
    for (const mat of midOf.values()) {
      const binding = mat.shader!;
      mat.shader = midGlow.with({ ...binding.params, IsNight: night ? 1 : 0 }, binding.textures);
    }
    for (const f of farQ.values()) for (const m of [f.lights, f.lamps]) if (m && !f.covered) m.power = night ? 1 : 0;
    if (distant) distant.power = night ? 1 : 0;
    for (const f of farQ.values()) for (const m of [f.base, f.lights, f.lamps]) if (m) m.customData = [night ? 0 : FAR_ROOM_DAY, 0, 0, 0];
  }
  const at = time === "day" && clock !== null ? ` at ${Math.floor(clock)}:${String(Math.round((clock % 1) * 60)).padStart(2, "0")} (sun ${preset.elevation.toFixed(1)} / ${preset.azimuth.toFixed(1)} deg, EV ${preset.ev.toFixed(2)})` : "";
  console.log(`Tokyo · ${time}${at} · 1 Day / 2 Dusk / 3 Night / T Cycle`);
}

export function sceneFor(room: string) {
  const requested = room.split("-")[1];
  time = requested === "day" || requested === "dusk" ? requested : "night";
  clock = parseClock(room);
  const night = time === "night";
  tour = room.includes("-tour");
  const rname = /-route=(\w+)/.exec(room)?.[1];
  route = rname ? (ROUTES as Record<string, Route>)[rname] ?? null : null;
  routeEnded = false;
  if (route) console.log(`tokyo: route ${rname}, ${((route.pts.length / 3 - 1) * 2 / 1000).toFixed(2)} km at ${(route.speed * 3.6).toFixed(0)} km/h, ${((route.pts.length / 3 - 1) * 2 / route.speed).toFixed(1)} s`);
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
  for (const a of AREAS) a.kitMade.clear();
  retiring.length = 0;
  scene = new Scene();
  sun = new DirectionalLight(0xfff4e8, 100000);
  scene.add(sun);
  scene.environment = tokyoSky(sun, { dynamic: true });
  const b = AREAS[0].far.bounds;
  const land = new Mesh(new PlaneGeometry(200000, 200000), new MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.95 }));
  land.rotation.x = -Math.PI / 2;
  // (below the lowest ground of the areas: Shibuya's valley, 8 m)
  land.position.set((b.minX + b.maxX) / 2, 7, (b.minZ + b.maxZ) / 2);
  scene.add(land);
  distantCity(night);
  // the ground of every tile: its roads in generated asphalt and pavers, wet by night
  const tex = (id: string, size: number) => { const t = finishMap(id, "color"); t.repeat = [1 / size, 1 / size]; return t; };
  const road = (id: string, size: number, puddles: number) => new SurfaceMaterial({ map: tex(id, size), normalMap: finishMap(id, "normal"), roughnessMap: finishMap(id, "rough"), worldScale: size, wet: 1, puddles: { scale: 2.5, amount: puddles }, grime: { amount: 0.3, scale: 3 } });
  const functions = { "road 0 ": road("asphalt", 3.5, 0.2).shader!, "road 1 ": road("pavers", 1.6, 0.12).shader!, "road 2 ": foliage, "road 3 ": road("concrete-worn", 2.5, 0.12).shader!, paint: wetLayer({ puddles: 0.4 }) };
  const trees = new Map(AREAS.map((a) => [a, lowmem ? null : farTrees(a)]));
  // (each tile's objects in a group of its own, made now: what a tile adds later goes in place)
  // (a quadrant's models: its buildings and props; its lit windows and signs; its lamps' heads)
  const quadNodes = (q: number) => [lowmem ? [`b${q}`] : [`b${q}`, `p${q}`], [`b${q}-night`], [`p${q}-night`]];
  farNodes = (t) => {
    const has = new Set(t.nodes ?? []);
    return [["ground"], ...[0, 1, 2, 3].flatMap((q) => quadNodes(q).map((names) => names.filter((n) => has.has(n))).filter((n) => n.length))];
  };
  farTile = (a, t, group) => {
    const uri = `assets/city/glb/${a.name}-far/${t.file}`;
    const has = new Set(t.nodes ?? []);
    const steps: (() => void)[] = [() => {
      const ground = new GLTFModel(uri, { nodes: ["ground"], functions });
      ground.position.set(a.ox, 0, a.oz);
      group.add(ground);
    }];
    for (let q = 0; q < 4; q++) {
      const f = farQ.get(`${a.name}:${t.x}_${t.z}_${q}`)!;
      // (only the nodes the tile has: a model of none draws nothing and cannot be hidden in place)
      const model = (names: string[], lights = false) => {
        const nodes = names.filter((n) => has.has(n));
        if (!nodes.length) return null;
        const night = time === "night";
        const m = new GLTFModel(uri, { nodes, functions: lights ? { "window lit far ": farWindows, "signs night ": farSigns } : { "window glass": farRooms } });
        if (lights) m.power = night && !f.covered ? 1 : 0;
        m.customData = [night ? 0 : FAR_ROOM_DAY, 0, 0, 0];
        // (a nearer level may already show the quadrant)
        m.position.set(a.ox, f.covered ? -10000 : 0, a.oz);
        group.add(m);
        return m;
      };
      const [base, windows, lamps] = quadNodes(q);
      steps.push(() => { f.base = model(base); });
      steps.push(() => {
        f.lights = model(windows, true);
        const add = () => { f.addLamps = null; f.lamps = model(lamps, true); };
        if (farSetup) add();
        else {
          f.addLamps = add;
          farLamps = true;
        }
      });
      steps.push(() => {
        f.trees = trees.get(a)?.quadrant(`${t.x}_${t.z}_${q}`) ?? [];
        for (const m of f.trees) {
          if (f.covered) m.position.y = -10000;
          group.add(m);
        }
      });
    }
    return steps;
  };
  // The far tiles within FAR_FIRST of the camera before the first frame; the rest after it, the nearest first (`farStep`).
  // Room "-whole": all of them at the start (an offline still: tools/shot.ts, tools/quality.ts).
  const whole = room.includes("-whole");
  farPending.length = 0;
  for (const a of AREAS) for (const t of a.far.tiles) {
    for (let q = 0; q < 4; q++) farQ.set(`${a.name}:${t.x}_${t.z}_${q}`, { covered: false, base: null, lights: null, lamps: null, trees: [], addLamps: null });
    const group = new Group();
    group.name = `far ${a.name} ${t.x} ${t.z}`;
    scene.add(group);
    farPending.push({ a, t, group });
  }
  farNext.length = 0;
  farSteps.length = 0;
  farLamps = false;
  farSetup = true;
  loadFar(cam0(room), whole ? Infinity : FAR_FIRST);
  farSetup = false;
  // the Shuto expressway's elevated decks (tools/tokyo/viaducts.ts: the compiled city has the road's level, no structure)
  scene.add(new GLTFModel("assets/city/glb/tokyo-viaducts.glb", { functions }));
  // the library: every material and model the baked cells use, in the scene from the start (so cells add in place)
  lib = collectMaterials(heroMaterials(true), propMaterials(true), true);
  const daylight = collectMaterials(heroMaterials(false), propMaterials(false), false);
  for (const m of [...lib.values()]) {
    // (rooms behind windows, lit by night or not: their daylight look)
    const room = m.name.startsWith("room ") ? (m.name.includes("shop") ? ROOM_DAY.shop : m.name.includes("bar") ? ROOM_DAY.bar : ROOM_DAY.room) : 0;
    if (!emits(m) && !room) continue;
    const k = emits(m) ? m.emissiveIntensity : 0;
    const day = daylight.get(m.name)?.emissiveIntensity ?? 0;
    const glow = m.emissiveMap ?? m.map;
    // (a room that stays dark by night is a little darker by day too: curtains open, no lamp; its base colour would
    // make it black against a sunlit wall)
    const dim = m.name === "room dark" ? 0.65 : 1;
    const tint: [number, number, number, number] = room ? [dim, dim, dim, 0] : [m.emissive.r, m.emissive.g, m.emissive.b, 0];
    const params = { DayNits: day, NightNits: k, Tint: tint, Room: room, Bar: room && (m.name === "room bar" || m.name === "room shop") ? 1 : 0 };
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
  for (const a of AREAS) loadKit(a);
  const firstCopies = new InstancedMesh(swatch, lib.values().next().value!, 1);
  firstCopies.position.set(b.minX, -55, b.minZ);
  scene.add(firstCopies);
  for (const [key, m] of Object.entries(MODELS)) {
    const g = new GLTFModel(m.uri);
    g.position.set(b.minX, -60 - Object.keys(MODELS).indexOf(key) * 5, b.minZ);
    scene.add(g);
  }
  // the cells of the baked areas (each cell's groups where its area lies)
  for (const a of AREAS) for (const key of a.cells) {
    const [i, j] = key.split("_").map(Number);
    const roots: [Group, Group, Group] = [new Group(), new Group(), new Group()];
    roots.forEach((g, l) => { g.name = `cell ${a.name} ${i} ${j} ${["L0", "L1", "L0b"][l]}`; g.position.set(a.ox, 0, a.oz); scene.add(g); });
    cells.set(`${a.name}:${key}`, { a, i, j, level: -1, roots, shown: null, night: time === "night", loading: null });
  }
  // the camera: Golden Gai's middle alley by default
  // ("-at=x,z" at street level, "-at=x,y,z" anywhere)
  const [sx, sy, sz] = at ? (at[3] ? [Number(at[1]), Number(at[2]), Number(at[3])] : [Number(at[1]), 34, Number(at[2])]) : [359.8, 32.3, -496.6];
  cam.pos = [sx, sy, sz];
  cam.yaw = (look ? Number(look[1]) : 22) * Math.PI / 180;
  cam.pitch = look ? Math.max(-1.5, Math.min(1.5, Number(look[2]) * Math.PI / 180)) : 0;
  if (route) {
    const r = routeAt(route, 0);
    cam.pos = r.pos;
    cam.yaw = r.yaw;
    cam.pitch = r.pitch;
  }
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
  console.log(`city: ${AREAS.map((a) => a.name).join(" + ")}: ${AREAS.reduce((s, a) => s + a.far.tiles.length, 0)} far tiles, ${cells.size} cells, ${lib.size} materials; started with ${[...cells.values()].filter((c) => c.level === 0).length} cells at L0, ${[...cells.values()].filter((c) => c.level === 1).length} at L1`);
  return { scene, camera, options: { name: `tokyo-city-${time}`, width: 1280, height: 720 } };
}

/** Where the camera starts: the room's "-at", a route's start, else Golden Gai's middle alley. */
function cam0(room: string): V3 {
  const at = /-at=(-?[\d.]+),(-?[\d.]+)(?:,(-?[\d.]+))?/.exec(room);
  if (route) return routeAt(route, 0).pos;
  return at ? (at[3] ? [Number(at[1]), Number(at[2]), Number(at[3])] : [Number(at[1]), 34, Number(at[2])]) : [359.8, 32.3, -496.6];
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
      route = null;
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
      route = null;
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
    if (route) {
      const r = routeAt(route, f.time);
      cam.pos = r.pos;
      cam.yaw = r.yaw;
      cam.pitch = r.pitch;
      if (r.ended && !routeEnded) { routeEnded = true; console.log("tokyo: route end"); }
    } else if (tour) {
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
      cam.pos = [cam.pos[0] + (fx * mv.y + rx * mv.x) * v, Math.max(9, cam.pos[1] + (fy * mv.y + up) * v), cam.pos[2] + (fz * mv.y + rz * mv.x) * v];
    }
    aim(f.camera);
    if (held) return;
    retire(250);
    // (the far tiles still to come, the nearest first)
    if (farPending.length || farNext.length || farSteps.length || farLamps) farStep(loading());
    stream(cam.pos[0], cam.pos[1], cam.pos[2], { tris: FRAME_TRIS, until: Date.now() + FRAME_MS, objects: FRAME_OBJECTS });
  },
});
