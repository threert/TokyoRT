// Textures for the hero district's street-level dressing (scene/hero): lightbox faces with bars' names, blade
// signs, paper lanterns, noren, a vending machine's front, posters and window blinds. Drawn as SVG through sharp with the
// system's Japanese fonts (as tools/tokyo/signs.ts does). The names are made up.
//
//   node tools/tokyo/hero-textures.ts   -> assets/city/hero/tex/*.png (with shops-<page>.png, tools/tokyo/hero-shops.ts)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { repoRoot } from "../lib/paths.ts";
import { shopPages } from "./hero-shops.ts";

const dir = join(repoRoot, "assets/city/hero/tex");
mkdirSync(dir, { recursive: true });
const MINCHO = "Hiragino Mincho ProN, Hiragino Mincho Pro, BIZ UDMincho, serif";
const GOTHIC = "Hiragino Kaku Gothic ProN, Hiragino Sans, sans-serif";
const HEAVY = "Hiragino Kaku Gothic StdN, Hiragino Kaku Gothic Std, Hiragino Sans, sans-serif";
const MARU = "Hiragino Maru Gothic ProN, Hiragino Maru Gothic Pro, sans-serif";
const FONTS = [MINCHO, GOTHIC, HEAVY, MARU];

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export const NAMES = [
  "灯", "月影", "夜行", "ひなた", "小舟", "鈴音", "蛍", "朧", "縁", "寄り道", "三日月", "路地裏", "白鷺", "狐火", "雨宿り",
  "夕凪", "千鳥", "紬", "椿", "黒猫", "夜長", "旅烏", "灯台", "青鬼", "とんぼ", "まほろば", "ねこまた", "かもめ", "星屑",
  "おぼろ月", "はなび", "つきあかり",
];
const KINDS = ["BAR", "スナック", "酒処", "呑み処", "Bar", "居酒屋", "バー", "小料理", "LIVE BAR", "炉端"];
const LATIN = ["NIGHTJAR", "Little Owl", "MOONSHINE", "Blue Note", "SLOW BOAT", "Kitsune", "LAMP", "Paper Moon", "OASIS", "Tsuki"];

/** Lightbox faces: 4 x 8 cells of 512 x 256 (acrylic, lit from inside). */
async function lightboxes() {
  const W = 512, H = 256;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * W}" height="${8 * H}">`;
  for (let i = 0; i < 32; i++) {
    const x = (i % 4) * W, y = Math.floor(i / 4) * H;
    const scheme = pick([
      { bg: "#f4f1e8", fg: "#b3121b", sub: "#222" }, { bg: "#f6f3ea", fg: "#151515", sub: "#b3121b" },
      { bg: "#f2efe2", fg: "#123a8a", sub: "#333" }, { bg: "#141414", fg: "#f3d23c", sub: "#eee" },
      { bg: "#a5121a", fg: "#fbf6ea", sub: "#fbf6ea" }, { bg: "#f8e9c0", fg: "#3a1d0e", sub: "#7a2a10" },
      { bg: "#0d2a4f", fg: "#f6f1e3", sub: "#9fd0ff" }, { bg: "#f5f5f0", fg: "#2c6e2f", sub: "#222" },
      { bg: "#efe6d2", fg: "#5a1e6e", sub: "#333" },
    ]);
    const latin = rnd() < 0.25;
    const name = latin ? pick(LATIN) : pick(NAMES), kind = pick(KINDS), font = latin ? pick([GOTHIC, HEAVY]) : pick(FONTS);
    const size = latin ? Math.min(110, 440 / (0.68 * name.length)) : Math.min(150, 420 / name.length);
    svg += `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${scheme.bg}"/>`;
    // a thin border line inside some faces, as printed panels have
    if (rnd() < 0.5) svg += `<rect x="${x + 14}" y="${y + 14}" width="${W - 28}" height="${H - 28}" fill="none" stroke="${scheme.fg}" stroke-width="5"/>`;
    svg += `<text x="${x + W / 2}" y="${y + 70}" font-family="${GOTHIC}" font-size="34" font-weight="700" fill="${scheme.sub}" text-anchor="middle">${esc(kind)}</text>`;
    svg += `<text x="${x + W / 2}" y="${y + 92 + size * 0.85}" font-family="${font}" font-size="${size}" font-weight="700" fill="${scheme.fg}" text-anchor="middle">${esc(name)}</text>`;
    if (rnd() < 0.6) svg += `<text x="${x + W / 2}" y="${y + H - 22}" font-family="${GOTHIC}" font-size="22" fill="${scheme.sub}" text-anchor="middle">${esc(pick(["2F", "1F", "OPEN 19:00", "会員制", "チャージ ¥1000", "どなたでも", "Since 1972", "TEL 03-3209-xxxx"]))}</text>`;
  }
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "lightbox.png"));
}

