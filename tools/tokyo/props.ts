// Street props of a city tile as triangles by material, after the upstream client's models (src/world/props.js in
// jeantimex/tokyo): street lights and utility poles with LED heads (emitters: they light the streets at night),
// signals, vending machines (lit fronts), parked cars, and trees (crown lobes fitted to EZ-Tree foliage). Each prop: kind, variant, rotation about +y (0..2π), x, z, scale; models face local +z, turned by `rot` as the
// client turns them (about +y), lifted as it lifts them (lights and signals stand on the kerb). Park trees (variants 2
// and 3) stand in clumps of three, as the client sets them. The lamps' lit faces go to the GLB's "night" node, the
// same faces unlit to its "day" node (tools/tokyo/glb.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { treeSites } from "../../scene/trees.ts";
import { PROP } from "../city/shared/tileformat.js";
import { LIFT, PROP_MATERIALS, streetPropModel, type Part, type Soup, type PropMaterial, type Tri } from "../../scene/hero/streetprops.ts";
export { PROP_MATERIALS, type Soup, type PropMaterial };

const treeGeometry: { forms: Part[][]; colors: Record<string, [number, number, number]> } =
  JSON.parse(readFileSync(join(repoRoot, "assets/city/street-models/ez-far.json"), "utf8"));
for (const [key, color] of Object.entries(treeGeometry.colors)) {
  PROP_MATERIALS[key] = { key, color, roughness: key === "ez-bark" ? 0.94 : 0.78 };
}
function propModel(kind: number, variant: number): Part[] | null {
  return kind === PROP.TREE ? treeGeometry.forms[variant] : streetPropModel(kind, variant);
}

/**
 * The props of one tile, by node and material (keys `<node> <material>`): each model turned about +y, scaled, lifted
 * and set on the ground (surface height). Park trees (variants 2 and 3) get two more round them, 3–6.5 m off and a
 * little smaller, placed by the client's hash so they stand where its do.
 */
export function propSoups(props: Float32Array, ground: (x: number, z: number) => number) {
  const out = new Map<string, { node: string; mat: string; soup: Soup }>();
  const counts: Record<string, number> = {};
  const put = (node: string, mat: string, tris: Tri[], P: (p: number[]) => number[], N: (n: number[]) => number[]) => {
    const key = `${node} ${mat}`;
    let e = out.get(key);
    if (!e) out.set(key, (e = { node, mat, soup: { pos: [], nor: [] } }));
    for (const t of tris) {
      const n = N(t.n);
      for (const p of t.p) { e.soup.pos.push(...P(p)); e.soup.nor.push(...n); }
    }
  };
  for (let i = 0; i < props.length; i += 6) {
    const [kind, variant, rot, x0, z0, scale] = [props[i], props[i + 1], props[i + 2], props[i + 3], props[i + 4], props[i + 5]];
    const m = propModel(kind, variant);
    if (!m) continue;
    const sites = kind === PROP.TREE ? treeSites(variant, x0, z0, rot, scale) : [{ x:x0, z:z0, rot, scale:scale || 1 }];
    for (const {x,z,rot:r,scale:k} of sites) {
      counts[kind] = (counts[kind] ?? 0) + 1;
      const co = Math.cos(r), si = Math.sin(r), y0 = ground(x, z) + (LIFT[kind] ?? 0);
      const P = (p: number[]) => [x + (p[0] * co + p[2] * si) * k, y0 + p[1] * k, z + (-p[0] * si + p[2] * co) * k];
      const N = (n: number[]) => [n[0] * co + n[2] * si, n[1], -n[0] * si + n[2] * co];
      for (const part of m) {
        if (part.lamp) {
          put("night", part.mat, part.tris, P, N);
          put("day", "lampOff", part.tris, P, N);
        } else put("city", part.mat, part.tris, P, N);
      }
    }
  }
  return { soups: out, counts };
}
