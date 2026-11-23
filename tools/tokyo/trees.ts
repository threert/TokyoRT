// Offline foliage compiler. The pinned upstream source exposes the skeleton/LOD API ahead of its npm build.
import { Tree, TreePreset } from "@dgreenheck/ez-tree";
import { BufferGeometry, Color, CylinderGeometry, Quaternion, Vector3 } from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TREE_FORMS, TREE_HEIGHTS, treeKey } from "../../scene/trees.ts";
import { GlbBuilder } from "./glb.ts";
import { repoRoot } from "../lib/paths.ts";

const output = join(repoRoot, "assets/city/street-models");
const presets = ["Ash Small", "Aspen Medium", "Oak Medium", "Ash Large", "Aspen Medium", "Oak Small"] as const;
const tints = [0x638347, 0x71924c, 0x597d44, 0x719252, 0x85a54c, 0x728e54];
type Tri = { p: number[][]; n: number[] };
type FarPart = { mat: string; tris: Tri[] };
type Batch = { points: Vector3[]; indices: number[] };
const bark = new Color(0x76604c);
const axisY = new Vector3(0, 1, 0);
const point = (geometry: BufferGeometry, i: number) =>
  new Vector3().fromBufferAttribute(geometry.getAttribute("position"), i);
const coord = (color: Color): [number, number, number] => [color.r, color.g, color.b];

function writeMesh(glb: GlbBuilder, name: string, geom: BufferGeometry, color: Color, leaves = false) {
  const pos = geom.getAttribute("position"), normal = geom.getAttribute("normal");
  const index = geom.getIndex()?.array ?? Array.from({ length: pos.count }, (_, i) => i);
  glb.triangles(
    glb.material({ name, color: coord(color), roughness: leaves ? 0.78 : 0.94, doubleSided: leaves }),
    Float32Array.from(pos.array),
    Float32Array.from(normal.array),
    null,
    Uint32Array.from(index),
  );
}

// Give each EZ-Tree leaf card a sprig of folded, pointed leaves using only opaque triangles.
// Coordinates run across and along the original card. Its placement and rotation come from the upstream generator.
function sprigs(cards: BufferGeometry, near: boolean, broad: number) {
  const batches: Batch[] = Array.from({ length: 3 }, () => ({ points: [], indices: [] }));
  const count = cards.getAttribute("position").count;
  for (let i = 0; i < count; i += 4) {
    const base = point(cards, i + 1), right = point(cards, i + 2).sub(base), up = point(cards, i).sub(base);
    const normal = right.clone().cross(up).normalize().multiplyScalar(up.length());
    base.addScaledVector(right, .5);
    const local = (u: number, v: number, fold: number) =>
      base.clone().addScaledVector(right, u).addScaledVector(up, v).addScaledVector(normal, fold);
    const pairs = near ? 3 : 2;
    const leaf = (u: number, v: number, dx: number, dy: number, width: number, shade: number) => {
      const b = batches[shade], j = b.points.length, len = Math.hypot(dx, dy);
      const wx = -dy / len * width, wy = dx / len * width, cx = u + dx * .50, cy = v + dy * .50;
      b.points.push(
        local(u, v, 0),
        local(cx + wx, cy + wy, .015),
        local(u + dx, v + dy, -.035),
        local(cx - wx, cy - wy, .015),
        local(cx, cy, .076),
      );
      b.indices.push(j, j + 4, j + 1, j + 1, j + 4, j + 2, j + 2, j + 4, j + 3, j + 3, j + 4, j);
    };
    const shade = (i / 4 * 13 + Math.floor(i / 28)) % 3;
    for (let j = 0; j < pairs; j++) {
      for (const side of [-1, 1]) {
        leaf(
          0,
          j * .62 / pairs,
          side * (.49 - j * .07),
          .37,
          .10 * broad * (near ? 1 : 1.35),
          (shade + j + (side + 1) / 2) % 3,
        );
      }
    }
    leaf(0, .54, .055, .47, .12 * broad, shade);
  }
  return batches.map((b) => {
    const g = new BufferGeometry().setFromPoints(b.points);
    g.setIndex(b.indices);
    g.computeVertexNormals();
    return g;
  });
}

function faces(geometry: BufferGeometry): Tri[] {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry, result: Tri[] = [];
  for (let i = 0; i < flat.getAttribute("position").count; i += 3) {
    const a = point(flat, i), b = point(flat, i + 1), c = point(flat, i + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() > 1e-12) result.push({ p: [a.toArray(), b.toArray(), c.toArray()], n: n.normalize().toArray() });
  }
  return result;
}