/** Vertical blade signs: 16 cells of 128 x 512. */
async function blades() {
  const W = 128, H = 512;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${16 * W}" height="${H}">`;
  for (let i = 0; i < 16; i++) {
    const x = i * W;
    const s = pick([{ bg: "#f4f1e8", fg: "#b3121b" }, { bg: "#141414", fg: "#f6f1e3" }, { bg: "#b3121b", fg: "#fff8e8" }, { bg: "#f6f3ea", fg: "#101010" }, { bg: "#1b3d78", fg: "#fff" }, { bg: "#f3d23c", fg: "#111" }]);
    const name = pick(NAMES).slice(0, 4), font = pick(FONTS);
    svg += `<rect x="${x}" y="0" width="${W}" height="${H}" fill="${s.bg}"/>`;
    svg += `<text x="${x + W / 2}" y="44" font-family="${GOTHIC}" font-size="26" font-weight="700" fill="${s.fg}" text-anchor="middle">${esc(pick(["BAR", "酒", "呑", "SNACK", "唄"]))}</text>`;
    const step = Math.min(100, 420 / name.length);
    [...name].forEach((ch, k) => (svg += `<text x="${x + W / 2}" y="${78 + (k + 0.85) * step}" font-family="${font}" font-size="${Math.min(96, step * 0.95)}" font-weight="700" fill="${s.fg}" text-anchor="middle">${esc(ch)}</text>`));
  }
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "blade.png"));
}

/** Paper lanterns (chōchin): 4 cells of 512 x 512, wrapped round a cylinder (u round, v down). Ribs drawn as faint
 *  horizontal lines; the black bands top and bottom are the lantern's rims. */
async function lanterns() {
  const S = 512;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * S}" height="${S}">`;
  const words = ["酒", "やきとり", "おでん", "呑"];
  const paper = ["#c8261c", "#d23a1e", "#efe3c4", "#c8261c"];
  for (let i = 0; i < 4; i++) {
    const x = i * S;
    svg += `<rect x="${x}" y="0" width="${S}" height="${S}" fill="${paper[i]}"/>`;
    for (let r = 40; r < S - 40; r += 14) svg += `<rect x="${x}" y="${r}" width="${S}" height="2" fill="#000" opacity="0.12"/>`;
    svg += `<rect x="${x}" y="0" width="${S}" height="34" fill="#141210"/><rect x="${x}" y="${S - 34}" width="${S}" height="34" fill="#141210"/>`;
    const w = words[i], ink = paper[i] === "#efe3c4" ? "#b3121b" : "#121010";
    // the word twice round the lantern (front and back), vertical
    for (const cx of [x + S * 0.25, x + S * 0.75]) {
      const step = Math.min(150, 400 / w.length);
      [...w].forEach((ch, k) => (svg += `<text x="${cx}" y="${70 + (k + 0.85) * step}" font-family="${MINCHO}" font-size="${step * 0.92}" font-weight="700" fill="${ink}" text-anchor="middle">${esc(ch)}</text>`));
    }
  }
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "lantern.png"));
}

/** Noren: 4 cells of 512 x 512, indigo / white / red / black cotton with a name across its panels. */
async function noren() {
  const S = 512;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * S}" height="${S}">`;
  const cloth = [{ bg: "#1d2a4a", fg: "#f2efe6" }, { bg: "#efeadc", fg: "#1d2a4a" }, { bg: "#8e1a1a", fg: "#f6efe0" }, { bg: "#1a1a1a", fg: "#e8e0cc" }];
  for (let i = 0; i < 4; i++) {
    const x = i * S, c = cloth[i], name = pick(NAMES).slice(0, 3);
    svg += `<rect x="${x}" y="0" width="${S}" height="${S}" fill="${c.bg}"/>`;
    // weave
    for (let r = 0; r < S; r += 4) svg += `<rect x="${x}" y="${r}" width="${S}" height="1" fill="#fff" opacity="0.04"/>`;
    const step = S / (name.length + 0.5);
    [...name].forEach((ch, k) => (svg += `<text x="${x + (k + 0.75) * step}" y="${S * 0.62}" font-family="${MINCHO}" font-size="${Math.min(200, step * 0.8)}" font-weight="700" fill="${c.fg}" text-anchor="middle">${esc(ch)}</text>`));
  }
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "noren.png"));
}

