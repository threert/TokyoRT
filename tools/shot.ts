// An offline render (the path tracer at full quality) of the city from a camera, with the cells round it loaded.
//   node tools/shot.ts <out.png> <room> <x,y,z> <tx,ty,tz> [fov] [spp] [width height]
//   e.g. node tools/shot.ts out/alley.png tokyo-night 361.6,32.3,-495.8 398.6,32.8,-480.5 55 256
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { bundleGame } from "../engine/tools/bundle-game.ts";
import { repoRoot } from "./lib/paths.ts";

const [out, room, pos, target, fov = "55", spp = "256", w = "1920", h = "1080"] = process.argv.slice(2);
const p = pos.split(",").map(Number), t = target.split(",").map(Number);
const bundle = join(repoRoot, "out/bundles/city.js");
await bundleGame(join(repoRoot, "scene/city.game.ts"), bundle);
const bin = join(repoRoot, "engine/renderer/target/release/threert-render");
const r = execFileSync(bin, ["render", bundle, "-o", out, "--assets", repoRoot, "--room", `${room}-whole-at=${p.join(",")}`, "--spp", spp, "--width", w, "--height", h, "--camera", JSON.stringify({ position: p, target: t, fov: Number(fov) })], { env: { ...process.env, THREERT_SCRIPT_MB: "12288" }, stdio: ["ignore", "pipe", "inherit"] }).toString().trim().split("\n").pop()!;
const st = JSON.parse(r);
console.log(`${out}: ${(st.timings_ms.total_ms / 1000).toFixed(0)} s, ${st.spp} spp`);
