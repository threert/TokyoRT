// The tour in the live view, real time, with the frame log (a benchmark; SHOTS=6,30 takes snapshots at those seconds):
//   node tools/tour.ts [tokyo-night-tour|tokyo-day-tour] [seconds] [log.jsonl]
// A route's room ("tokyo-day-route=drive", "...=expressway", "...=flight": scene/city.game.ts) runs to the route's end
// (seconds "route", the default for one). On macOS the renderer's physical footprint is sampled every 5 s (its peak
// and the last: Activity Monitor's "Memory").
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { bundleGame } from "../engine/tools/bundle-game.ts";
import { repoRoot } from "./lib/paths.ts";
import { startLive, type Build } from "../engine/tools/lib/live.ts";
import { waitGpuLock } from "../engine/tools/lib/bench.ts";
const rendererBin = join(repoRoot, "engine/renderer/target/release/threert-render");
const room = process.argv[2] ?? "tokyo-night-tour", toEnd = (process.argv[3] ?? (room.includes("-route=") ? "route" : "")) === "route", secs = toEnd ? 0 : Number(process.argv[3] ?? 90), log = join(repoRoot, process.argv[4] ?? "out/tour.jsonl");
const bundle = join(repoRoot, "out/bundles/city.js");
await bundleGame(join(repoRoot, "scene/city.game.ts"), bundle);
const b: Build = { bin: rendererBin, assets: repoRoot, presets: join(repoRoot, "engine/presets"), bundles: join(repoRoot, "out/bundles"), label: "city" };
await waitGpuLock("tokyo-tour", 60 * 60_000);
const live = startLive(b, bundle, { scale: "auto", room, frameLog: log, env: { THREERT_SCRIPT_MB: "12288", THREERT_EDIT_LOG: "1" } });
const first = await live.firstFrame;
console.log(`first frame ${(first / 1000).toFixed(1)} s`);
// (the physical footprint, GB: top's MEM column. Not vmmap: it suspends the process while it reads its map, ~1.4 s
// for the city, which a benchmark sampling it every few seconds measures as its own stalls)
const footprint = () => {
  if (process.platform !== "darwin") return NaN;
  try {
    const m = /^\s*\d+\s+([\d.]+)([KMG])\+?/m.exec(execFileSync("top", ["-l", "1", "-pid", String(live.p.pid), "-stats", "pid,mem"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("PID")[1] ?? "");
    return m ? Number(m[1]) / (m[2] === "G" ? 1 : m[2] === "M" ? 1024 : 1024 * 1024) : NaN;
  } catch {
    return NaN;
  }
};
const memory: number[] = [];
const sampler = setInterval(() => memory.push(footprint()), 5000);
const shots = (process.env.SHOTS ?? "").split(",").filter(Boolean).map(Number);
const t0 = Date.now();
for (const t of shots) {
  await new Promise((r) => setTimeout(r, Math.max(0, t0 + t * 1000 - Date.now())));
  const p = join(repoRoot, `out/tour-${room}-${t}.png`);
  live.send({ cmd: "snapshot", path: p, after: 1 });
}
if (toEnd) await live.wait((l) => l.includes("tokyo: route end"), 20 * 60_000);
else await new Promise((r) => setTimeout(r, Math.max(0, t0 + secs * 1000 - Date.now())));
clearInterval(sampler);
memory.push(footprint());
const route = live.lines.find((l) => l.includes("tokyo: route "));
if (route) console.log(route.replace(/^\[game\] /, ""));
const fp = memory.filter((x) => !isNaN(x));
if (fp.length) console.log(`physical footprint: peak ${Math.max(...fp).toFixed(1)} GB, at the end ${fp[fp.length - 1].toFixed(1)} GB (${fp.length} samples)`);
const elapsed = (Date.now() - t0) / 1000;
const snap = join(repoRoot, "out/tour-end.png");
live.send({ cmd: "snapshot", path: snap, after: 1 });
await live.wait((l) => l.includes(snap), 60000).catch(() => {});
await live.quit();
const L = readFileSync(log, "utf8").trim().split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const s = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const iv = L.map((x) => x.interval), g = L.map((x) => x.gpu);
console.log(`${L.length} frames in ${(toEnd ? elapsed : secs).toFixed(0)} s; interval p50 ${s(iv, 0.5).toFixed(1)} p95 ${s(iv, 0.95).toFixed(1)} p99 ${s(iv, 0.99).toFixed(1)} max ${s(iv, 1).toFixed(1)} ms; GPU p50 ${s(g, 0.5).toFixed(1)} p95 ${s(g, 0.95).toFixed(1)}; over 50 ms ${iv.filter((x) => x > 50).length}; rebuilds ${L.filter((x) => x.rebuild > 1).length}; edit p95 ${s(L.map((x) => x.edit ?? 0), 0.95).toFixed(1)} ms; scale p50 ${s(L.map((x) => x.scale), 0.5)}`);
for (const x of L.filter((x) => x.rebuild > 1).slice(0, 5)) console.log("  rebuild:", x.fallback, Math.round(x.rebuild), "ms");
console.log("edit lines:", live.lines.filter((l) => l.startsWith("edit:")).length); { const k = live.lines.findIndex((l) => l.startsWith("live: 1280")); console.log(live.lines.slice(k).filter((l) => l.startsWith("world:") || l.includes("rebuild") || l.includes("structural at") || l.includes("fallback") || l.startsWith("    at ")).slice(0, 15).map((l) => l.slice(0, 200)).join("\n")); }