/** A drinks vending machine's front (1024 x 2048): a lit header, five rows of cans and bottles behind the window, the
 *  price buttons under each, the coin panel and the take-out slot. Emissive where the window and buttons glow. */
async function vending() {
  const W = 1024, H = 2048;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#e9ebee"/>`;
  svg += `<rect x="40" y="40" width="${W - 80}" height="150" fill="#1a62b8"/><text x="${W / 2}" y="140" font-family="${HEAVY}" font-size="84" fill="#fff" text-anchor="middle">つめた〜い</text>`;
  svg += `<rect x="40" y="210" width="${W - 80}" height="1150" fill="#f7f8fa"/>`;
  const cols = 8, cw = (W - 120) / cols;
  for (let r = 0; r < 5; r++) {
    const y = 240 + r * 222;
    for (let c = 0; c < cols; c++) {
      const x = 60 + c * cw, hue = Math.floor(rnd() * 360), bottle = rnd() < 0.4, col = `hsl(${hue},${55 + rnd() * 35}%,${35 + rnd() * 25}%)`;
      if (bottle) {
        svg += `<rect x="${x + cw * 0.3}" y="${y + 20}" width="${cw * 0.4}" height="30" rx="6" fill="${col}"/>`;
        svg += `<rect x="${x + cw * 0.15}" y="${y + 50}" width="${cw * 0.7}" height="120" rx="14" fill="${col}"/>`;
        svg += `<rect x="${x + cw * 0.15}" y="${y + 85}" width="${cw * 0.7}" height="40" fill="#fff" opacity="0.85"/>`;
      } else {
        svg += `<rect x="${x + cw * 0.15}" y="${y + 40}" width="${cw * 0.7}" height="130" rx="10" fill="${col}"/>`;
        svg += `<rect x="${x + cw * 0.15}" y="${y + 40}" width="${cw * 0.7}" height="14" rx="6" fill="#ccc"/>`;
        svg += `<circle cx="${x + cw / 2}" cy="${y + 110}" r="${cw * 0.22}" fill="#fff" opacity="0.7"/>`;
      }
      svg += `<rect x="${x + cw * 0.1}" y="${y + 182}" width="${cw * 0.8}" height="26" rx="5" fill="#222"/><text x="${x + cw / 2}" y="${y + 202}" font-family="${GOTHIC}" font-size="20" fill="#ffd23a" text-anchor="middle">${pick([110, 130, 140, 160, 180, 200])}</text>`;
    }
  }
  svg += `<rect x="40" y="1380" width="${W - 80}" height="620" fill="#d8dbe0"/>`;
  svg += `<rect x="640" y="1420" width="300" height="260" rx="10" fill="#33373d"/><rect x="680" y="1460" width="100" height="40" fill="#79e07c"/><rect x="800" y="1460" width="100" height="40" fill="#222"/><text x="790" y="1600" font-family="${GOTHIC}" font-size="40" fill="#eee" text-anchor="middle">¥ IC</text>`;
  svg += `<rect x="100" y="1760" width="${W - 200}" height="190" rx="12" fill="#25282c"/><text x="${W / 2}" y="1720" font-family="${GOTHIC}" font-size="44" fill="#333" text-anchor="middle">とりだしぐち</text>`;
  svg += `<text x="300" y="1520" font-family="${HEAVY}" font-size="72" fill="#1a62b8" text-anchor="middle">Drink!</text>`;
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "vending.png"));
  // the glow mask: the window and the buttons
  let m = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000"/><rect x="40" y="40" width="${W - 80}" height="150" fill="#fff"/><rect x="40" y="210" width="${W - 80}" height="1150" fill="#fff"/>`;
  m += `<rect x="680" y="1460" width="100" height="40" fill="#fff"/></svg>`;
  await sharp(Buffer.from(m)).png().toFile(join(dir, "vending-glow.png"));
}

