// Generate seamless material maps in texture space. Colour, normals, roughness and metal coverage
// are derived from the same joints, grain and surface relief so their features stay registered.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { repoRoot } from "../lib/paths.ts";

type Family =
  | "asphalt"
  | "plaster"
  | "concrete"
  | "wood"
  | "tiles"
  | "brick"
  | "pavers"
  | "shutter"
  | "sheet"
  | "grate"
  | "metal";
type Recipe = [id: string, family: Family, rgb: number[], rough: number, across?: number, down?: number];
const recipes: Recipe[] = [
  ["asphalt", "asphalt", [79, 78, 76], 196],
  ["asphalt-fresh", "asphalt", [87, 86, 83], 181],
  ["stucco-cream", "plaster", [218, 211, 192], 208],
  ["stucco-grey", "plaster", [210, 210, 202], 216],
  ["plaster-painted", "plaster", [213, 196, 178], 192],
  ["plaster-warm", "plaster", [206, 194, 168], 211],
  ["plaster-white", "plaster", [222, 218, 204], 203],
  ["concrete-wall", "concrete", [157, 152, 140], 200],
  ["concrete-coated", "concrete", [165, 166, 155], 167],
  ["concrete-worn", "concrete", [153, 148, 136], 199],
  ["concrete-brushed", "concrete", [163, 160, 150], 204],
  ["concrete-weathered", "concrete", [148, 144, 134], 207],
  ["concrete-painted", "concrete", [183, 179, 164], 175],
  ["pavers", "pavers", [159, 153, 138], 201, 12, 20],
  ["tiles-long-white", "tiles", [219, 208, 185], 113, 9, 20],
  ["tiles-facade", "tiles", [176, 169, 152], 139, 10, 16],
  ["tiles-cladding", "tiles", [185, 178, 159], 145, 7, 14],
  ["tiles-cladding-terracotta", "tiles", [183, 133, 101], 139, 10, 18],
  ["brick", "brick", [146, 99, 79], 192, 9, 20],
  ["planks-cedar", "wood", [141, 97, 61], 158, 8],
  ["planks-dark", "wood", [93, 70, 53], 163, 7],
  ["planks-black", "wood", [61, 58, 51], 145, 7],
  ["sheet-corrugated", "sheet", [152, 159, 157], 145, 23],
  ["shutter", "shutter", [182, 187, 183], 137, 30],
  ["grate", "grate", [105, 101, 89], 179, 18, 7],
  ["metal-painted", "metal", [134, 135, 118], 159],
];

const size = 1024, TAU = Math.PI * 2;
const frac = (v: number) => v - Math.floor(v);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a: number, b: number, t: number) => a + t * (b - a);
function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed, 1597334677);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function field(u: number, v: number, count: number, seed: number) {
  const x = u * count, y = v * count, ix = Math.floor(x), iy = Math.floor(y);
  const dx = frac(x), dy = frac(y), tx = dx * dx * (3 - 2 * dx), ty = dy * dy * (3 - 2 * dy);
  const x0 = ix % count, x1 = (ix + 1) % count, y0 = iy % count, y1 = (iy + 1) % count;
  return mix(mix(hash(x0, y0, seed), hash(x1, y0, seed), tx), mix(hash(x0, y1, seed), hash(x1, y1, seed), tx), ty);
}
function edge(t: number) {
  const f = frac(t);
  return Math.min(f, 1 - f);
}

