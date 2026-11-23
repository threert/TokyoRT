// Model origins are at ground contact (wall fittings face +Z). Placements reuse these small GLBs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MeshStandardMaterial } from "@threert/scene";
import { Batches, cross, Frame, norm, rng, sub, type V3 } from "../../scene/hero/builder.ts";
import { MODEL_KEYS } from "../../scene/hero/dress.ts";
import { GlbBuilder } from "./glb.ts";
import { repoRoot } from "../lib/paths.ts";

const dir = join(repoRoot, "assets/city/street-models");
mkdirSync(dir, { recursive: true });
const frame = new Frame([0, 0, 0], [1, 0, 0], [0, 0, 1]), tau = 2 * Math.PI;
const paint = (name: string, color: number, roughness = .65, metalness = 0) =>
  new MeshStandardMaterial({ name, color, roughness, metalness });
const enamel = paint("ivory enamel", 0xd5ceae, .43, .14), steel = paint("galvanized steel", 0xa4aba4, .38, .73);
const iron = paint("cast iron", 0x545b58, .64, .48), dark = paint("rubber", 0x262b28, .67);
const cedar = paint("cedar", 0x987349),
  endgrain = paint("endgrain", 0xb28c5e),
  brass = paint("brass", 0xb49b58, .32, .73);
const terracotta = paint("unglazed clay", 0xb56f50),
  earth = paint("soil", 0x44372b),
  porcelain = paint("porcelain", 0xdad5bd, .38);
const leaves = [0x495f32, 0x687b3d, 0x7d8947, 0x3d5b37, 0x526c49].map((c, i) => paint("leaf " + i, c));
const bark = paint("bark", 0x685746),
  glass = paint("opal glass", 0xe4dfc7, .22),
  red = paint("red indicator", 0xad4c39);
const cratePaint = [0xa76436, 0x566f69, 0x9b8143].map((c, i) => paint("crate " + i, c, .51));
type Mat = MeshStandardMaterial;