/**
 * Posters and flyers stuck on walls: 4 x 2 cells of 512 x 512, eight bills of a Shinjuku side street about 1980, each
 * its own layout (a jazz live house, a rakugo evening, draft beer, a folk live, a karaoke contest, a revival cinema, a
 * bar's reopening, a neighbourhood notice), on paper that has hung there a while: yellowed, darker at its edges, taped
 * at its corners, now and then a corner torn off. Its own random stream (after the 48 numbers the placeholder drew, so
 * the textures after it come out as they did). The names and places are made up.
 */
async function posters() {
  for (let i = 0; i < 48; i++) rnd();
  let ps = 77;
  const r = () => ((ps = (ps * 16807) % 2147483647) / 2147483647);
  const S = 512;
  const t = (x: number, y: number, size: number, fill: string, text: string, o: { font?: string; anchor?: string; weight?: string; vertical?: boolean; stroke?: string; sw?: number; spacing?: number } = {}) =>
    `<text x="${x}" y="${y}" font-family="${o.font ?? HEAVY}" font-size="${size}" fill="${fill}" text-anchor="${o.anchor ?? "middle"}"${o.weight ? ` font-weight="${o.weight}"` : ""}${o.vertical ? ` writing-mode="tb" glyph-orientation-vertical="0"` : ""}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 2}"` : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}>${esc(text)}</text>`;
  const lines = (x: number, y: number, w: number, n: number, color: string, gap = 20) => {
    let g = "";
    for (let l = 0; l < n; l++) g += `<rect x="${x}" y="${y + l * gap}" width="${w * (0.55 + r() * 0.45)}" height="8" fill="${color}" opacity="0.7"/>`;
    return g;
  };
  // eight bills, each drawn in a 512 x 512 box at (0, 0)
  const bills: (() => string)[] = [
    // a jazz live house: night blue, a horn's bell in brass, the bill of the week
    () => `<rect width="512" height="512" fill="#14223c"/><circle cx="360" cy="190" r="120" fill="#c8a24a" opacity="0.9"/><circle cx="360" cy="190" r="86" fill="#14223c"/>` +
      `<rect x="120" y="175" width="250" height="30" rx="14" fill="#c8a24a"/>` + t(160, 120, 92, "#f2e6c8", "JAZZ", { font: "Futura, Avenir Next, sans-serif", weight: "bold", anchor: "start" }) +
      t(256, 380, 40, "#f2e6c8", "ライブ・アット・ピット") + t(256, 430, 30, "#c8a24a", "11.28 SAT  19:00〜  ¥1,500") + lines(96, 460, 320, 2, "#8090b0", 18),
    // a rakugo evening: paper white, the title down the right in mincho, the players' names, the red seal
    () => `<rect width="512" height="512" fill="#efe6d2"/>` + t(430, 70, 80, "#1b1b1b", "新宿寄席", { font: MINCHO, vertical: true, weight: "bold" }) +
      t(330, 90, 38, "#1b1b1b", "落語の会", { font: MINCHO, vertical: true }) +
      [0, 1, 2, 3].map((k) => t(230 - k * 50, 110, 30, "#333", ["柳家小つる", "三遊亭円坊", "古今亭志ん", "桂文月"][k], { font: MINCHO, vertical: true })).join("") +
      `<rect x="40" y="380" width="96" height="96" fill="#b3261e" rx="6"/>` + t(88, 445, 44, "#efe6d2", "寄", { font: MINCHO }) + t(300, 490, 19, "#333", "毎月第三土曜 午後六時開演 木戸銭八百円", { font: MINCHO }),
    // draft beer: a glass of it (gold, its head), the price large
    () => `<rect width="512" height="512" fill="#b8171d"/><rect x="60" y="120" width="170" height="300" rx="16" fill="#e8a91c"/><rect x="60" y="100" width="170" height="70" rx="30" fill="#fbf6ea"/>` +
      `<rect x="74" y="190" width="14" height="200" fill="#fff" opacity="0.35"/>` + t(370, 150, 74, "#fbf6ea", "生ビール") + t(370, 300, 120, "#ffd34d", "¥380", { font: "Futura, Avenir Next, sans-serif", weight: "bold" }) +
      t(370, 370, 30, "#fbf6ea", "中ジョッキ") + t(256, 470, 30, "#fbf6ea", "毎日 17:00〜19:00"),
    // a folk live: the sun's rays from a corner, the singer's name
    () => `<rect width="512" height="512" fill="#f3d36b"/>` + Array.from({ length: 14 }, (_, k) => {
      const a0 = (k / 14) * Math.PI / 2, a1 = ((k + 0.5) / 14) * Math.PI / 2;
      return `<polygon points="0,512 ${900 * Math.cos(a0)},${512 - 900 * Math.sin(a0)} ${900 * Math.cos(a1)},${512 - 900 * Math.sin(a1)}" fill="#e08a2a" opacity="0.8"/>`;
    }).join("") + `<circle cx="0" cy="512" r="130" fill="#c4421e"/>` + t(300, 110, 72, "#3a1d0c", "フォーク", { font: MARU, weight: "bold" }) + t(300, 190, 56, "#3a1d0c", "ライブ", { font: MARU }) +
      t(310, 300, 30, "#3a1d0c", "うたごえ喫茶 ともしび") + t(330, 350, 30, "#3a1d0c", "12/6 (土) 18:30 開場"),
    // a karaoke contest: shocking pink, a microphone, the prize
    () => `<rect width="512" height="512" fill="#e8358f"/><rect x="40" y="40" width="432" height="432" fill="none" stroke="#ffe14a" stroke-width="10" stroke-dasharray="20 14"/>` +
      `<circle cx="120" cy="190" r="52" fill="#2a2a2a"/><rect x="108" y="236" width="24" height="150" rx="10" fill="#2a2a2a"/>` + t(320, 150, 70, "#ffe14a", "カラオケ", { weight: "bold" }) + t(320, 240, 86, "#fff", "大会", { weight: "bold" }) +
      t(320, 320, 32, "#fff", "優勝賞金 三万円") + t(256, 430, 28, "#ffe14a", "参加者募集中 スナック 夢路"),
    // a revival cinema: a still from the film in halftone, the double bill
    () => `<rect width="512" height="512" fill="#ece7dc"/>` + Array.from({ length: 22 * 14 }, (_, k) => {
      const cx = 40 + (k % 22) * 20, cy = 40 + Math.floor(k / 22) * 20, g = Math.sin((k % 22) * 0.35) * 0.4 + Math.cos(Math.floor(k / 22) * 0.5) * 0.3 + 0.5;
      return `<circle cx="${cx}" cy="${cy}" r="${Math.max(0.5, 9 * (1 - g))}" fill="#222"/>`;
    }).join("") + `<rect x="30" y="330" width="452" height="4" fill="#222"/>` + t(256, 395, 54, "#a3201c", "名画座 二本立て", { font: MINCHO, weight: "bold" }) +
      t(256, 445, 28, "#222", "「夜の河」「東京の灯」", { font: MINCHO }) + t(256, 485, 22, "#222", "連日 11:00 13:40 16:20 19:00", { font: MINCHO }),
    // a bar's reopening: red and white, the flower wreaths, the name
    () => `<rect width="512" height="512" fill="#fdfbf6"/><rect x="0" y="0" width="512" height="120" fill="#c8102e"/>` + t(256, 85, 64, "#fdfbf6", "新装開店", { weight: "bold" }) +
      [110, 256, 402].map((cx) => `<circle cx="${cx}" cy="230" r="62" fill="#f3a6c0"/><circle cx="${cx}" cy="230" r="30" fill="#ffe14a"/>` +
        Array.from({ length: 8 }, (_, k) => `<circle cx="${cx + 46 * Math.cos((k * Math.PI) / 4)}" cy="${230 + 46 * Math.sin((k * Math.PI) / 4)}" r="15" fill="#e05a8a"/>`).join("")).join("") +
      t(256, 370, 70, "#1b1b1b", "スナック 灯", { font: MINCHO, weight: "bold" }) + t(256, 430, 23, "#c8102e", "皆様のお越しを心よりお待ち申し上げます", { font: MINCHO }) + t(256, 475, 26, "#333", "TEL 03-3354-●●●●"),
    // a neighbourhood notice: grid paper, a hand-lettered heading, the lines of a note
    () => `<rect width="512" height="512" fill="#f6f3ea"/>` + Array.from({ length: 16 }, (_, k) => `<rect x="0" y="${k * 32}" width="512" height="1" fill="#9db8d6"/><rect x="${k * 32}" y="0" width="1" height="512" fill="#9db8d6"/>`).join("") +
      t(256, 110, 66, "#1d3f8a", "お知らせ", { font: MARU, weight: "bold" }) + t(256, 190, 30, "#222", "ゴミの日は 月・木 です", { font: MARU }) + t(256, 240, 30, "#222", "前の晩に出さないで下さい", { font: MARU }) +
      lines(70, 300, 380, 6, "#333", 30) + t(380, 480, 26, "#222", "町会", { font: MARU }),
  ];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * S}" height="${2 * S}"><rect width="${4 * S}" height="${2 * S}" fill="#000"/>`;
  bills.forEach((bill, i) => {
    const x = (i % 4) * S, y = Math.floor(i / 4) * S;
    // the bill, yellowed, its edges darker; a corner torn off now and then; tape at its corners
    const torn = r() < 0.4, cx = r() < 0.5 ? 0 : 512, cy = r() < 0.5 ? 0 : 512, tw = 60 + r() * 50;
    // (the torn corner: two points in its place, toward the corner before it and toward the one after, in order)
    const quad = [[0, 0], [512, 0], [512, 512], [0, 512]];
    const pts = quad.flatMap(([px, py], k) => {
      if (px !== cx || py !== cy) return [`${px},${py}`];
      const [bx, by] = quad[(k + 3) % 4], [nx, ny] = quad[(k + 1) % 4], a = tw / 512, b = (tw * 0.8) / 512;
      return [`${px + (bx - px) * a},${py + (by - py) * a}`, `${px + (nx - px) * b},${py + (ny - py) * b}`];
    });
    const clip = torn ? `<clipPath id="c${i}"><polygon points="${pts.join(" ")}"/></clipPath>` : "";
    svg += `<defs>${clip}<radialGradient id="v${i}" cx="50%" cy="50%" r="70%"><stop offset="60%" stop-color="#5a3c10" stop-opacity="0"/><stop offset="100%" stop-color="#5a3c10" stop-opacity="0.45"/></radialGradient></defs>`;
    svg += `<g transform="translate(${x},${y})"${torn ? ` clip-path="url(#c${i})"` : ""}>${bill()}<rect width="512" height="512" fill="#c9a24a" opacity="${0.12 + r() * 0.12}"/><rect width="512" height="512" fill="url(#v${i})"/>`;
    for (let k = 0; k < 120; k++) svg += `<rect x="${r() * 512}" y="${r() * 512}" width="${2 + r() * 6}" height="${2 + r() * 6}" fill="#3a2a10" opacity="${0.05 + r() * 0.1}"/>`;
    svg += `</g>`;
    for (const [tx, ty] of [[x + 8, y + 8], [x + 432, y + 8], [x + 8, y + 482], [x + 432, y + 482]]) if (r() < 0.75) svg += `<rect x="${tx}" y="${ty}" width="72" height="22" fill="#e9dfbf" opacity="0.7" transform="rotate(${(r() - 0.5) * 30} ${tx + 36} ${ty + 11})"/>`;
  });
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "posters.png"));
}

