// What the levels of detail and the streaming cost in image quality: the city at fixed poses, frames compared as
// images (mean / p99 CIEDE76, SSIM: `threert-render compare`).
//   node tools/quality.ts [day|night] [--poses alley,towers] [--spp 128] [--tour 20,45] [--live] [--swap] [--offline-off] [--out DIR]
//
// For each pose, the path tracer offline (tools/shot.ts's render, the cells round the pose loaded whole at the radii
// the room id gives: converged, and the same noise where nothing changed):
//   floor   the same render twice
//   detail  what the levels cost there: the view as streamed (L0 to 140 m, L1 to 480 m, far beyond) against
//           the levels at twice their radii (L0 to 280 m, L1 to 960 m; L0 to 300 m is past the renderer's 4 GB vertex buffer)
//   L0/L1   the cells at 120–160 m at L0, then at L1 (r0 160 vs 120): what a cell's switch at 140 m shows
//   L1/far  the same with r1 520 vs 440, the switch at 480 m
//   live    (`--live`) the live view held still there (MetalFX's denoiser where there is one) against the offline render
//   swap    (`--swap`) the 140 m switch as it streams in the live view, frame by frame (see there)
// For each tour second (`--tour`; a live session each: the tour flown in lockstep at 60 frames a second, then held):
//   floor   the held frame twice (the live view's noise: a frame is 8 snapshots averaged)
//   stream  the frame with what streaming had loaded by then, against the same pose with every cell at its level
// The roadmap's bar (ROADMAP § 0): ΔE ≤ 1.0 and SSIM ≥ 0.98. Writes <out>/<time>/report.{md,json} and a sheet per
// comparison (the two frames and the ΔE heat map, side by side).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { join } from "node:path";
import { bundleGame } from "../engine/tools/bundle-game.ts";
import { startLive, type Build, type Live } from "../engine/tools/lib/live.ts";
import { waitGpuLock } from "../engine/tools/lib/bench.ts";
import { repoRoot } from "./lib/paths.ts";

type V3 = [number, number, number];
/** Named poses: where from, what at (the README's views and the places streaming is judged at). */
const POSES: Record<string, { pos: V3; target: V3 }> = {
  alley: { pos: [361.6, 32.3, -495.8], target: [398.6, 32.8, -480.5] },
  street: { pos: [410, 33.45, -445], target: [420, 39.45, -560] },
  block: { pos: [330, 60, -420], target: [430, 50, -480] },
  avenue: { pos: [-470, 42.4, 40], target: [-620, 75, 160] },
  towers: { pos: [-350, 170, 80], target: [-800, 110, 170] },
  skyline: { pos: [950, 240, -250], target: [-500, 110, -150] },
};

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const time = (argv[0] && !argv[0].startsWith("--") ? argv[0] : "day") + (argv.includes("--builtin") ? "-builtin" : "");
const poses = (opt("--poses") ?? Object.keys(POSES).join(",")).split(",").filter(Boolean);
const tourAt = (opt("--tour") ?? "").split(",").filter(Boolean).map(Number);
const N = Number(opt("--frames") ?? 120), SPP = opt("--spp") ?? "128";
const out = join(opt("--out") ?? join(repoRoot, "out/quality"), time);
const W = 1280, H = 720, FOV = 70;
/** Snapshots averaged per frame compared, and the frames between them. */
const K = Number(opt("--average") ?? 8), GAP = 6;
/** Frames recorded through a swap (`--swap`). */
const SWAP_FRAMES = Number(opt("--swap-frames") ?? 40);
mkdirSync(out, { recursive: true });

// (the GPU lock while it renders: a measurement another run is timing is not skewed by these renders)
await waitGpuLock("tokyo-quality", 120 * 60_000);
const bin = join(repoRoot, "engine/renderer/target/release/threert-render");
const bundle = join(repoRoot, "out/bundles/city.js");
await bundleGame(join(repoRoot, "scene/city.game.ts"), bundle);
const b: Build = { bin, assets: repoRoot, presets: join(repoRoot, "engine/presets"), bundles: join(repoRoot, "out/bundles"), label: "city" };
const env = { THREERT_SCRIPT_MB: "12288" };

const look = (p: { pos: V3; target: V3 }) => {
  const d = p.target.map((v, k) => v - p.pos[k]);
  return { yaw: Math.atan2(d[2], d[0]) * 180 / Math.PI, pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI };
};
const f3 = (v: number[]) => v.map((x) => +x.toFixed(3)).join(",");

