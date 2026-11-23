// Every shop's signs (scene/hero/shops.ts) as worn signs: drawn as SVG through sharp with the
// system's Japanese fonts, then aged in raw pixels: backlit faces brighter at the middle with the fluorescent tubes behind
// them showing as faint bands, yellowed plastic, dirt toward the edges and the bottom, dead insects inside the box,
// faded dye on the noren, grain on the wooden plates. One 512 x 512 slot a shop, sixteen a 2048 x 2048 page.
//
//   node tools/tokyo/hero-shops.ts   -> assets/city/hero/tex/shops-<page>.png (+ shops-preview.jpg)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { repoRoot } from "../lib/paths.ts";
import { PAD, PAGE, SHOP_PAGES, SHOPS, SHOPS_PER_PAGE, SLOT, SLOT_CELLS, SLOTS_PER_ROW, type Pictogram, type Shop } from "../../scene/hero/shops.ts";

const dir = join(repoRoot, "assets/city/hero/tex");
mkdirSync(dir, { recursive: true });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&apos;");
const fam = (f: string) => `${f}, Hiragino Sans, sans-serif`;
const isCJK = (s: string) => /[　-鿿＀-￯]/.test(s);
/** Rough advance of a string at size 1 (CJK glyphs are square; Latin about 0.6, caps wider). */
const advance = (s: string) => [...s].reduce((w, c) => w + (isCJK(c) ? 1 : /[A-Z]/.test(c) ? 0.78 : c === " " ? 0.32 : /[il'.]/.test(c) ? 0.3 : 0.62), 0);

function hash(i: number, j: number, s: number) {
  let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in 0..1, `oct` octaves, feature size `scale` px. */
function noise(x: number, y: number, scale: number, seed: number, oct = 4) {
  let v = 0, amp = 0.5, f = 1 / scale, norm = 0;
  for (let o = 0; o < oct; o++) {
    const X = x * f, Y = y * f, i = Math.floor(X), j = Math.floor(Y), u = X - i, w = Y - j;
    const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
    const a = hash(i, j, seed + o), b = hash(i + 1, j, seed + o), c = hash(i, j + 1, seed + o), d = hash(i + 1, j + 1, seed + o);
    v += amp * ((a * (1 - su) + b * su) * (1 - sw) + (c * (1 - su) + d * su) * sw);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------- pictograms (simple, brand-free), drawn in a 100 x 100 box
function pictogram(p: Pictogram, x: number, y: number, s: number, color: string): string {
  const k = s / 100, t = (px: number, py: number) => `${(x + px * k).toFixed(1)},${(y + py * k).toFixed(1)}`;
  switch (p) {
    case "glass": return `<path d="M${t(15, 12)} L${t(85, 12)} L${t(50, 52)} Z" fill="${color}"/><rect x="${x + 47 * k}" y="${y + 50 * k}" width="${6 * k}" height="${32 * k}" fill="${color}"/><rect x="${x + 28 * k}" y="${y + 82 * k}" width="${44 * k}" height="${6 * k}" fill="${color}"/><circle cx="${x + 72 * k}" cy="${y + 14 * k}" r="${8 * k}" fill="none" stroke="${color}" stroke-width="${4 * k}"/>`;
    case "cat": return `<path d="M${t(20, 90)} Q${t(14, 50)} ${t(30, 38)} L${t(26, 12)} L${t(42, 30)} Q${t(50, 27)} ${t(58, 30)} L${t(74, 12)} L${t(70, 38)} Q${t(86, 50)} ${t(80, 90)} Z" fill="${color}"/><path d="M${t(78, 86)} Q${t(98, 80)} ${t(92, 60)}" fill="none" stroke="${color}" stroke-width="${6 * k}"/>`;
    case "moon": return `<path d="M${t(62, 8)} A${42 * k},${42 * k} 0 1 0 ${t(92, 70)} A${34 * k},${34 * k} 0 1 1 ${t(62, 8)} Z" fill="${color}"/>`;
    case "note": return `<rect x="${x + 58 * k}" y="${y + 10 * k}" width="${7 * k}" height="${64 * k}" fill="${color}"/><ellipse cx="${x + 46 * k}" cy="${y + 76 * k}" rx="${17 * k}" ry="${12 * k}" fill="${color}"/><path d="M${t(62, 10)} Q${t(90, 22)} ${t(80, 46)}" fill="none" stroke="${color}" stroke-width="${7 * k}"/>`;
    case "star": return `<path d="M${t(50, 6)} L${t(61, 38)} L${t(95, 38)} L${t(67, 58)} L${t(78, 92)} L${t(50, 71)} L${t(22, 92)} L${t(33, 58)} L${t(5, 38)} L${t(39, 38)} Z" fill="${color}"/>`;
    case "bottle": return `<path d="M${t(43, 6)} L${t(57, 6)} L${t(57, 30)} Q${t(72, 38)} ${t(72, 54)} L${t(72, 92)} L${t(28, 92)} L${t(28, 54)} Q${t(28, 38)} ${t(43, 30)} Z" fill="${color}"/>`;
    case "fish": return `<path d="M${t(10, 50)} Q${t(40, 18)} ${t(72, 46)} L${t(94, 28)} L${t(90, 50)} L${t(94, 72)} L${t(72, 54)} Q${t(40, 82)} ${t(10, 50)} Z" fill="${color}"/>`;
    default: return "";
  }
}

/** A line of text fitted into width `w` at most size `max`, centred at (cx, baseline y); `hand` jitters each glyph. */
function line(text: string, cx: number, y: number, w: number, max: number, font: string, color: string, o: { weight?: number; hand?: number; seed?: number; anchor?: "middle" | "start" } = {}) {
  const size = Math.min(max, w / Math.max(0.5, advance(text)));
  const weight = o.weight ?? 700;
  if (!o.hand) return `<text x="${cx.toFixed(1)}" y="${y.toFixed(1)}" font-family="${fam(font)}" font-size="${size.toFixed(1)}" font-weight="${weight}" fill="${color}" text-anchor="${o.anchor ?? "middle"}">${esc(text)}</text>`;
  // hand-lettered: each glyph placed by hand, a little turned and off its line, the stroke a little uneven
  const glyphs = [...text], total = advance(text) * size;
  let x = cx - total / 2, out = "";
  glyphs.forEach((g, k) => {
    const a = (isCJK(g) ? 1 : /[A-Z]/.test(g) ? 0.7 : 0.56) * size;
    const r = (hash(k, 3, o.seed ?? 0) - 0.5) * 8 * o.hand!, dy = (hash(k, 5, o.seed ?? 0) - 0.5) * size * 0.08 * o.hand!, sc = 1 + (hash(k, 7, o.seed ?? 0) - 0.5) * 0.12 * o.hand!;
    const gx = x + a / 2, gy = y + dy;
    out += `<text transform="translate(${gx.toFixed(1)},${gy.toFixed(1)}) rotate(${r.toFixed(1)}) scale(${sc.toFixed(3)})" font-family="${fam(font)}" font-size="${size.toFixed(1)}" font-weight="${weight}" fill="${color}" stroke="${color}" stroke-width="${(size * 0.012).toFixed(2)}" text-anchor="middle">${esc(g)}</text>`;
    x += a;
  });
  return out;
}

// ---------------------------------------------------------------- the four signs of a shop, as SVG, in slot coordinates
function lightboxSvg(s: Shop, X: number, Y: number) {
  const [x0, y0, x1, y1] = SLOT_CELLS.lightbox, x = X + x0 + PAD, y = Y + y0 + PAD, W = x1 - x0 - 2 * PAD, H = y1 - y0 - 2 * PAD;
  const inv = s.style === "inverse";
  const bg = inv ? s.ink : s.face, fg = inv ? s.face : s.ink;
  let g = `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${bg}"/>`;
  let top = y + 8;
  if (s.style === "split") {
    g += `<rect x="${x}" y="${y}" width="${W}" height="${H * 0.26}" fill="${s.accent}"/>`;
    g += line(s.kind, x + W / 2, y + H * 0.2, W * 0.7, H * 0.17, "Hiragino Kaku Gothic ProN", bg, { weight: 700 });
    top = y + H * 0.26;
  } else {
    if (s.style === "border") g += `<rect x="${x + 9}" y="${y + 9}" width="${W - 18}" height="${H - 18}" rx="6" fill="none" stroke="${fg}" stroke-width="4"/>`;
    g += line(s.kind, x + W / 2, y + H * 0.22, W * 0.5, H * 0.15, "Hiragino Kaku Gothic ProN", inv ? s.face : s.accent, { weight: 700 });
    top = y + H * 0.24;
  }
  const bottom = y + H - (s.extra ? H * 0.18 : 10);
  let nx0 = x + 16, nw = W - 32;
  if (s.pictogram !== "none" && (s.style === "pictogram" || s.latin)) {
    const ps = Math.min(bottom - top - 8, 96);
    g += pictogram(s.pictogram, x + 16, top + (bottom - top - ps) / 2, ps, s.style === "pictogram" ? s.accent : fg);
    nx0 = x + 24 + ps;
    nw = W - ps - 40;
  }
  const hand = s.style === "hand" ? 1 : 0;
  const size = Math.min((bottom - top) * 0.92, nw / Math.max(0.5, advance(s.name)));
  g += line(s.name, nx0 + nw / 2, top + (bottom - top) / 2 + size * 0.36, nw, (bottom - top) * 0.92, s.font, fg, { hand, seed: s.index });
  if (s.extra) g += line(s.extra, x + W / 2, y + H - 12, W * 0.7, H * 0.11, "Hiragino Kaku Gothic ProN", inv ? s.face : s.accent, { weight: 400 });
  if (s.floor === "2F") g += `<text x="${x + W - 14}" y="${y + 30}" font-family="${fam("Hiragino Kaku Gothic StdN")}" font-size="24" font-weight="700" fill="${fg}" text-anchor="end">2F</text>`;
  return g;
}

function bladeSvg(s: Shop, X: number, Y: number) {
  const [x0, y0, x1, y1] = SLOT_CELLS.blade, x = X + x0 + PAD, y = Y + y0 + PAD, W = x1 - x0 - 2 * PAD, H = y1 - y0 - 2 * PAD;
  const inv = s.style === "inverse" || s.style === "split";
  const bg = inv ? s.ink : s.face, fg = inv ? s.face : s.ink;
  let g = `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${bg}"/>`;
  // the kind in a band at the top, the floor at the bottom
  g += `<rect x="${x}" y="${y}" width="${W}" height="${H * 0.12}" fill="${s.accent}"/>`;
  g += line(s.kind.length > 5 ? s.kind.slice(0, 5) : s.kind, x + W / 2, y + H * 0.09, W * 0.86, H * 0.07, "Hiragino Kaku Gothic ProN", bg, { weight: 700 });
  const glyphs = s.latin ? [s.vertical] : [...s.vertical];
  const top = y + H * 0.15, bottom = y + H * (s.floor === "2F" ? 0.86 : 0.95);
  if (s.latin) {
    // Latin names run up the sign, turned
    const size = Math.min(W * 0.62, (bottom - top) / Math.max(0.5, advance(s.vertical)));
    // (turned a quarter right the glyphs stand to the right of their baseline)
    g += `<text transform="translate(${x + W / 2 - size * 0.36},${(top + bottom) / 2}) rotate(90)" font-family="${fam(s.font)}" font-size="${size.toFixed(1)}" font-weight="700" fill="${fg}" text-anchor="middle">${esc(s.vertical)}</text>`;
  } else {
    const step = Math.min(W * 0.86, (bottom - top) / glyphs.length);
    glyphs.forEach((ch, k) => {
      const jit = s.style === "hand" ? (hash(k, 9, s.index) - 0.5) * 6 : 0;
      const ty = top + (k + 0.5) * step + step * 0.36;
      // small kana sit to the upper right in vertical writing
      const small = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/.test(ch);
      g += `<text transform="translate(${(x + W / 2 + (small ? step * 0.12 : 0)).toFixed(1)},${(ty - (small ? step * 0.12 : 0)).toFixed(1)}) rotate(${jit.toFixed(1)})" font-family="${fam(s.font)}" font-size="${(step * 0.9).toFixed(1)}" font-weight="700" fill="${fg}" text-anchor="middle">${esc(ch === "ー" ? "｜" : ch)}</text>`;
    });
  }
  if (s.floor === "2F") g += `<rect x="${x + 8}" y="${y + H * 0.88}" width="${W - 16}" height="${H * 0.1}" rx="5" fill="${fg}"/><text x="${x + W / 2}" y="${y + H * 0.955}" font-family="${fam("Hiragino Kaku Gothic StdN")}" font-size="${H * 0.065}" font-weight="700" fill="${bg}" text-anchor="middle">2F</text>`;
  return g;
}

function norenSvg(s: Shop, X: number, Y: number) {
  const [x0, y0, x1, y1] = SLOT_CELLS.noren, x = X + x0 + PAD, y = Y + y0 + PAD, W = x1 - x0 - 2 * PAD, H = y1 - y0 - 2 * PAD;
  let g = `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${s.cloth}"/>`;
  // a band at the top where it hangs on its pole
  g += `<rect x="${x}" y="${y}" width="${W}" height="${H * 0.1}" fill="${s.clothInk}" opacity="0.18"/>`;
  const name = !s.latin && s.name.length > 6 ? s.name.slice(0, 6) : s.name;
  g += line(name, x + W / 2, y + H * 0.66, W * 0.86, H * 0.5, s.latin ? s.font : "Hiragino Mincho ProN", s.clothInk, { hand: s.style === "hand" ? 0.6 : 0, seed: s.index + 7 });
  g += line(s.kind, x + W / 2, y + H * 0.9, W * 0.4, H * 0.12, "Hiragino Kaku Gothic ProN", s.clothInk, { weight: 400 });
  return g;
}

function plateSvg(s: Shop, X: number, Y: number) {
  const [x0, y0, x1, y1] = SLOT_CELLS.plate, x = X + x0 + PAD, y = Y + y0 + PAD, W = x1 - x0 - 2 * PAD, H = y1 - y0 - 2 * PAD;
  const wood = hash(s.index, 11, 1) < 0.55;
  const bg = wood ? "#9a6a3e" : s.face, fg = wood ? "#1c120a" : s.ink;
  let g = `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${bg}"/>`;
  if (!wood) g += `<rect x="${x + 5}" y="${y + 5}" width="${W - 10}" height="${H - 10}" fill="none" stroke="${fg}" stroke-width="2" opacity="0.5"/>`;
  g += line(s.name, x + W * 0.42, y + H * 0.68, W * 0.66, H * 0.62, wood ? "Hiragino Mincho ProN" : s.font, fg, { hand: wood ? 0.5 : 0, seed: s.index + 3 });
  g += line(s.extra.length < 9 ? s.extra : s.kind, x + W * 0.87, y + H * 0.6, W * 0.22, H * 0.22, "Hiragino Kaku Gothic ProN", fg, { weight: 400 });
  return g;
}

// ---------------------------------------------------------------- ageing, in raw pixels
type Rect = [number, number, number, number];
function cellRect(slotX: number, slotY: number, c: readonly [number, number, number, number]): Rect {
  return [slotX + c[0] + PAD, slotY + c[1] + PAD, slotX + c[2] - PAD, slotY + c[3] - PAD];
}

/** A backlit acrylic face: brighter at the middle, the tubes behind it as faint bands, yellowed by age, dirt at the
 *  edges and bottom, drips from the top, insects collected at the bottom inside, sun-faded colour. */
function ageBacklit(px: Buffer, r: Rect, s: Shop, vertical: boolean, seed: number) {
  const [x0, y0, x1, y1] = r, W = x1 - x0, H = y1 - y0, age = s.age;
  const tubes = vertical ? [0.5] : [0.3, 0.7];
  const yellow = age * 0.55, fade = age * 0.3;
  const drips = Array.from({ length: Math.floor(age * 6) }, (_, k) => ({ x: hash(k, seed, 21) * W, len: (0.15 + hash(k, seed, 22) * 0.5) * H, w: 3 + hash(k, seed, 23) * 9 }));
  const bugs = Array.from({ length: Math.floor(1 + age * 9) }, (_, k) => ({ x: hash(k, seed, 31) * W, y: H - 4 - hash(k, seed, 32) * H * (vertical ? 0.1 : 0.22), r: 1.2 + hash(k, seed, 33) * 2.2 }));
  // the cell's own colour variation: a warm or cool tint
  const tint = (hash(seed, 4, 41) - 0.5) * 0.06;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * PAGE + x) * 4, u = (x - x0) / W, v = (y - y0) / H;
    let R = px[i], G = px[i + 1], B = px[i + 2];
    // sun fading: towards the grey of the same lightness
    const l = 0.3 * R + 0.59 * G + 0.11 * B;
    R += (l - R) * fade; G += (l - G) * fade; B += (l - B) * fade;
    // yellowed plastic
    R *= 1 - yellow * 0.02; G *= 1 - yellow * 0.08; B *= 1 - yellow * 0.32;
    // backlight: a soft falloff to the edges, and the tubes
    const across = vertical ? u : v, along = vertical ? v : u;
    let light = 0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, along))) * Math.sin(Math.PI * Math.min(1, Math.max(0, across)));
    for (const t of tubes) light += 0.07 * Math.exp(-(((across - t) / 0.08) ** 2));
    // a tube near its end burns darker
    light *= 1 - 0.12 * Math.exp(-(((along - 0.04) / 0.05) ** 2)) - 0.12 * Math.exp(-(((along - 0.96) / 0.05) ** 2));
    // dirt: noise, heavier toward the edges and the bottom, and the drips from the top
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const n = noise(x, y, 26, seed, 4), fine = noise(x, y, 4, seed + 9, 2);
    let dirt = age * (0.4 * Math.max(0, 1 - edge / 0.1) + 0.45 * v * v) * (0.4 + 0.9 * n) + age * 0.12 * fine;
    for (const d of drips) {
      const dx = Math.abs((x - x0) - d.x) / d.w, dy = (y - y0) / d.len;
      if (dx < 1 && dy < 1) dirt += age * 0.35 * (1 - dx) * (1 - dy) * (0.6 + 0.4 * fine);
    }
    let dark = Math.min(0.75, dirt);
    for (const b of bugs) {
      const dd = Math.hypot((x - x0) - b.x, (y - y0) - b.y) / b.r;
      if (dd < 1.5) dark = Math.max(dark, 0.85 * Math.max(0, 1.5 - dd) / 1.5 + 0.1);
    }
    const f = light * (1 - dark);
    // dirt is brown, not grey
    px[i] = clamp(R * f * (1 + tint) + dark * 18);
    px[i + 1] = clamp(G * f + dark * 10);
    px[i + 2] = clamp(B * f * (1 - tint));
  }
}

/** Dyed cotton: a weave, the dye faded where the sun and hands reach it (the hem), stains, a slight crease shading. */
function ageCloth(px: Buffer, r: Rect, s: Shop, seed: number) {
  const [x0, y0, x1, y1] = r, W = x1 - x0, H = y1 - y0, age = s.age;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * PAGE + x) * 4, u = (x - x0) / W, v = (y - y0) / H;
    const weave = ((x & 1) ^ (y & 1)) ? 1.04 : 0.96;
    const crease = 1 + 0.05 * Math.sin(u * Math.PI * 2 * 4.5 + noise(x, y, 40, seed, 2) * 3);
    const fade = age * (0.15 + 0.35 * v * v) * (0.5 + noise(x, y, 30, seed + 1, 3));
    const stain = age * Math.max(0, noise(x, y, 18, seed + 2, 3) - 0.62) * 1.4;
    for (let c = 0; c < 3; c++) {
      let val = px[i + c] * weave * crease;
      val += (200 - val) * fade * 0.5;
      val *= 1 - stain * 0.5;
      px[i + c] = clamp(val);
    }
  }
}