function generate(key: typeof MODEL_KEYS[number]) {
  const b = new Batches(), r = rng(1601 + MODEL_KEYS.indexOf(key) * 73);
  const box = (m: Mat, x: number, y: number, z: number, w: number, h: number, d: number) =>
    b.box(m, frame, x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2);
  const rod = (m: Mat, a: V3, c: V3, radius: number, sides = 8) => b.tube(m, [a, c], radius, sides, true);
  const cyl = (m: Mat, x: number, y: number, z: number, low: number, high: number, h: number, n = 16) =>
    b.cylinder(m, [x, y, z], low, high, h, n);
  function ring(m: Mat, x: number, y: number, z: number, radius: number, gauge: number, vertical = false) {
    const path: V3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = tau * i / 24;
      path.push([
        x + Math.cos(a) * radius,
        y + (vertical ? Math.sin(a) * radius : 0),
        z + (vertical ? 0 : Math.sin(a) * radius),
      ]);
    }
    b.tube(m, path, gauge, 5);
  }
  function plant(x: number, y: number, z: number, height: number, spread: number, branches: number) {
    const base: V3 = [x, y, z], fork: V3 = [x + .045 * height, y + .43 * height, z];
    rod(bark, base, fork, height * .022);
    for (let j = 0; j < branches; j++) {
      const a = j * 2.39996 + r.range(-.26, .26);
      const crown = 1 - j / (branches * 1.3), reach = spread * crown * r.range(.80, 1.12);
      const end: V3 = [fork[0] + Math.cos(a) * reach, y + height * (.53 + .42 * j / branches), z + Math.sin(a) * reach];
      rod(bark, fork, end, height * .009, 6);
      const clusters = height > 2 ? 4 : 2;
      for (let f = 0; f < clusters; f++) {
        const stem: V3 = [
          end[0] + r.range(-.24, .24) * reach,
          end[1] + r.range(-.07, .07) * height,
          end[2] + r.range(-.24, .24) * reach,
        ];
        for (let i = 0; i < 9; i++) {
          const angle = tau * i / 9 + r.range(-.32, .32), length = spread * r.range(.27, .58);
          const dx = Math.cos(angle), dz = Math.sin(angle), half = length * .19;
          const tip: V3 = [stem[0] + dx * length, stem[1] + length * r.range(-.47, .43), stem[2] + dz * length];
          const mx = stem[0] + dx * .53 * length, mz = stem[2] + dz * .53 * length;
          const mid: V3 = [mx, (tip[1] + stem[1]) / 2 + half * .35, mz];
          const left: V3 = [mx - dz * half, mid[1] - half * .6, mz + dx * half],
            right: V3 = [mx + dz * half, mid[1] - half * .6, mz - dx * half];
          const mat = r.pick(leaves);
          for (const [a, c, d] of [[stem, left, mid], [left, tip, mid], [tip, right, mid], [right, stem, mid]]) {
            const n = norm(cross(sub(c, a), sub(d, a)));
            b.tri(mat, a, c, d, n[1] < 0 ? [-n[0], -n[1], -n[2]] : n);
          }
        }
      }
    }
  }
  if (key === "aircon" || key === "airconRust") {
    const casing = key === "aircon" ? enamel : paint("aged sage paint", 0xa7ab92);
    box(casing, 0, .045, 0, .79, .52, .29);
    box(dark, -.12, .105, .148, .43, .405, .014);
    const cx = -.12, cy = .31;
    for (let i = 0; i < 5; i++) {
      const a = i * tau / 5;
      const point = (rad: number, t: number): V3 => [cx + rad * Math.cos(t), cy + rad * Math.sin(t), .163];
      b.tri(iron, point(.025, a), point(.18, a + .55), point(.155, a + 1.04), [0, 0, 1]);
    }
    for (let i = 1; i <= 4; i++) ring(steel, cx, cy, .181, i * .047, .0038, true);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 4;
      rod(
        steel,
        [cx - .192 * Math.cos(a), cy - .192 * Math.sin(a), .184],
        [cx + .192 * Math.cos(a), cy + .192 * Math.sin(a), .184],
        .003,
        5,
      );
    }
    for (let i = 0; i < 11; i++) box(iron, .23, .14 + i * .026, .148, .14, .008, .012);
    box(porcelain, .24, .45, .153, .12, .047, .008);
    for (const x of [-.27, .27]) box(dark, x, 0, 0, .115, .05, .31);
  } else if (key.startsWith("crate") || key === "wcrate") {
    const wooden = key === "wcrate",
      m = wooden ? cedar : cratePaint[Number(key.slice(-1)) - 1],
      h = key === "crate3" ? .27 : .26;
    box(m, 0, 0, 0, .45, .027, .32);
    for (const x of [-.211, .211]) for (const z of [-.146, .146]) box(m, x, 0, z, .028, h, .028);
    for (const z of [-.15, .15]) {
      for (let j = 0; j < 3; j++) box(m, 0, .037 + j * .075, z, .44, .04, .016);
      for (let j = -3; j <= 3; j++) box(m, j * .054, .026, z, .011, h - .04, .017);
    }
    for (const x of [-.214, .214]) for (let j = 0; j < 3; j++) box(m, x, .037 + j * .075, 0, .015, .04, .30);
    for (const z of [-.15, .15]) box(m, 0, h - .021, z, .46, .021, .029);
    for (const x of [-.212, .212]) box(m, x, h - .021, 0, .035, .021, .31);
  } else if (key === "plant1" || key === "plant2" || key === "plant4") {
    const rad = key === "plant1" ? .14 : key === "plant2" ? .11 : .085;
    cyl(terracotta, 0, 0, 0, rad * .72, rad, .20);
    cyl(terracotta, 0, .19, 0, rad * 1.12, rad * 1.12, .03);
    cyl(earth, 0, .217, 0, rad * .9, rad * .9, .006);
    plant(0, .225, 0, key === "plant1" ? .53 : key === "plant2" ? .38 : .22, rad * 1.35, 10);
  } else if (key === "planter") {
    box(terracotta, 0, 0, 0, .57, .21, .21);
    box(earth, 0, .21, 0, .54, .009, .18);
    for (const x of [-.16, 0, .16]) plant(x, .22, 0, .26, .09, 6);
  } else if (key === "stool") {
    for (const x of [-.15, .15]) {
      rod(cedar, [x, 0, -.14], [x, .40, .13], .017);
      rod(cedar, [x, 0, .14], [x, .40, -.13], .017);
      rod(steel, [x - .014, .19, 0], [x + .014, .19, 0], .018);
    }
    for (let j = 0; j < 4; j++) box(endgrain, 0, .40, -.113 + j * .075, .36, .027, .066);
  } else if (key === "box") {
    const card = paint("cardboard", 0xb2976e, .94);
    box(card, 0, 0, 0, .37, .29, .32);
    box(endgrain, 0, .29, 0, .053, .002, .32);
    box(porcelain, .09, .09, .161, .105, .065, .003);
  } else if (key === "propane" || key === "can") {
    const tank = key === "propane", m = tank ? paint("bottle grey", 0xb6bab1, .53, .28) : steel;
    cyl(m, 0, .035, 0, .115, .145, .068);
    cyl(m, 0, .103, 0, .145, .145, tank ? .47 : .30);
    const y = tank ? .573 : .403;
    cyl(m, 0, y, 0, .146, tank ? .045 : .115, .055);
    if (tank) {
      cyl(brass, 0, y + .052, 0, .026, .026, .063);
      ring(iron, 0, y + .124, 0, .057, .009);
      cyl(m, 0, 0, 0, .119, .119, .05);
    } else {
      ring(steel, 0, y + .007, 0, .148, .015);
      for (let i = 0; i < 14; i++) {
        const a = tau * i / 14;
        rod(steel, [.145 * Math.cos(a), .11, .145 * Math.sin(a)], [.145 * Math.cos(a), .36, .145 * Math.sin(a)], .004);
      }
    }
  } else if (key === "trashbag") {
    cyl(dark, 0, 0, 0, .105, .16, .16, 11);
    cyl(dark, 0, .16, 0, .16, .08, .14, 11);
    cyl(dark, .015, .30, 0, .075, .013, .055, 9);
    ring(steel, .015, .349, 0, .019, .003);
  } else if (key === "manhole") {
    cyl(iron, 0, 0, 0, .295, .295, .012, 32);
    ring(dark, 0, .014, 0, .274, .004);
    ring(iron, 0, .016, 0, .20, .006);
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) if (i * i + j * j <= 11) box(dark, i * .063, .012, j * .063, .037, .006, .009);
    }
  } else if (key === "camera") {
    rod(steel, [0, .10, -.04], [0, .18, .13], .022);
    box(enamel, 0, .17, .19, .135, .115, .28);
    box(enamel, 0, .275, .21, .155, .019, .32);
    rod(dark, [0, .222, .316], [0, .222, .34], .031, 14);
  } else if (key === "socket" || key === "wallLamp") {
    cyl(porcelain, 0, 0, 0, .043, .045, .065);
    b.lantern(glass, [0, .118, 0], key === "socket" ? .037 : .06, .105, 14, 6);
    if (key === "wallLamp") {
      cyl(iron, 0, .17, 0, .09, .036, .04);
      ring(iron, 0, .098, 0, .067, .005);
    }
  } else if (key === "powerbox" || key === "utility") {
    const large = key === "utility", w = large ? .47 : .27, h = large ? .83 : .38, d = large ? .26 : .15;
    box(iron, 0, 0, 0, w, h, d);
    box(enamel, 0, .012, d * .50, w * .94, h - .024, .012);
    for (let i = 0; i < 5; i++) box(iron, 0, h * .62 + i * .016, d * .55, w * .55, .005, .01);
    box(dark, w * .35, h * .45, d * .55, .012, .049, .012);
    box(red, -w * .27, h * .85, d * .55, .02, .016, .013);
  } else throw new Error("Missing procedural model: " + key);
  const glb = new GlbBuilder();
  for (const e of b.entries()) {
    const m = e.material;
    const mat = glb.material({
      name: m.name,
      color: [m.color.r, m.color.g, m.color.b],
      roughness: m.roughness,
      metallic: m.metalness,
      doubleSided: leaves.includes(m),
    });
    glb.triangles(mat, e.positions, e.normals, e.uvs, e.index);
  }
  writeFileSync(join(dir, key + ".glb"), glb.build(key));
}
for (const key of MODEL_KEYS) generate(key);
console.log(`Generated ${MODEL_KEYS.length} street models`);
