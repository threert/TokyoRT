// The far level's street props as models (after the upstream client's src/world/props.js in jeantimex/tokyo): street
// lights and utility poles with LED heads (lights by night), signals, vending machines (lit fronts), parked cars. The
// far level draws them as compiled (tools/tokyo/props.ts); the near cells place the same models as kit pieces
// (tools/tokyo/city-bake.ts), so a street keeps its lights, signals and cars as its cell comes nearer.
import { MeshStandardMaterial } from "@threert/scene";
import { PROP } from "../../tools/city/shared/tileformat.js";
import type { KitPiece } from "./builder.ts";
export type Soup = { pos: number[]; nor: number[] };
export type PropMaterial = { key: string; color: [number, number, number]; roughness: number; metallic?: number; emissive?: [number, number, number]; nits?: number };

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (r: number, g: number, b: number): [number, number, number] => [lin(r), lin(g), lin(b)];
export const PROP_MATERIALS: Record<string, PropMaterial> = {
  steel: { key: "steel", color: L(0.36, 0.38, 0.4), roughness: 0.5, metallic: 0.6 },
  concrete: { key: "concrete", color: L(0.6, 0.6, 0.58), roughness: 0.85 },
  dark: { key: "dark", color: L(0.16, 0.17, 0.18), roughness: 0.6 },
  lampHousing: { key: "lampHousing", color: L(0.7, 0.71, 0.72), roughness: 0.5 },
  // An LED head ~6000 nits over its 0.3 x 0.75 m face lights the road 8.5 m below with ~20 lux, a lit street.
  lamp: { key: "lamp", color: [0.05, 0.05, 0.05], roughness: 0.3, emissive: [1, 0.93, 0.82], nits: 6000 },
  lampOff: { key: "lampOff", color: L(0.55, 0.56, 0.55), roughness: 0.3 },
  white: { key: "white", color: L(0.92, 0.92, 0.9), roughness: 0.5 },
  vendingFront: { key: "vendingFront", color: [0.1, 0.1, 0.1], roughness: 0.2, emissive: [0.95, 0.97, 1], nits: 120 },
  signalRed: { key: "signalRed", color: [0.05, 0.01, 0.01], roughness: 0.3, emissive: [1, 0.08, 0.04], nits: 400 },
  signalGreen: { key: "signalGreen", color: [0.01, 0.05, 0.03], roughness: 0.3, emissive: [0.1, 1, 0.6], nits: 400 },
  tyre: { key: "tyre", color: L(0.05, 0.05, 0.05), roughness: 0.8 },
  carGlass: { key: "carGlass", color: [0.02, 0.022, 0.025], roughness: 0.05 },
};
// (the client's VENDING_BODY, sRGB)
const VENDING_BODY = [L(0.92, 0.92, 0.9), L(0.75, 0.1, 0.12), L(0.12, 0.3, 0.62), L(0.9, 0.86, 0.72)];
VENDING_BODY.forEach((c, i) => (PROP_MATERIALS[`vending${i}`] = { key: `vending${i}`, color: c, roughness: 0.4 }));
const CAR_PAINT = [L(0.85, 0.85, 0.84), L(0.1, 0.1, 0.11), L(0.55, 0.56, 0.58), L(0.6, 0.08, 0.06), L(0.12, 0.2, 0.42), L(0.75, 0.73, 0.68)];
CAR_PAINT.forEach((c, i) => (PROP_MATERIALS[`paint${i}`] = { key: `paint${i}`, color: c, roughness: 0.35, metallic: 0.3 }));

// ---------------------------------------------------------------- primitives (local, model space)
export type Tri = { p: number[][]; n: number[] };
/** `lamp`: a lamp's face, lit by night (the "night" node) and unlit by day (the "day" node). */
export type Part = { mat: string; tris: Tri[]; lamp?: boolean };
const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const face = (a: number[], b: number[], c: number[]): Tri => ({ p: [a, b, c], n: norm(cross(sub(b, a), sub(c, a))) });
function quad(a: number[], b: number[], c: number[], d: number[]): Tri[] { return [face(a, b, c), face(a, c, d)]; }
/** An axis-aligned box w x h x d centred at (x, y, z) (y its centre). */
function box(w: number, h: number, d: number, x: number, y: number, z: number): Tri[] {
  const [x0, x1, y0, y1, z0, z1] = [x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2];
  return [
    ...quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]), // top
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // bottom
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
    ...quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]), // -z
    ...quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]), // +x
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
  ];
}
/** A tapered tube (radius r0 at the bottom, r1 at the top) standing on (x, y, z), h high. */
function tube(r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 8): Tri[] {
  const out: Tri[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    const P = (r: number, a: number, yy: number) => [x + r * Math.sin(a), yy, z + r * Math.cos(a)];
    out.push(...quad(P(r0, a0, y), P(r0, a1, y), P(r1, a1, y + h), P(r1, a0, y + h)));
    out.push(face(P(r1, a0, y + h), P(r1, a1, y + h), [x, y + h, z]));
  }
  return out;
}
// ---------------------------------------------------------------- models
const MODELS = new Map<string, Part[]>();
function model(key: string, build: () => Part[]): Part[] {
  if (!MODELS.has(key)) MODELS.set(key, build());
  return MODELS.get(key)!;
}
/** A street prop's model (local: standing on y 0, facing +z), by the compiled kind and variant; null for a kind
 *  without one (trees are the far level's own: tools/tokyo/props.ts). */