// At city scale, represent each lobe of the real crown by its outermost samples in 14 directions.
function crownLobes(cards: BufferGeometry, size: number) {
  const points = Array.from(
    { length: cards.getAttribute("position").count / 4 },
    (_, j) => point(cards, j * 4).lerp(point(cards, j * 4 + 2), .5).multiplyScalar(size),
  );
  const centres = [points[0].clone()];
  const distance = (a: Vector3) => Math.min(...centres.map((b) => a.distanceToSquared(b)));
  while (centres.length < 6) centres.push(points.reduce((a, b) => distance(b) > distance(a) ? b : a).clone());
  let clusters: Vector3[][] = [];
  for (let pass = 0; pass < 5; pass++) {
    clusters = centres.map(() => []);
    for (const p of points) {
      let nearest = 0;
      for (let j = 1; j < centres.length; j++) {
        if (p.distanceToSquared(centres[j]) < p.distanceToSquared(centres[nearest])) nearest = j;
      }
      clusters[nearest].push(p);
    }
    clusters.forEach((group, j) => {
      if (group.length) centres[j].copy(group.reduce((a, b) => a.add(b), new Vector3()).divideScalar(group.length));
    });
  }
  const dirs = [
    axisY,
    axisY.clone().negate(),
    new Vector3(1, 0, 0),
    new Vector3(-1, 0, 0),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  ];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) for (const z of [-1, 1]) dirs.push(new Vector3(x, y, z).normalize());
  }
  return clusters.filter((group) => group.length >= 4).map((group) => {
    const outer = dirs.map((d) =>
      group.reduce((a, b) => a.dot(d) > b.dot(d) ? a : b).clone().addScaledVector(d, size * .45)
    );
    return faces(new ConvexGeometry(outer));
  });
}

mkdirSync(output, { recursive: true });
const far: FarPart[][] = [];
const colors: Record<string, [number, number, number]> = { "ez-bark": coord(bark) };
for (const [v, form] of TREE_FORMS.entries()) {
  const tree = new Tree();
  tree.options.copy(structuredClone(TreePreset[presets[v]]));
  tree.options.seed = 7411 + v * 137;
  tree.options.leaves.billboard = "single";
  tree.options.branch.children[0] = Math.min(tree.options.branch.children[0], 10);
  tree.options.branch.children[1] = Math.min(tree.options.branch.children[1], 4);
  tree.options.branch.children[2] = Math.min(tree.options.branch.children[2], 3);
  tree.options.leaves.count = 12;
  if (v === 4) tree.options.branch.angle[1] = 34;
  if (v === 5) tree.options.branch.angle[1] = 66;
  const reference = tree.createGeometry({ sectionStride: 2, segmentFactor: .75 });
  const cards = reference.leaves.getAttribute("position").count / 4;
  const stride = Math.max(1, Math.ceil(cards / 480));
  const full = stride === 1
    ? reference
    : tree.createGeometry({ sectionStride: 2, segmentFactor: .75, leafStride: stride, leafScale: Math.sqrt(stride) });
  const mid = tree.createGeometry({
    sectionStride: 5,
    segmentFactor: .4,
    leafStride: stride * 4,
    leafScale: Math.sqrt(stride) * 1.75,
  });
  full.leaves.computeBoundingBox();
  full.branches.computeBoundingBox();
  const height = Math.max(full.leaves.boundingBox!.max.y, full.branches.boundingBox!.max.y);
  const size = TREE_HEIGHTS[v] / height;
  const palette = [.78, 1, 1.20].map((k) => new Color(tints[v]).multiplyScalar(k));
  const leafName = (i: number) => `ez-${form}-leaves-${i}`;
  palette.forEach((c, i) => colors[leafName(i)] = coord(c));
  const stats: number[] = [];
  for (const [level, meshes] of [full, mid].entries()) {
    const g = new GlbBuilder();
    writeMesh(g, "ez-bark", meshes.branches.scale(size, size, size), bark);
    sprigs(meshes.leaves, level === 0, v === 4 ? 1.3 : 1).forEach((geom, i) =>
      writeMesh(g, leafName(i), geom.scale(size, size, size), palette[i], true)
    );
    const key = treeKey(v, level);
    writeFileSync(join(output, key + ".glb"), g.build(key));
    stats.push(g.stats.triangles);
  }
  const trunk: Tri[] = [];
  const trunkBranch = tree.skeleton!.branches[0] as { sections: { origin: Vector3; radius: number }[] };
  const sections = trunkBranch.sections;
  const middle = Math.floor((sections.length - 1) / 2);
  for (const [a, b] of [[sections[0], sections[middle]], [sections[middle], sections[sections.length - 1]]]) {
    const delta = b.origin.clone().sub(a.origin);
    const cylinder = new CylinderGeometry(b.radius * size, a.radius * size, delta.length() * size, 5, 1, true);
    cylinder.applyQuaternion(new Quaternion().setFromUnitVectors(axisY, delta.normalize()));
    const c = a.origin.clone().lerp(b.origin, .5).multiplyScalar(size);
    trunk.push(...faces(cylinder.translate(c.x, c.y, c.z)));
  }
  const lobes = crownLobes(reference.leaves, size);
  far.push([{ mat: "ez-bark", tris: trunk }, ...lobes.map((tris, i) => ({ mat: leafName(i % 3), tris }))]);
  console.log(form, "near/mid/far triangles", ...stats, far[v].reduce((n, p) => n + p.tris.length, 0));
}
writeFileSync(join(output, "ez-far.json"), JSON.stringify({ colors, forms: far }));
