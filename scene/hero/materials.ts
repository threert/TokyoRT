// The hero district's materials: generated tileable PBR finishes as SurfaceMaterials on mesh UVs in metres (each
// texture repeats at its real size), with grime and wetness; glass; and the lit things (signs, lanterns, rooms).
import { MeshPhysicalMaterial, MeshStandardMaterial, SurfaceMaterial, Texture } from "@threert/scene";
import { shopPage } from "./shops.ts";

import { finishMap } from "./finish.ts";
const HERO = "assets/city/hero/tex";

/** A generated finish as a SurfaceMaterial: `size` m per repeat; `tint` multiplies the colour map. */
/** Weathering by cause on a wall (`SurfaceMaterial.weathering`): splash and rising damp at its foot, and the faces toward
 *  the south (+z, where the sun stands over Tokyo) bleached. Not the tiled grime the walls had. */
const WEATHER = { foot: { height: 1.0, amount: 0.7 }, fade: { toward: [-0.2, 0, 0.98] as [number, number, number], amount: 0.5 } };

function finish(id: string, size: number, o: { tint?: [number, number, number]; rough?: number; metal?: boolean; wet?: number; grime?: number; puddles?: number; normal?: number; name?: string; weather?: boolean } = {}) {
  const map = finishMap(id, "color");
  map.repeat = [1 / size, 1 / size];
  return tiling(new SurfaceMaterial({
    name: o.name ?? id,
    map,
    normalMap: finishMap(id, "normal"),
    roughnessMap: finishMap(id, "rough"),
    ...(o.metal ? { metalnessMap: finishMap(id, "metal"), metalness: 1 } : {}),
    normalScale: o.normal ?? 1,
    color: o.tint ?? [1, 1, 1],
    roughness: o.rough ?? 1,
    wet: o.wet ?? 0,
    ...(o.grime ? { grime: { amount: o.grime, scale: 1.6 } } : {}),
    ...(o.puddles ? { puddles: { scale: 2.2, amount: o.puddles } } : {}),
    ...(o.weather ? { weathering: WEATHER } : {}),
  }));
}
/** A material whose textures repeat at their real size (UVs in metres): a kit element may take any copy's UVs. */
function tiling<T extends MeshStandardMaterial>(m: T): T {
  m.userData.tiling = true;
  return m;
}

/** A texture of the hero set (signs, lanterns, ...), sRGB, clamped (atlas cells). */
function heroTex(file: string) {
  const t = new Texture(`${HERO}/${file}`);
  t.wrap = "clamp";
  return t;
}

export type Mats = ReturnType<typeof heroMaterials>;

/** A ground finish mapped in world space (`size` m a repeat): a decal on the road needs no UVs of its own and lines up
 *  with nothing. Wet by night as the road is. */
function groundFinish(id: string, size: number, tint: [number, number, number], name: string, rough = 1) {
  const map = finishMap(id, "color");
  map.repeat = [1 / size, 1 / size];
  return new SurfaceMaterial({ name, map, normalMap: finishMap(id, "normal"), roughnessMap: finishMap(id, "rough"), worldScale: size, color: tint, roughness: rough, wet: 1 });
}
/** The streaks' dirt (hero/dress.ts `streakUnder`): grey-brown, matte; the AC drip's a little darker. */
function streakMaterial(name: string, color: [number, number, number]) {
  return new MeshStandardMaterial({ name, color, roughness: 0.95 });
}