export function streetPropModel(kind: number, variant: number): Part[] | null {
  switch (kind) {
    case PROP.LIGHT: // tapered mast, an arm towards the road (+z), a flat LED head facing down
      return model("light", () => [
        { mat: "steel", tris: [...tube(0.11, 0.07, 8.6, 0, 0, 0), ...box(0.09, 0.09, 2.1, 0, 8.6, 1.0)] },
        { mat: "lampHousing", tris: box(0.3, 0.1, 0.75, 0, 8.63, 2.25).filter((t) => t.n[1] > -0.5) },
        { mat: "lamp", lamp: true, tris: box(0.3, 0.1, 0.75, 0, 8.63, 2.25).filter((t) => t.n[1] <= -0.5) },
      ]);
    case PROP.POLE: // concrete utility pole, crossarms, a lamp on a short arm (+x)
      return model(`pole${variant & 1}`, () => [
        { mat: "concrete", tris: tube(0.17, 0.12, 10.2, 0, 0, 0) },
        { mat: "steel", tris: [...box(1.9, 0.09, 0.09, 0, 9.6, 0), ...box(1.5, 0.09, 0.09, 0, 8.9, 0), ...box(0.9, 0.06, 0.06, 0.5, 5.68, 0), ...(variant & 1 ? tube(0.3, 0.3, 0.85, 0.42, 7.7, 0, 10) : [])] },
        { mat: "lampHousing", tris: box(0.5, 0.09, 0.2, 1.0, 5.64, 0).filter((t) => t.n[1] > -0.5) },
        { mat: "lamp", lamp: true, tris: box(0.5, 0.09, 0.2, 1.0, 5.64, 0).filter((t) => t.n[1] <= -0.5) },
      ]);
    case PROP.SIGNAL: // mast at the kerb, arm over the road (-x), three-lens head facing +z: red and green lit
      return model("signal", () => [
        { mat: "steel", tris: [...tube(0.12, 0.09, 6.3, 0, 0, 0), ...box(3.4, 0.1, 0.1, -1.7, 6.05, 0)] },
        { mat: "white", tris: box(1.3, 0.46, 0.22, -3.05, 5.6, 0) },
        { mat: "signalRed", tris: box(0.3, 0.3, 0.02, -3.45, 5.6, 0.12) },
        { mat: "signalGreen", tris: box(0.3, 0.3, 0.02, -2.65, 5.6, 0.12) },
      ]);
    case PROP.VENDING: // a lit front (+z), the body in one of the client's four colours
      return model(`vending${variant % 4}`, () => [
        { mat: `vending${variant % 4}`, tris: box(1.02, 1.83, 0.72, 0, 0.915, 0).filter((t) => t.n[2] < 0.5) },
        { mat: "vendingFront", tris: box(1.02, 1.83, 0.72, 0, 0.915, 0).filter((t) => t.n[2] >= 0.5) },
        { mat: "dark", tris: box(1.06, 0.1, 0.76, 0, 0.05, 0) },
      ]);
    case PROP.PARKED: { // a small car along +z: body, cabin, wheels
      const paint = `paint${(variant >> 2) % CAR_PAINT.length}`;
      return model(`car${paint}`, () => [
        { mat: paint, tris: [...box(1.7, 0.75, 4.2, 0, 0.62, 0), ...box(1.5, 0.08, 2.0, 0, 1.36, -0.2)] },
        { mat: "carGlass", tris: box(1.55, 0.42, 2.2, 0, 1.12, -0.2) },
        { mat: "tyre", tris: [-1.35, 1.35].flatMap((z) => [-0.8, 0.8].flatMap((x) => box(0.2, 0.6, 0.6, x, 0.3, z))) },
      ]);
    }
    default:
      return null;
  }
}

/** How far the client lifts each kind off the ground (props.js `lift`): lights and signals stand on the kerb. */
export const LIFT: Record<number, number> = { [PROP.LIGHT]: 0.15, [PROP.SIGNAL]: 0.15, [PROP.VENDING]: 0.02, [PROP.PARKED]: 0.05 };


// ---------------------------------------------------------------- as the scene's materials and kit pieces
const made = new Map<string, MeshStandardMaterial>();
/** The props' materials, as the scene's library holds them ("prop <key>"): lamps and lit fronts emit by night, signals
 *  and vending fronts by day too. */
export function streetPropMaterials(night: boolean): MeshStandardMaterial[] {
  return Object.values(PROP_MATERIALS).filter((m) => !m.key.startsWith("ez-")).map((m) => propMaterial(m.key, night));
}
function propMaterial(key: string, night: boolean) {
  const k = `${key} ${night}`;
  let m = made.get(k);
  if (!m) {
    const p = PROP_MATERIALS[key];
    const lamp = key === "lamp";
    m = new MeshStandardMaterial({ name: `prop ${key}`, color: p.color, roughness: p.roughness, metalness: p.metallic ?? 0,
      ...(p.emissive ? { emissive: p.emissive, emissiveIntensity: lamp && !night ? 0 : p.nits ?? 0 } : {}) });
    made.set(k, m);
  }
  return m;
}
/** A street prop as a kit piece's parts (the night materials: the scene swaps in its day twins). */
export function streetPropParts(kind: number, variant: number): KitPiece["parts"] | null {
  const m = streetPropModel(kind, variant);
  if (!m) return null;
  return m.map((part) => {
    const n = part.tris.length * 3, positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
    part.tris.forEach((t, i) => t.p.forEach((p, j) => { positions.set(p, (i * 3 + j) * 3); normals.set(t.n, (i * 3 + j) * 3); }));
    return { material: propMaterial(part.mat, true), positions, normals, uvs: new Float32Array(n * 2), index: Uint32Array.from({ length: n }, (_, i) => i) };
  });
}