async function make([id, family, rgb, roughness, across = 8, down = 16]: Recipe, seed: number) {
  const count = size * size;
  const color = Buffer.alloc(count * 3),
    normal = Buffer.alloc(count * 3),
    rough = Buffer.alloc(count),
    metal = Buffer.alloc(count);
  const heights = new Float32Array(count);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, u = x / size, v = y / size;
      const grain = hash(x, y, seed), cloud = field(u, v, 5, seed), mid = field(u, v, 32, seed + 1);
      let tone = (cloud - .5) * .13 + (mid - .5) * .05 + (grain - .5) * .05;
      let h = (grain - .5) * .10, wear = 0, gloss = roughness, metallic = 0;
      if (family === "tiles" || family === "brick" || family === "pavers") {
        const row = Math.floor(v * down), col = u * across + (family === "tiles" ? 0 : (row % 2) * .5);
        const tile = hash(Math.floor(col) % across, row % down, seed + 9) - .5;
        const gap = Math.min(edge(col) * size / across, edge(v * down) * size / down);
        const face = clamp((gap - .8) / 2.2);
        tone += tile * .13 - (1 - face) * .36;
        h += face * 1.75 + (family === "brick" ? (mid - .5) * .65 : 0);
        gloss = mix(218, roughness + tile * 18, face);
      } else if (family === "wood") {
        const plank = Math.floor(u * across), plankTone = hash(plank, 0, seed);
        const knotV = hash(plank, 1, seed), dv = Math.sin(Math.PI * (v - knotV));
        const knot = Math.exp(-14 * (frac(u * across) - .53) ** 2 - 36 * dv * dv);
        const phase = u * across * 17 + .85 * Math.sin(TAU * v + TAU * plankTone) + .7 * mid + 3 * knot;
        const ring = Math.sin(TAU * phase), groove = 1 - clamp(edge(u * across) * size / across / 2);
        h += ring * .16 - groove * 1.8;
        tone += ring * .055 + (plankTone - .5) * .23 - groove * .42 - knot * .22;
      } else if (family === "shutter" || family === "sheet") {
        const t = frac((family === "sheet" ? u : v) * across);
        const profile = family === "sheet" ? Math.cos(TAU * t) : clamp(t * 9) * clamp((1 - t) * 17);
        h += profile * 2.2;
        tone += (profile - .55) * .095;
        const bolts = clamp(1 - Math.hypot(edge(u * 4) * size / 4, edge(v * 4) * size / 4) / 2.7);
        h += bolts * 1.6;
        metallic = family === "sheet" ? 175 : 0;
      } else if (family === "grate") {
        const rib = clamp(2 - Math.min(edge(u * across) * size / across / 3.2, edge(v * down) * size / down / 3));
        h += rib * 3;
        tone -= .77 * (1 - rib);
        metallic = 205 * rib;
        gloss = 165 + 40 * (1 - rib);
      } else if (family === "asphalt") {
        const aggregate = field(u, v, 256, seed + 3);
        tone += (aggregate - .5) * .24 + (grain - .5) * .27 + (grain > .965 ? .22 : 0);
        h += (aggregate - .5) * 1.1 + (grain - .5) * .62;
        gloss += 23 * (aggregate - .5);
      } else if (family === "metal") {
        wear = clamp((mid + .45 * cloud - .86) * 2.8);
        h += wear * .9;
        gloss += wear * 50;
      } else {
        const sand = field(u, v, 192, seed + 4);
        const pits = clamp((.18 - sand) * 5);
        h += (sand - .5) * (family === "plaster" ? 1.3 : .7) - pits * .75;
        tone += (sand - .5) * .072 - pits * .14;
        if (id === "concrete-brushed") h += .15 * Math.sin(TAU * (v * 190 + mid));
      }
      for (let c = 0; c < 3; c++) color[i * 3 + c] = byte(mix(rgb[c] * (1 + tone), [125, 77, 48][c], wear));
      heights[i] = h;
      rough[i] = byte(gloss + (grain - .5) * 12);
      metal[i] = byte(metallic);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (heights[y * size + (x + 1) % size] - heights[y * size + (x + size - 1) % size]) * .55;
      const dy = (heights[((y + 1) % size) * size + x] - heights[((y + size - 1) % size) * size + x]) * .55;
      const length = Math.hypot(dx, dy, 1);
      normal[i * 3] = byte(127.5 * (1 - dx / length));
      normal[i * 3 + 1] = byte(127.5 * (1 + dy / length));
      normal[i * 3 + 2] = byte(127.5 * (1 + 1 / length));
    }
  }
  const dir = join(repoRoot, "assets/city/finishes", id);
  mkdirSync(dir, { recursive: true });
  const save = (name: string, buf: Buffer, channels: 1 | 3) =>
    sharp(buf, { raw: { width: size, height: size, channels } }).png().toFile(join(dir, name + ".png"));
  await Promise.all([
    save("color", color, 3),
    save("rough", rough, 1),
    save("normal", normal, 3),
    ...(family === "grate" || family === "sheet" ? [save("metal", metal, 1)] : []),
  ]);
}
for (const [i, recipe] of recipes.entries()) await make(recipe, i + 17);
console.log(`Generated ${recipes.length} tileable surface sets at ${size}px`);