/** Window insides: 4 cells of 256 x 256: a paper shōji, a pleated blind, curtains, frosted glass with bottles behind. */
async function blinds() {
  // Window insides, 8 cells of 256 x 256 (BLIND_CELLS in scene/hero/dress.ts): 0 shoji, 1 venetian blind,
  // 2 beige curtains drawn with a gap, 3 white lace, 4 pale blue curtains, 5 pale green curtains, 6 an office ceiling
  // (fluorescent strips over partitions), 7 a room's back wall (a shelf, a lamp, a picture). The map is also the
  // emissive map: muted, 1980s colours (no saturated red), so a lit window glows its room's light through them.
  const S = 256, N = 8;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${N * S}" height="${S}">`;
  const x = (k: number) => k * S;
  // 0 shoji
  svg += `<rect x="${x(0)}" y="0" width="${S}" height="${S}" fill="#f1e9d4"/>`;
  for (let k = 0; k <= 4; k++) svg += `<rect x="${x(0) + (k * S) / 4 - 3}" y="0" width="6" height="${S}" fill="#6a4a2c"/>`;
  for (let k = 0; k <= 6; k++) svg += `<rect x="${x(0)}" y="${(k * S) / 6 - 2}" width="${S}" height="4" fill="#6a4a2c"/>`;
  // 1 venetian blind
  svg += `<rect x="${x(1)}" y="0" width="${S}" height="${S}" fill="#e2ddd0"/>`;
  for (let r = 0; r < S; r += 9) svg += `<rect x="${x(1)}" y="${r}" width="${S}" height="3" fill="#000" opacity="0.13"/>`;
  svg += `<rect x="${x(1) + 60}" y="0" width="2" height="${S}" fill="#000" opacity="0.15"/><rect x="${x(1) + 190}" y="0" width="2" height="${S}" fill="#000" opacity="0.15"/>`;
  // 2..5 curtains: two panels with folds, a gap in the middle (the room's light in it)
  const curtain = (k: number, base: string, gap: number) => {
    svg += `<rect x="${x(k)}" y="0" width="${S}" height="${S}" fill="#fff3dc"/>`;
    for (const [a0, a1] of [[0, S / 2 - gap], [S / 2 + gap, S]]) {
      svg += `<rect x="${x(k) + a0}" y="0" width="${a1 - a0}" height="${S}" fill="${base}"/>`;
      for (let r = a0; r < a1; r += 14) svg += `<rect x="${x(k) + r}" y="0" width="6" height="${S}" fill="#000" opacity="0.07"/>`;
    }
    svg += `<rect x="${x(k)}" y="0" width="${S}" height="10" fill="#b8b0a0"/>`;
  };
  curtain(2, "#d9c7a4", 22);
  curtain(3, "#f4f1ea", 0);
  for (let r = 0; r < S; r += 12) for (let c = 0; c < S; c += 12) svg += `<circle cx="${x(3) + c + 6}" cy="${r + 6}" r="2" fill="#000" opacity="0.05"/>`;
  curtain(4, "#bccbd6", 30);
  curtain(5, "#c3d1bb", 12);
  // 6 an office: ceiling strips, partitions, a desk row
  svg += `<rect x="${x(6)}" y="0" width="${S}" height="${S}" fill="#cfd3cf"/>`;
  for (let r = 10; r < 90; r += 26) svg += `<rect x="${x(6) + 20}" y="${r}" width="${S - 40}" height="8" fill="#ffffff"/>`;
  svg += `<rect x="${x(6)}" y="150" width="${S}" height="70" fill="#9aa0a0"/>`;
  for (let c = 10; c < S; c += 50) svg += `<rect x="${x(6) + c}" y="150" width="4" height="70" fill="#5a5f60"/>`;
  // 7 a room's back wall
  svg += `<rect x="${x(7)}" y="0" width="${S}" height="${S}" fill="#e9dfc8"/><rect x="${x(7)}" y="190" width="${S}" height="66" fill="#8a6f52"/>`;
  svg += `<rect x="${x(7) + 30}" y="60" width="70" height="50" fill="#6f7f8a" stroke="#4a3a2a" stroke-width="5"/>`;
  svg += `<rect x="${x(7) + 150}" y="120" width="80" height="70" fill="#7a5a3a"/><rect x="${x(7) + 160}" y="128" width="60" height="6" fill="#d8c8a8"/>`;
  svg += `<circle cx="${x(7) + 200}" cy="60" r="22" fill="#fff7e0"/>`;
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "blinds.png"));
}