type Metric = { mean_delta_e: number; p99_delta_e: number; ssim: number };
function compareQuiet(a: string, c: string): Metric {
  return JSON.parse(execFileSync(bin, ["compare", a, c]).toString());
}
function compare(a: string, c: string, sheet: string): Metric {
  return JSON.parse(execFileSync(bin, ["compare", a, c, "--sheet", sheet]).toString());
}

async function session(room: string) {
  const live = startLive(b, bundle, { room, env, width: W, height: H, scale: "1" });
  await live.firstFrame;
  live.send({ cmd: "lockstep", dt: 1 / 60 });
  return live;
}
/** n frames on (events first, in the first of them), then a snapshot. */
async function shot(live: Live, path: string, events: [string, object?][] = [], n = N) {
  for (const [type, payload] of events) live.send({ cmd: "event", type, payload: payload ?? {} });
  if (events.some(([t]) => t === "settle")) {
    const settled = () => live.lines.filter((l) => l.includes("tokyo: settled")).length;
    const before = settled();
    live.send({ cmd: "frames", n: 1 });
    await live.wait(() => settled() > before, 600_000);
  }
  // (K snapshots a few frames apart, averaged: the temporal noise left after n frames still is most of the floor)
  live.send({ cmd: "frames", n: n - K * GAP });
  const parts: string[] = [];
  for (let k = 0; k < K; k++) {
    const part = path.replace(/\.png$/, `.${k}.png`);
    live.send({ cmd: "frames", n: GAP, snapshot: part });
    await live.wait((l) => l.includes("live: snapshot") && l.includes(part), 600_000);
    parts.push(part);
  }
  const imgs = await Promise.all(parts.map((q) => sharp(q).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const sum = new Uint32Array(imgs[0].data.length);
  for (const m of imgs) for (let i = 0; i < sum.length; i++) sum[i] += m.data[i];
  const avg = Buffer.from(sum.map((v) => Math.round(v / K)));
  await sharp(avg, { raw: { width: imgs[0].info.width, height: imgs[0].info.height, channels: 3 } }).png().toFile(path);
  for (const q of parts) rmSync(q);
  return path;
}

const rows: { pose: string; what: string; a: string; b: string; m: Metric }[] = [];
const add = (pose: string, what: string, a: string, c: string) => {
  const m = compare(a, c, join(out, `sheet-${pose}-${what.replace(/\W+/g, "-")}.png`));
  rows.push({ pose, what, a, b: c, m });
  console.log(`${pose.padEnd(10)} ${what.padEnd(8)} ΔE ${m.mean_delta_e.toFixed(2)} (p99 ${m.p99_delta_e.toFixed(1)})  SSIM ${m.ssim.toFixed(4)}`);
};

/** The offline render at a pose, with the room's suffix (the level radii). */
function offline(p: { pos: V3; target: V3 }, suffix: string, path: string) {
  execFileSync(bin, ["render", bundle, "-o", path, "--assets", repoRoot, "--room", `tokyo-${time}-at=${f3(p.pos)}${suffix}`, "--spp", SPP, "--width", String(W), "--height", String(H), "--camera", JSON.stringify({ position: p.pos, target: p.target, fov: FOV })], { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
  return path;
}

for (const name of poses) {
  const p = POSES[name];
  if (!p) throw new Error(`no pose ${name} (${Object.keys(POSES).join(", ")})`);
  const f = (s: string) => join(out, `${name}-${s}.png`);
  const offlineToo = !argv.includes("--offline-off");
  const base = offlineToo ? offline(p, "", f("base")) : "";
  if (offlineToo) {
    add(name, "floor", base, offline(p, "", f("again")));
    add(name, "detail", offline(p, "-r0=280-r1=960", f("full")), base);
    add(name, "L0/L1", offline(p, "-r0=160", f("r0-160")), offline(p, "-r0=120", f("r0-120")));
    add(name, "L1/far", offline(p, "-r1=520", f("r1-520")), offline(p, "-r1=440", f("r1-440")));
  }
  if (argv.includes("--live") && offlineToo) {
    const { yaw, pitch } = look(p);
    const live = await session(`tokyo-${time}-at=${f3(p.pos)}-look=${f3([yaw, pitch])}`);
    const held = await shot(live, f("live"), [["pose", { pos: p.pos, yaw, pitch }], ["settle"]]);
    await live.quit();
    add(name, "live", base, held);
  }
  if (argv.includes("--swap")) {
    // The 140 m switch in the live view, as it streams (the normal frame budget), the camera still: each frame through it
    // against the view before and the view after (both settled, 8 snapshots averaged). A frame that is neither
    // (both levels drawn at once, a level half in, the history thrown away) is what flickers: its ΔE to the nearer of
    // the two, the worst over the swap, against a single frame's own noise (the same frame settled).
    const { yaw, pitch } = look(p);
    const live = await session(`tokyo-${time}-at=${f3(p.pos)}-look=${f3([yaw, pitch])}`);
    const from = await shot(live, f("swap-from"), [["pose", { pos: p.pos, yaw, pitch }], ["radii", { r0: 120, r1: 480, keep: 0 }], ["settle"]]);
    const frames: string[] = [];
    live.send({ cmd: "event", type: "radii", payload: { r0: 160 } });
    for (let k = 0; k < SWAP_FRAMES; k++) {
      const path = f(`swap-${String(k).padStart(2, "0")}`);
      live.send({ cmd: "frames", n: 1, snapshot: path });
      await live.wait((l) => l.includes("live: snapshot") && l.includes(path), 600_000);
      frames.push(path);
    }
    const to = await shot(live, f("swap-to"), [["settle"]]);
    const single = f("swap-single");
    live.send({ cmd: "frames", n: 1, snapshot: single });
    await live.wait((l) => l.includes("live: snapshot") && l.includes(single), 600_000);
    await live.quit();
    const de = (a: string, b: string) => compareQuiet(a, b);
    const near = frames.map((x) => { const a = de(from, x), b = de(to, x); return a.mean_delta_e <= b.mean_delta_e ? { m: a, ref: from } : { m: b, ref: to }; });
    const k = near.reduce((w, e, i) => (e.m.mean_delta_e > near[w].m.mean_delta_e ? i : w), 0);
    add(name, "swap floor", to, single);
    const floor = rows.at(-1)!.m.mean_delta_e;
    add(name, `swap (worst frame ${k})`, near[k].ref, frames[k]);
    rows.at(-1)!.what += `; ${near.filter((e) => e.m.mean_delta_e > floor + 0.1).length} of ${SWAP_FRAMES} frames over the floor + 0.1`;
    for (const x of frames) rmSync(x);
  }
}

for (const t of tourAt) {
  const live = await session(`tokyo-${time}-tour`);
  live.send({ cmd: "frames", n: Math.round(t * 60), sync: `t${t}` });
  await live.wait((l) => l.includes(`live: sync t${t}`), 900_000);
  const f = (s: string) => join(out, `tour${t}-${s}.png`);
  const streamed = await shot(live, f("streamed"), [["hold"]]);
  const again = await shot(live, f("again"));
  const at = live.lines.find((l) => l.includes("tokyo: held at"));
  const settled = await shot(live, f("settled"), [["radii", { keep: 0 }], ["settle"]]);
  await live.quit();
  add(`tour ${t}s`, "floor", streamed, again);
  add(`tour ${t}s`, "stream", settled, streamed);
  rows.at(-1)!.what += ` (${at?.replace(/.*held at /, "") ?? "?"})`;
}

const ok = (m: Metric) => m.mean_delta_e <= 1 && m.ssim >= 0.98;
const md = [
  `# Tokyo image quality, ${time} (${W}x${H}; offline ${SPP} spp; live: ${N} frames still, ${K} snapshots averaged; ${new Date().toISOString().slice(0, 10)})`,
  "",
  "Mean / p99 ΔE76 and SSIM, `threert-render compare`. Bar: ΔE ≤ 1.0, SSIM ≥ 0.98.",
  "",
  "| pose | comparison | mean ΔE | p99 ΔE | SSIM | bar |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.pose} | ${r.what} | ${r.m.mean_delta_e.toFixed(2)} | ${r.m.p99_delta_e.toFixed(1)} | ${r.m.ssim.toFixed(4)} | ${ok(r.m) ? "ok" : "**over**"} |`),
  "",
];
writeFileSync(join(out, "report.md"), md.join("\n"));
writeFileSync(join(out, "report.json"), JSON.stringify({ time, width: W, height: H, frames: N, rows }, null, 1));
console.log(`\n${join(out, "report.md")}`);