/** A wooden or painted plate: grain, weathering, dirt in the corners. */
function agePlate(px: Buffer, r: Rect, s: Shop, seed: number) {
  const [x0, y0, x1, y1] = r, W = x1 - x0, H = y1 - y0, age = s.age;
  const wood = hash(s.index, 11, 1) < 0.55;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * PAGE + x) * 4, u = (x - x0) / W, v = (y - y0) / H;
    const grain = wood ? 0.85 + 0.3 * noise(x * 0.25, y * 6, 6, seed, 3) : 1;
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const dirt = age * (0.5 * Math.max(0, 1 - edge / 0.15) + 0.2) * noise(x, y, 14, seed + 5, 3);
    for (let c = 0; c < 3; c++) px[i + c] = clamp(px[i + c] * grain * (1 - dirt * 0.6));
  }
}

export async function shopPages() {
  for (let p = 0; p < SHOP_PAGES; p++) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE}" height="${PAGE}"><rect width="${PAGE}" height="${PAGE}" fill="#202020"/>`;
    const slots: { s: Shop; X: number; Y: number }[] = [];
    for (let k = 0; k < SHOPS_PER_PAGE; k++) {
      const s = SHOPS[p * SHOPS_PER_PAGE + k];
      if (!s) break;
      const X = (k % SLOTS_PER_ROW) * SLOT, Y = Math.floor(k / SLOTS_PER_ROW) * SLOT;
      slots.push({ s, X, Y });
      svg += lightboxSvg(s, X, Y) + bladeSvg(s, X, Y) + norenSvg(s, X, Y) + plateSvg(s, X, Y);
    }
    const { data } = await sharp(Buffer.from(svg + "</svg>")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const { s, X, Y } of slots) {
      ageBacklit(data, cellRect(X, Y, SLOT_CELLS.lightbox), s, false, s.index * 7 + 1);
      ageBacklit(data, cellRect(X, Y, SLOT_CELLS.blade), s, true, s.index * 7 + 2);
      ageCloth(data, cellRect(X, Y, SLOT_CELLS.noren), s, s.index * 7 + 3);
      agePlate(data, cellRect(X, Y, SLOT_CELLS.plate), s, s.index * 7 + 4);
    }
    await sharp(data, { raw: { width: PAGE, height: PAGE, channels: 4 } }).removeAlpha().png({ compressionLevel: 6 }).toFile(join(dir, `shops-${p}.png`));
  }
  console.log(`shops: ${SHOPS.length} shops on ${SHOP_PAGES} pages -> ${dir}/shops-*.png`);
}

if (import.meta.url === `file://${process.argv[1]}`) await shopPages();