/** Bars' insides as frosted glass shows them: 4 cells of 512 x 512, warm light from the ceiling, shelves of bottles,
 *  the counter and a figure or two; blurred by the glass, they give it its uneven glow. */
async function interiors() {
  const S = 512;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * S}" height="${S}"><defs>`;
  const tones = [["#ffd9a0", "#7a3e14"], ["#ffe6c0", "#5b3a20"], ["#ffc49a", "#5a3020"], ["#fff1d6", "#6b5640"]];
  tones.forEach(([a, b], i) => (svg += `<linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="r${i}" cx="0.5" cy="0.1" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`));
  svg += `</defs>`;
  for (let i = 0; i < 4; i++) {
    const x = i * S;
    svg += `<rect x="${x}" y="0" width="${S}" height="${S}" fill="url(#g${i})"/><rect x="${x}" y="0" width="${S}" height="${S}" fill="url(#r${i})"/>`;
    // shelves of bottles
    for (let sh = 0; sh < 3; sh++) {
      const y = 90 + sh * 70;
      svg += `<rect x="${x + 20}" y="${y + 52}" width="${S - 40}" height="6" fill="#3a2414" opacity="0.8"/>`;
      for (let bx = x + 30; bx < x + S - 40; bx += 18 + rnd() * 14) {
        const h = 30 + rnd() * 22;
        svg += `<rect x="${bx}" y="${y + 52 - h}" width="${8 + rnd() * 6}" height="${h}" rx="3" fill="hsl(${Math.floor(rnd() * 360)},40%,${20 + rnd() * 25}%)" opacity="0.85"/>`;
      }
    }
    // paper menus on the wall in the izakaya
    if (i === 1) for (let m = 0; m < 9; m++) svg += `<rect x="${x + 30 + m * 52}" y="20" width="40" height="${60 + (m % 3) * 8}" fill="#fff8e6"/><rect x="${x + 46 + m * 52}" y="28" width="8" height="${44 + (m % 3) * 8}" fill="#222" opacity="0.7"/>`;
    // the counter and its top
    svg += `<rect x="${x}" y="${S * 0.66}" width="${S}" height="${S * 0.34}" fill="#2b1a10"/><rect x="${x}" y="${S * 0.64}" width="${S}" height="14" fill="#c8955a"/>`;
    // people at it (silhouettes)
    for (let p = 0; p < 1 + (i % 3); p++) {
      const px = x + 90 + p * 150 + rnd() * 40;
      svg += `<ellipse cx="${px}" cy="${S * 0.48}" rx="26" ry="32" fill="#1a120c" opacity="0.85"/><rect x="${px - 48}" y="${S * 0.53}" width="96" height="${S * 0.2}" rx="30" fill="#1a120c" opacity="0.85"/>`;
    }
  }
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "interior.png"));
}