export function heroMaterials(night: boolean) {
  // walls: Tokyo about 1980, kept up. Small buildings: painted mortar and stucco in pale colours, cream and brown
  // tile, clean timber and sheet metal. Weathered by cause (`WEATHER`): damp at the foot, bleached toward the south;
  // stucco's relief is a fine sand over soft trowel marks (tools/tokyo/surfaces.ts), not the blobs it read as before.
  const walls = [
    finish("stucco-cream", 2.4, { weather: true, normal: 0.35, wet: 0.25, tint: [1, 0.96, 0.88], name: "wall stucco cream" }),
    finish("stucco-cream", 2.4, { weather: true, normal: 0.35, wet: 0.25, tint: [1, 0.93, 0.76], name: "wall stucco yellow" }),
    finish("stucco-grey", 2.4, { weather: true, normal: 0.35, wet: 0.25, tint: [0.86, 0.95, 0.87], name: "wall stucco green" }),
    finish("stucco-grey", 2.4, { weather: true, normal: 0.35, wet: 0.25, tint: [0.86, 0.92, 1.0], name: "wall stucco blue" }),
    finish("plaster-painted", 2.5, { weather: true, normal: 0.4, wet: 0.25, tint: [1.0, 0.86, 0.76], name: "wall plaster salmon" }),
    finish("plaster-warm", 3, { weather: true, normal: 0.4, wet: 0.25, name: "wall plaster cream" }),
    finish("plaster-white", 2.4, { weather: true, normal: 0.4, wet: 0.25, tint: [0.95, 0.94, 0.92], name: "wall plaster white" }),
    finish("tiles-long-white", 1.6, { weather: true, wet: 0.3, name: "wall tiles cream" }),
    finish("tiles-long-white", 1.6, { weather: true, wet: 0.3, tint: [0.66, 0.5, 0.38], name: "wall tiles brown" }),
    finish("tiles-cladding-terracotta", 2, { weather: true, wet: 0.3, name: "wall tiles terracotta" }),
    finish("brick", 2, { weather: true, wet: 0.3, name: "wall tiles dark brown" }),
    finish("sheet-corrugated", 1.6, { weather: true, tint: [1.3, 1.25, 1.1], wet: 0.3, name: "wall sheet cream" }),
    finish("sheet-corrugated", 1.6, { weather: true, tint: [0.85, 1.15, 1.0], wet: 0.3, name: "wall sheet green" }),
    finish("planks-cedar", 1.4, { weather: true, wet: 0.2, name: "wall cedar" }),
    finish("planks-black", 1.3, { weather: true, wet: 0.2, name: "wall black planks" }),
  ];
  // how often each is drawn (same order)
  const wallWeights = [5, 3, 2, 2, 2, 3, 3, 3, 3, 2, 2, 1, 1, 2, 1];
  // the bigger buildings: tile-clad (cream, brown, terracotta, grey), stucco and painted concrete
  const bigWalls = [
    finish("tiles-long-white", 1.8, { weather: true, name: "big tiles cream" }),
    finish("tiles-long-white", 1.8, { weather: true, tint: [0.62, 0.47, 0.36], name: "big tiles brown" }),
    finish("tiles-long-white", 1.8, { weather: true, tint: [0.88, 0.8, 0.66], name: "big tiles beige" }),
    finish("tiles-cladding-terracotta", 2.2, { weather: true, name: "big tiles terracotta" }),
    finish("brick", 2.2, { weather: true, name: "big tiles dark brown" }),
    finish("tiles-cladding", 2.5, { weather: true, tint: [1.05, 1.0, 0.92], name: "big tiles grey beige" }),
    finish("tiles-facade", 3, { weather: true, tint: [1.15, 1.1, 1.0], name: "big tiles warm grey" }),
    finish("stucco-grey", 3, { weather: true, normal: 0.35, tint: [0.92, 0.92, 0.9], name: "big stucco grey" }),
    finish("stucco-cream", 3, { weather: true, normal: 0.35, tint: [1, 0.95, 0.85], name: "big stucco cream" }),
    finish("concrete-painted", 3, { weather: true, tint: [1.15, 1.12, 1.08], name: "big painted concrete" }),
  ];
  /** Trim: the bands, piers and crowns that break a facade up (a second finish against the wall's). */
  const trims = [
    finish("stucco-cream", 2, { weather: true, normal: 0.35, tint: [0.97, 0.96, 0.93], name: "trim white" }),
    finish("tiles-long-white", 1.2, { weather: true, tint: [0.5, 0.38, 0.3], name: "trim brown tile" }),
    finish("concrete-painted", 2, { weather: true, tint: [0.85, 0.85, 0.85], name: "trim concrete" }),
    finish("tiles-cladding-terracotta", 1.6, { weather: true, tint: [0.8, 0.7, 0.62], name: "trim terracotta" }),
  ];
  const plinth = finish("concrete-painted", 2, { weather: true, tint: [0.8, 0.8, 0.8], wet: 0.5, name: "plinth" });
  const coping = finish("stucco-grey", 2, { normal: 0.35, tint: [0.85, 0.85, 0.84], grime: 0.25, wet: 0.6, name: "coping" });
  const roof = finish("concrete-weathered", 4, { tint: [0.78, 0.78, 0.78], grime: 0.3, wet: 0.3, name: "roof slab" });
  // the roofs' finishes: concrete, green and grey waterproof coats; painted sheet metal on small houses
  const roofs = [
    roof,
    finish("concrete-coated", 3, { tint: [0.55, 0.68, 0.6], grime: 0.3, wet: 0.3, name: "roof coat green" }),
    finish("concrete-coated", 3, { tint: [0.62, 0.63, 0.66], grime: 0.3, wet: 0.3, name: "roof coat grey" }),
    finish("concrete-worn", 3, { tint: [0.76, 0.76, 0.74], grime: 0.3, wet: 0.3, name: "roof worn" }),
    finish("concrete-brushed", 3, { tint: [0.66, 0.66, 0.66], grime: 0.3, wet: 0.3, name: "roof brushed" }),
  ];
  const roofsSmall = [...roofs, finish("sheet-corrugated", 1.6, { tint: [0.7, 0.9, 1.15], wet: 0.3, name: "roof sheet blue" }), finish("sheet-corrugated", 1.6, { tint: [1.0, 0.75, 0.6], wet: 0.3, name: "roof sheet brown" })];
  const ground = finish("asphalt", 3.5, { wet: 1, puddles: night ? 0.45 : 0, grime: 0.3, tint: [0.92, 0.92, 0.94], name: "alley asphalt" });
  const groundB = finish("asphalt-fresh", 3.5, { wet: 1, puddles: night ? 0.4 : 0, grime: 0.2, tint: [0.85, 0.85, 0.86], name: "alley asphalt worn" });
  const gutter = finish("concrete-worn", 1.5, { wet: 1, grime: 0.3, name: "gutter concrete" });
  const grate = finish("grate", 1, { metal: true, wet: 1, name: "gutter grate" });
  const doorWood = [
    finish("planks-cedar", 1.6, { name: "door cedar" }),
    finish("planks-dark", 1.6, { name: "door dark" }),
    finish("planks-black", 1.6, { name: "door black" }),
    finish("planks-dark", 1.6, { tint: [0.75, 0.55, 0.4], name: "door teak" }),
  ];
  const shutter = finish("shutter", 2.4, { tint: [0.82, 0.84, 0.86], name: "shutter silver" });
  const shutterPainted = finish("shutter", 2.4, { name: "shutter painted" });
  const corrugatedEave = finish("sheet-corrugated", 1.5, { metal: true, wet: 1, name: "eave corrugated" });
  const rustyMetal = finish("metal-painted", 1.5, { name: "rusty painted metal" });

  const aluminium = new MeshStandardMaterial({ name: "aluminium frame", color: 0x8d8f91, roughness: 0.35, metalness: 1 });
  const aluminiumDark = new MeshStandardMaterial({ name: "aluminium bronze", color: 0x3b3228, roughness: 0.4, metalness: 1 });
  const frameWhite = new MeshStandardMaterial({ name: "frame white", color: 0xe8e6e0, roughness: 0.4 });
  const frameBlack = new MeshStandardMaterial({ name: "frame black", color: 0x1a1a1c, roughness: 0.45 });
  /** Window frames: silver and bronze aluminium, white and black painted. */
  const frames = [aluminium, aluminiumDark, frameWhite, frameBlack];
  const steelDark = new MeshStandardMaterial({ name: "steel dark", color: 0x1f2124, roughness: 0.55, metalness: 0.8 });
  /** Galvanised sheet (a kitchen's exhaust duct): dull, spangled grey. */
  const galv = new MeshStandardMaterial({ name: "galvanised duct", color: 0x8f938e, roughness: 0.6, metalness: 0.7 });
  const paintMetal = new MeshStandardMaterial({ name: "painted metal grey", color: 0x6f716e, roughness: 0.5, metalness: 0 });
  const pvc = new MeshStandardMaterial({ name: "pvc pipe", color: 0x9a9b96, roughness: 0.45 });
  const pvcDark = new MeshStandardMaterial({ name: "pvc dark", color: 0x3a3a38, roughness: 0.5 });
  const cable = new MeshStandardMaterial({ name: "cable", color: 0x0c0c0c, roughness: 0.6 });
  const cableGrey = new MeshStandardMaterial({ name: "cable grey", color: 0x5a5a58, roughness: 0.6 });
  const concretePole = finish("concrete-wall", 1.2, { tint: [0.78, 0.78, 0.76], grime: 0.6, name: "pole concrete" });
  const insulator = new MeshStandardMaterial({ name: "insulator", color: 0xe8e6e0, roughness: 0.15 });
  const transformer = new MeshStandardMaterial({ name: "transformer", color: 0x9da39f, roughness: 0.4, metalness: 0.3 });

  // glass: clear panes in front of the rooms, and frosted ones
  const glass = new MeshPhysicalMaterial({ name: "glass", color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5 });
  const frosted = new MeshPhysicalMaterial({ name: "glass frosted", color: 0xc9ccca, roughness: 0.3, metalness: 0, transmission: 1, ior: 1.5 });
  // the towers' curtain walls: tinted vision glass (green, blue, bronze), the spandrel panels at each slab (coated glass
  // or enamelled metal, reflective), the mullion fins; the roof's helipad paint and the red aviation lights
  const curtainGlass = [0xb7cfc8, 0xb3c3d6, 0xd4c6b2].map((c, i) => new MeshPhysicalMaterial({ name: `glass curtain ${i}`, color: c, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5 }));
  const spandrels = [0x22313a, 0x2a3a33, 0x8f969c, 0x3a2f27].map((c, i) => new MeshStandardMaterial({ name: `spandrel ${i}`, color: c, roughness: 0.08, metalness: 0.85 }));
  const helipadPaint = new MeshStandardMaterial({ name: "helipad paint", color: 0x40564a, roughness: 0.8 });
  const helipadWhite = new MeshStandardMaterial({ name: "helipad white", color: 0xe8e8e2, roughness: 0.6 });
  const aviation = new MeshStandardMaterial({ name: "aviation light", color: 0x8a1810, roughness: 0.3, emissive: 0xff2010, emissiveIntensity: night ? 4000 : 0 });

  // what lights: rooms behind the glass, signs, lanterns, bulbs (nits; zero by day except signs a little)
  const k = night ? 1 : 0;
  const blinds = heroTex("blinds.png");
  const room = (nits: number, name: string) => new MeshStandardMaterial({ name, map: blinds, color: 0xffffff, roughness: 0.9, emissive: 0xffc98a, emissiveMap: blinds, emissiveIntensity: nits * k });
  const roomLit = room(24, "room lit");
  const roomDim = room(5, "room dim");
  // the rooms' light by what they are: warm homes and bars (2700 K), neutral shops (3500 K), cool fluorescent offices
  const roomT = (hex: number, nits: number, name: string) => new MeshStandardMaterial({ name, map: blinds, color: 0xffffff, roughness: 0.9, emissive: hex, emissiveMap: blinds, emissiveIntensity: nits * k });
  const rooms = {
    warm: [roomLit, roomDim],
    neutral: [roomT(0xffe2c2, 24, "room lit neutral"), roomT(0xffe2c2, 6, "room dim neutral")],
    cool: [roomT(0xeef4ff, 28, "room lit cool"), roomT(0xeef4ff, 7, "room dim cool")],
  };
  // neon tubes (thin glass, lit by night; by day their coloured glass)
  const neonColours: [number, number][] = [[0xff3c9a, 0xffc0dc], [0x30e0ff, 0xc0f4ff], [0x5cff70, 0xc8ffd0], [0xff8a2c, 0xffd8b0], [0xfff2e0, 0xfffaf0], [0x5a78ff, 0xc8d4ff], [0xff3a30, 0xffc8c0]];
  const neon = neonColours.map(([e, c], i) => new MeshStandardMaterial({ name: `neon ${i}`, color: c, roughness: 0.2, emissive: e, emissiveIntensity: night ? 700 : 0 }));
  const interior = heroTex("interior.png");
  /** A bar's inside seen through frosted glass (interior.png's cells), lit by night, dim by day. */
  const roomBar = new MeshStandardMaterial({ name: "room bar", map: interior, color: 0xffffff, roughness: 0.9, emissive: 0xffffff, emissiveMap: interior, emissiveIntensity: night ? 30 : 1.5 });
  const notices = new MeshStandardMaterial({ name: "notices", map: heroTex("notices.png"), roughness: 0.75 });
  const roomShop = new MeshStandardMaterial({ name: "room shop", map: interior, color: 0xffffff, roughness: 0.9, emissive: 0xffffff, emissiveMap: interior, emissiveIntensity: night ? 55 : 6 });
  const roomOffice = new MeshStandardMaterial({ name: "room office", map: blinds, color: 0xffffff, roughness: 0.9, emissive: 0xe8efff, emissiveMap: blinds, emissiveIntensity: night ? 30 : 0 });
  const tank = new MeshStandardMaterial({ name: "water tank", color: 0xb9c2bd, roughness: 0.55 });
  const laundry = [0xe8e4dc, 0x6b88b0, 0xc65a4a, 0x3a3a3a, 0xd8c070, 0xf0f0f0].map((c, i) => new MeshStandardMaterial({ name: `laundry ${i}`, color: c, roughness: 0.95, side: "double" }));
  const gasPipe = new MeshStandardMaterial({ name: "gas pipe yellow", color: 0xc8a020, roughness: 0.45 });
  const roomDark = new MeshStandardMaterial({ name: "room dark", map: blinds, color: 0x6a6a6a, roughness: 0.9 });
  const lightbox = heroTex("lightbox.png"), blade = heroTex("blade.png"), lantern = heroTex("lantern.png"), noren = heroTex("noren.png"), posters = heroTex("posters.png");
  const sign = (map: Texture, nits: number, name: string) => new MeshPhysicalMaterial({ name, map, roughness: 0.25, clearcoat: 0.6, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: night ? nits : 0 });
  const signBox = sign(lightbox, 60, "sign lightbox");
  const signBlade = sign(blade, 65, "sign blade");
  const lanternPaper = new MeshStandardMaterial({ name: "lantern paper", map: lantern, roughness: 0.7, emissive: 0xffd9a0, emissiveMap: lantern, emissiveIntensity: night ? 30 : 0, side: "double" });
  const norenCloth = new MeshStandardMaterial({ name: "noren", map: noren, roughness: 0.95, side: "double" });
  const poster = new MeshStandardMaterial({ name: "posters", map: posters, roughness: 0.8 });
  const signFrame = new MeshStandardMaterial({ name: "sign frame", color: 0x2a2b2d, roughness: 0.45, metalness: 0.6 });
  const bulb = new MeshStandardMaterial({ name: "bulb", color: 0xfff1d8, roughness: 0.2, emissive: 0xffc06a, emissiveIntensity: night ? 9000 : 0 });
  const globe = new MeshStandardMaterial({ name: "globe", color: 0xf4efe6, roughness: 0.3, emissive: 0xffcf8a, emissiveIntensity: night ? 600 : 0 });
  const vending = new MeshStandardMaterial({ name: "vending front", map: heroTex("vending.png"), roughness: 0.3, emissive: 0xffffff, emissiveMap: heroTex("vending-glow.png"), emissiveIntensity: night ? 60 : 25 });
  const vendingBody = new MeshStandardMaterial({ name: "vending body", color: 0xe4e6e8, roughness: 0.4 });
  // the shops' own signs (scene/hero/shops.ts, tools/tokyo/hero-shops.ts): one page of the atlas per 16 shops,
  // made when a sign first uses it
  const shopMats = new Map<number, { box: MeshStandardMaterial; blade: MeshStandardMaterial; cloth: MeshStandardMaterial; plate: MeshStandardMaterial }>();
  const shop = (p: number) => {
    let m = shopMats.get(p);
    if (!m) {
      const t = new Texture(shopPage(p));
      t.wrap = "clamp";
      m = {
        box: new MeshPhysicalMaterial({ name: `shop lightbox ${p}`, map: t, roughness: 0.25, clearcoat: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: night ? 35 : 0 }),
        blade: new MeshPhysicalMaterial({ name: `shop blade ${p}`, map: t, roughness: 0.25, clearcoat: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: night ? 38 : 0 }),
        cloth: new MeshStandardMaterial({ name: `shop noren ${p}`, map: t, roughness: 0.95, side: "double" }),
        plate: new MeshStandardMaterial({ name: `shop plate ${p}`, map: t, roughness: 0.6 }),
      };
      shopMats.set(p, m);
    }
    return m;
  };
  return {
    shop, roofs, roofsSmall,
    roadPatch: groundFinish("asphalt", 3.5, [0.24, 0.24, 0.25], "road repair", 0.9),
    roadSeam: new MeshStandardMaterial({ name: "road seam", color: [0.02, 0.02, 0.022], roughness: 0.75 }),
    gutterWet: groundFinish("asphalt", 3.5, [0.42, 0.41, 0.4], "kerb gutter line", 0.55),
    gutterDust: groundFinish("concrete-worn", 2.5, [0.92, 0.87, 0.78], "kerb grit"),
    streak: streakMaterial("streak sill", [0.2, 0.185, 0.165]), drip: streakMaterial("streak drip", [0.13, 0.12, 0.11]),
    walls, wallWeights, bigWalls, plinth, coping, roof, ground, groundB, gutter, grate, doorWood, shutter, shutterPainted, corrugatedEave, rustyMetal,
    aluminium, aluminiumDark, steelDark, galv, paintMetal, pvc, pvcDark, cable, cableGrey, concretePole, insulator, transformer,
    glass, frosted, curtainGlass, spandrels, helipadPaint, helipadWhite, aviation, roomLit, roomDim, roomDark, rooms, neon, trims, frames, frameWhite, frameBlack, roomBar, roomShop, roomOffice, tank, laundry, notices, gasPipe, signBox, signBlade, lanternPaper, norenCloth, poster, signFrame, bulb, globe, vending, vendingBody,
  };
}