/** Notices on doors and walls: 4 x 2 cells of 256 x 256 (paper, a wooden open sign, a menu). */
async function notices() {
  const S = 256;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * S}" height="${2 * S}">`;
  const items = [
    { bg: "#f7f3e8", fg: "#b3121b", t: "営業中", f: MINCHO }, { bg: "#c69a62", fg: "#2a1608", t: "営業中", f: MINCHO },
    { bg: "#f7f3e8", fg: "#222", t: "本日貸切", f: GOTHIC }, { bg: "#fffdf6", fg: "#123a8a", t: "会員制", f: MINCHO },
    { bg: "#f7f3e8", fg: "#222", t: "チャージ\n¥1,000", f: GOTHIC }, { bg: "#202020", fg: "#f2d24a", t: "OPEN", f: HEAVY },
    { bg: "#f2f2ee", fg: "#b3121b", t: "禁煙", f: GOTHIC }, { bg: "#f7f3e8", fg: "#222", t: "いらっしゃい", f: MARU },
  ];
  items.forEach((it, i) => {
    const x = (i % 4) * S, y = Math.floor(i / 4) * S;
    svg += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${it.bg}"/><rect x="${x + 10}" y="${y + 10}" width="${S - 20}" height="${S - 20}" fill="none" stroke="${it.fg}" stroke-width="3" opacity="0.6"/>`;
    const lines = it.t.split("\\n");
    lines.forEach((l, k) => {
      const size = Math.min(70, 200 / l.length);
      svg += `<text x="${x + S / 2}" y="${y + S / 2 + (k - (lines.length - 1) / 2) * 80 + size * 0.35}" font-family="${it.f}" font-size="${size}" font-weight="700" fill="${it.fg}" text-anchor="middle">${esc(l)}</text>`;
    });
  });
  await sharp(Buffer.from(svg + "</svg>")).png().toFile(join(dir, "notices.png"));
}

await interiors();
await notices();
await lightboxes();
await blades();
await lanterns();
await noren();
await vending();
await posters();
await blinds();
// every shop's own signs (scene/hero/shops.ts): tools/tokyo/hero-shops.ts
await shopPages();
console.log(`-> ${dir}`);
