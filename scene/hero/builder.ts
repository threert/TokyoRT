// Geometry batching for the hero district: triangles gathered per material, then one Mesh per material. Every helper
// takes the normal the face should have and orders its corners to match, so faces read from the right side whatever
// order the caller lists them in. Lengths in metres; UVs in metres too unless a helper says otherwise (the materials'
// textures repeat by their own real-world size: hero/materials.ts).
import { BufferGeometry, Mesh, type MeshStandardMaterial } from "@threert/scene";

export type V3 = [number, number, number];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A growable typed array (the script runtime keeps a plain number[] at 16 bytes an element: millions of vertices would
 *  pass its heap limit). */
class Grow<T extends Float32Array | Float64Array | Uint32Array> {
  a: T;
  length = 0;
  private make: (n: number) => T;
  constructor(make: (n: number) => T) {
    this.make = make;
    this.a = make(1024);
  }
  push(...v: number[]) {
    if (this.length + v.length > this.a.length) {
      const b = this.make(Math.max(this.a.length * 2, this.length + v.length));
      b.set(this.a.subarray(0, this.length));
      this.a = b;
    }
    for (let i = 0; i < v.length; i++) this.a[this.length++] = v[i];
  }
  /** Three (or two) values, without the rest-argument array push(...) costs. */
  v3(x: number, y: number, z: number) {
    if (this.length + 3 > this.a.length) this.grow(3);
    const a = this.a;
    a[this.length] = x;
    a[this.length + 1] = y;
    a[this.length + 2] = z;
    this.length += 3;
  }
  v2(x: number, y: number) {
    if (this.length + 2 > this.a.length) this.grow(2);
    this.a[this.length] = x;
    this.a[this.length + 1] = y;
    this.length += 2;
  }
  private grow(n: number) {
    const b = this.make(Math.max(this.a.length * 2, this.length + n));
    b.set(this.a.subarray(0, this.length));
    this.a = b;
  }
  view(): T {
    return this.a.subarray(0, this.length) as T;
  }
}

class Part {
  pos: Grow<Float32Array | Float64Array>;
  constructor(exact = false) {
    // (a kit element's points in doubles: in single precision, at a kilometre from the origin, the same element in two
    // places differs by a fraction of a millimetre, and its key with it)
    this.pos = exact ? new Grow<Float64Array>((n) => new Float64Array(n)) : new Grow<Float32Array>((n) => new Float32Array(n));
  }
  nor = new Grow((n) => new Float32Array(n));
  uv = new Grow((n) => new Float32Array(n));
  idx = new Grow((n) => new Uint32Array(n));
}

/** A frame on a facade: `o` its origin on the wall at ground level, `u` along the wall, `n` out of it, y up. */
export class Frame {
  readonly o: V3;
  readonly u: V3;
  readonly n: V3;
  constructor(o: V3, u: V3, n: V3) {
    this.o = o;
    this.u = u;
    this.n = n;
  }
  /** The point `s` along, `y` up and `d` out. */
  p(s: number, y: number, d: number): V3 {
    return [this.o[0] + this.u[0] * s + this.n[0] * d, this.o[1] + y, this.o[2] + this.u[2] * s + this.n[2] * d];
  }
  /** A direction in the frame (along, up, out) to world. */
  v(a: number, b: number, c: number): V3 {
    return [this.u[0] * a + this.n[0] * c, b, this.u[2] * a + this.n[2] * c];
  }
}

/** A repeated element (a window, a grate, a lamp) as the builder hands it to a `Batches.kit` sink: its untextured
 *  parts in its own frame (x along the wall, y up, z out of it; metres), one per material, and where it stands. */
export interface KitPiece {
  /** The geometry's identity: equal keys, equal geometry (positions to the millimetre). */
  key: string;
  parts: { material: MeshStandardMaterial; positions: Float32Array; normals: Float32Array; uvs: Float32Array; index: Uint32Array }[];
  /** Its frame in the world, as the columns of a 3 x 4 matrix: x axis, y axis, z axis, origin. */
  matrix: number[];
}

/** What a kit piece may hold (the rest stays in the batches): materials whose look does not depend on UVs, and
 *  tiling ones (`userData.tiling`: textures at their real size, UVs in metres), which take the first copy's UVs. */
function plain(m: MeshStandardMaterial) {
  const t = m as MeshStandardMaterial & { map?: unknown; normalMap?: unknown; roughnessMap?: unknown; emissiveMap?: unknown; alphaMap?: unknown; shader?: unknown };
  if (t.userData?.tiling === true) return true;
  return !t.map && !t.normalMap && !t.roughnessMap && !t.emissiveMap && !t.alphaMap && !t.shader;
}

export class Batches {
  private parts = new Map<MeshStandardMaterial, Part>();
  triangles = 0;
  /** Where repeated elements go (`piece`): none, and they are batched as everything else is. */
  kit: ((piece: KitPiece) => void) | null = null;
  /** An element of fewer triangles is batched all the same (an instance costs about as much as a few triangles). */
  kitMinTriangles = 24;
  private open: { o: V3; u: V3; n: V3; scale: V3; parts: Map<MeshStandardMaterial, Part>; from: Map<Part, number> } | null = null;

  private part(m: MeshStandardMaterial): Part {
    const into = this.open && plain(m) ? this.open.parts : this.parts;
    let p = into.get(m);
    if (!p) into.set(m, (p = new Part(into !== this.parts)));
    return p;
  }

  /** Starts a repeated element in frame `f` at (s, y) (its origin; y in the frame's terms): until `end`, what it adds
   *  in untextured materials is the element's. `scale` stretches it about its origin (along, up, out) where it stands:
   *  an element drawn at a standard size and placed at its own (the element's pieces stretched by its instance, the
   *  rest drawn meanwhile stretched here). `d` puts its origin out of the wall (in, below 0). Without a `kit` sink, only
   *  the stretch. */
  begin(f: Frame, s: number, y: number, scale: V3 = [1, 1, 1], d = 0) {
    if (this.open) throw new Error("Batches.begin: an element is open");
    const from = new Map<Part, number>();
    for (const p of this.parts.values()) from.set(p, p.pos.length);
    this.open = { o: f.p(s, y, d), u: [f.u[0], 0, f.u[2]], n: [f.n[0], 0, f.n[2]], scale, parts: new Map(), from };
    // (no sink: everything goes to the batches, and `end` stretches it)
    if (!this.kit) this.open.parts = this.parts;
  }

  /** The horizontal axes round ones start from: the open element's (along, out), else the world's (x, z). */
  private axes(): [V3, V3] {
    return this.open ? [this.open.u, this.open.n] : [[1, 0, 0], [0, 0, 1]];
  }

  /** Ends the element: its parts to the sink, in its own frame; what else it drew stretched where it stands. */
  end() {
    const e = this.open;
    if (!e) return;
    this.open = null;
    const { o, u, n, scale } = e;
    if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) {
      for (const p of this.parts.values()) {
        const P = p.pos.a;
        for (let i = e.from.get(p) ?? 0; i < p.pos.length; i += 3) {
          const dx = P[i] - o[0], dy = P[i + 1] - o[1], dz = P[i + 2] - o[2];
          const a = (dx * u[0] + dz * u[2]) * scale[0], c = (dx * n[0] + dz * n[2]) * scale[2];
          P[i] = o[0] + u[0] * a + n[0] * c;
          P[i + 1] = o[1] + dy * scale[1];
          P[i + 2] = o[2] + u[2] * a + n[2] * c;
        }
      }
    }
    if (!this.kit || !e.parts.size) return;
    let tris = 0;
    for (const p of e.parts.values()) tris += p.idx.length / 3;
    if (tris < this.kitMinTriangles) {
      // (into the batches as it stands)
      for (const [m, c] of e.parts) {
        let p = this.parts.get(m);
        if (!p) this.parts.set(m, (p = new Part()));
        const base = p.pos.length / 3, P = c.pos.view(), N = c.nor.view(), U = c.uv.view(), I = c.idx.view();
        for (let i = 0; i < P.length; i += 3) {
          p.pos.v3(P[i], P[i + 1], P[i + 2]);
          p.nor.v3(N[i], N[i + 1], N[i + 2]);
        }
        for (let i = 0; i < U.length; i += 2) p.uv.v2(U[i], U[i + 1]);
        for (let i = 0; i < I.length; i += 3) p.idx.v3(base + I[i], base + I[i + 1], base + I[i + 2]);
      }
      return;
    }
    const parts: KitPiece["parts"] = [];
    let h1 = 0x811c9dc5 | 0, h2 = 0x27d4eb2f | 0;
    const mix = (v: number) => {
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 ^ v, 0x5bd1e995) ^ (h2 >>> 13);
    };
    for (const [material, p] of [...e.parts].sort((a, b) => (a[0].name < b[0].name ? -1 : a[0].name > b[0].name ? 1 : 0))) {
      if (!p.idx.length) continue;
      const P = p.pos.view(), N = p.nor.view(), I = p.idx.view().slice();
      const positions = new Float32Array(P.length), normals = new Float32Array(N.length);
      for (let i = 0; i < P.length; i += 3) {
        const dx = P[i] - o[0], dy = P[i + 1] - o[1], dz = P[i + 2] - o[2];
        positions[i] = Math.round((dx * u[0] + dz * u[2]) * 1000) / 1000;
        positions[i + 1] = Math.round(dy * 1000) / 1000;
        positions[i + 2] = Math.round((dx * n[0] + dz * n[2]) * 1000) / 1000;
        normals[i] = N[i] * u[0] + N[i + 2] * u[2];
        normals[i + 1] = N[i + 1];
        normals[i + 2] = N[i] * n[0] + N[i + 2] * n[2];
      }
      for (let k = 0; k < material.name.length; k++) mix(material.name.charCodeAt(k));
      for (let i = 0; i < positions.length; i++) mix(Math.round(positions[i] * 1000));
      for (let i = 0; i < normals.length; i++) mix(Math.round(normals[i] * 100));
      for (let i = 0; i < I.length; i++) mix(I[i]);
      parts.push({ material, positions, normals, uvs: p.uv.view().slice(), index: I });
    }
    if (!parts.length) return;
    const key = (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
    const [sx, sy, sz] = scale;
    this.kit({ key, parts, matrix: [u[0] * sx, 0, u[2] * sx, 0, sy, 0, n[0] * sz, 0, n[2] * sz, o[0], o[1], o[2]] });
  }

  /** A quad a b c d (a ring, either order) facing `n`, with UVs per corner. */
  quad(m: MeshStandardMaterial, a: V3, b: V3, c: V3, d: V3, n: V3, uv: [number, number][]) {
    const p = this.part(m);
    const base = p.pos.length / 3;
    let corners = [a, b, c, d], uvs = uv;
    if (dot(cross(sub(b, a), sub(c, a)), n) < 0) {
      corners = [a, d, c, b];
      uvs = [uv[0], uv[3], uv[2], uv[1]];
    }
    for (let k = 0; k < 4; k++) {
      { const q = corners[k]; p.pos.v3(q[0], q[1], q[2]); }
      { const q = n; p.nor.v3(q[0], q[1], q[2]); }
      { const q = uvs[k]; p.uv.v2(q[0], q[1]); }
    }
    p.idx.v3(base, base + 1, base + 2);
    p.idx.v3(base, base + 2, base + 3);
    this.triangles += 2;
  }

  /** A triangle facing `n`. */
  tri(m: MeshStandardMaterial, a: V3, b: V3, c: V3, n: V3, uv: [number, number][] = [[0, 0], [1, 0], [0, 1]]) {
    const p = this.part(m);
    const base = p.pos.length / 3;
    const flip = dot(cross(sub(b, a), sub(c, a)), n) < 0;
    const cs = flip ? [a, c, b] : [a, b, c], us = flip ? [uv[0], uv[2], uv[1]] : uv;
    for (let k = 0; k < 3; k++) {
      { const q = cs[k]; p.pos.v3(q[0], q[1], q[2]); }
      { const q = n; p.nor.v3(q[0], q[1], q[2]); }
      { const q = us[k]; p.uv.v2(q[0], q[1]); }
    }
    p.idx.v3(base, base + 1, base + 2);
    this.triangles++;
  }

  /** A rectangle in a facade frame: from (s0, y0) to (s1, y1) at depth d, facing `dir` (default out of the wall);
   *  UVs in metres (s, y), or `uv` [u0, v0, u1, v1] across it (three.js UVs: v up, v0 at the bottom). */
  rect(m: MeshStandardMaterial, f: Frame, s0: number, y0: number, s1: number, y1: number, d: number, uv?: [number, number, number, number], dir: V3 = f.n) {
    const [u0, v0, u1, v1] = uv ?? [s0, y0, s1, y1];
    // with the normal along -n the picture reads mirrored unless u runs the other way
    const back = dot(dir, f.n) < 0;
    const U0 = back && uv ? u1 : u0, U1 = back && uv ? u0 : u1;
    this.quad(m, f.p(s0, y0, d), f.p(s1, y0, d), f.p(s1, y1, d), f.p(s0, y1, d), dir, [[U0, v0], [U1, v0], [U1, v1], [U0, v1]]);
  }

  /** A horizontal rectangle in a facade frame at height y: s0..s1 along, d0..d1 out, facing up (or down). */
  flat(m: MeshStandardMaterial, f: Frame, s0: number, s1: number, d0: number, d1: number, y: number, down = false) {
    this.quad(m, f.p(s0, y, d0), f.p(s1, y, d0), f.p(s1, y, d1), f.p(s0, y, d1), [0, down ? -1 : 1, 0], [[s0, d0], [s1, d0], [s1, d1], [s0, d1]]);
  }

  /** A box in a facade frame: s0..s1 along, y0..y1 up, d0..d1 out. `faces` leaves some out (e.g. the back on a wall).
   *  UVs in metres on each face. `front` overrides the material of the face that looks out (+n), `frontUV` its cell. */
  box(m: MeshStandardMaterial, f: Frame, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, o: { skip?: string; front?: MeshStandardMaterial; frontUV?: [number, number, number, number]; back?: MeshStandardMaterial; backUV?: [number, number, number, number] } = {}) {
    const skip = o.skip ?? "";
    const P = (s: number, y: number, d: number) => f.p(s, y, d);
    const ex = f.n, eu = f.u;
    if (!skip.includes("n")) this.quad(o.front ?? m, P(s0, y0, d1), P(s1, y0, d1), P(s1, y1, d1), P(s0, y1, d1), ex, o.frontUV ? cell(o.frontUV, false) : [[s0, y0], [s1, y0], [s1, y1], [s0, y1]]);
    if (!skip.includes("b")) this.quad(o.back ?? m, P(s0, y0, d0), P(s1, y0, d0), P(s1, y1, d0), P(s0, y1, d0), mul(ex, -1), o.backUV ? cell(o.backUV, true) : [[s0, y0], [s1, y0], [s1, y1], [s0, y1]]);
    if (!skip.includes("t")) this.quad(m, P(s0, y1, d0), P(s1, y1, d0), P(s1, y1, d1), P(s0, y1, d1), [0, 1, 0], [[s0, d0], [s1, d0], [s1, d1], [s0, d1]]);
    if (!skip.includes("d")) this.quad(m, P(s0, y0, d0), P(s1, y0, d0), P(s1, y0, d1), P(s0, y0, d1), [0, -1, 0], [[s0, d0], [s1, d0], [s1, d1], [s0, d1]]);
    if (!skip.includes("l")) this.quad(m, P(s0, y0, d0), P(s0, y0, d1), P(s0, y1, d1), P(s0, y1, d0), mul(eu, -1), [[d0, y0], [d1, y0], [d1, y1], [d0, y1]]);
    if (!skip.includes("r")) this.quad(m, P(s1, y0, d0), P(s1, y0, d1), P(s1, y1, d1), P(s1, y1, d0), eu, [[d0, y0], [d1, y0], [d1, y1], [d0, y1]]);
  }

  /** A tube along a polyline (radius r, `seg` sides), UV u round (0..1), v along in metres. */
  tube(m: MeshStandardMaterial, pts: V3[], r: number, seg = 6, caps = false) {
    const p = this.part(m);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], t = norm(sub(b, a));
      // (an element's tubes turned by its frame, not the world's axes: the same element facing elsewhere, the same key)
      const ref: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : this.open ? this.open.u : [1, 0, 0];
      const x = norm(cross(t, ref)), y = cross(t, x);
      const base = p.pos.length / 3, L = len(sub(b, a));
      for (let k = 0; k <= seg; k++) {
        const ang = (k / seg) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
        const nn: V3 = add(mul(x, c), mul(y, s));
        for (const [q, v] of [[a, 0], [b, L]] as const) {
          { const w = add(q, mul(nn, r)); p.pos.v3(w[0], w[1], w[2]); }
          { const q = nn; p.nor.v3(q[0], q[1], q[2]); }
          p.uv.push(k / seg, v);
        }
      }
      for (let k = 0; k < seg; k++) {
        const i0 = base + 2 * k;
        // the ring runs counter-clockwise about t: (a_k, a_k+1, b_k+1) faces out
        p.idx.push(i0, i0 + 2, i0 + 3, i0, i0 + 3, i0 + 1);
        this.triangles += 2;
      }
      if (caps && (i === 0 || i + 2 === pts.length)) {
        const end = i === 0 ? a : b, nrm = i === 0 ? mul(t, -1) : t;
        const ring: V3[] = Array.from({ length: seg }, (_, k) => add(end, mul(add(mul(x, Math.cos((k / seg) * Math.PI * 2)), mul(y, Math.sin((k / seg) * Math.PI * 2))), r)));
        for (let k = 1; k + 1 < seg; k++) this.tri(m, ring[0], ring[k], ring[k + 1], nrm);
      }
    }
  }

  /** A cylinder standing on (x, y, z): radius r0 at the foot to r1 at the top, `h` tall, capped on top. UV u round in
   *  metres of circumference, v up in metres. */
  cylinder(m: MeshStandardMaterial, c: V3, r0: number, r1: number, h: number, seg = 12, uScale = 1) {
    const p = this.part(m);
    const base = p.pos.length / 3, slope = (r0 - r1) / h;
    const [ex, ez] = this.axes();
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cx = ca * ex[0] + sa * ez[0], cz = ca * ex[2] + sa * ez[2];
      const nn = norm([cx, slope, cz]);
      p.pos.v3(c[0] + cx * r0, c[1], c[2] + cz * r0);
      p.pos.v3(c[0] + cx * r1, c[1] + h, c[2] + cz * r1);
      p.nor.v3(nn[0], nn[1], nn[2]);
      p.nor.v3(nn[0], nn[1], nn[2]);
      const u = (k / seg) * 2 * Math.PI * r0 * uScale;
      p.uv.push(u, 0, u, h);
    }
    for (let k = 0; k < seg; k++) {
      const i0 = base + 2 * k;
      p.idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
      this.triangles += 2;
    }
    const top: V3 = [c[0], c[1] + h, c[2]];
    const rim = (a: number): V3 => [c[0] + (Math.cos(a) * ex[0] + Math.sin(a) * ez[0]) * r1, c[1] + h, c[2] + (Math.cos(a) * ex[2] + Math.sin(a) * ez[2]) * r1];
    for (let k = 0; k < seg; k++) this.tri(m, top, rim((k / seg) * Math.PI * 2), rim(((k + 1) / seg) * Math.PI * 2), [0, 1, 0]);
  }

  /** A sphere-ish lantern body (a squashed lathe) at `c`: radius r, height h; UV u round 0..1, v 0..1 down. */
  lantern(m: MeshStandardMaterial, c: V3, r: number, h: number, seg = 16, rings = 10, cu: [number, number] = [0, 1]) {
    const p = this.part(m);
    const base = p.pos.length / 3;
    const [ex, ez] = this.axes();
    for (let j = 0; j <= rings; j++) {
      const t = j / rings, y = c[1] + h / 2 - t * h;
      // a barrel: full radius at the middle, 70 % at the rims
      const rr = r * (0.7 + 0.3 * Math.sin(Math.PI * t));
      const dr = r * 0.3 * Math.cos(Math.PI * t) * (Math.PI / rings) / (h / rings);
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cx = ca * ex[0] + sa * ez[0], cz = ca * ex[2] + sa * ez[2];
        p.pos.v3(c[0] + cx * rr, y, c[2] + cz * rr);
        { const q = norm([cx, dr * 0.5, cz]); p.nor.v3(q[0], q[1], q[2]); }
        p.uv.push(cu[0] + (k / seg) * (cu[1] - cu[0]), 1 - t);
      }
    }
    const row = seg + 1;
    for (let j = 0; j < rings; j++) for (let k = 0; k < seg; k++) {
      const i0 = base + j * row + k;
      p.idx.push(i0, i0 + row + 1, i0 + row, i0, i0 + 1, i0 + row + 1);
      this.triangles += 2;
    }
  }

  /** A hanging cable from a to b sagging `sag` m at its middle (a parabola), radius r. */
  wire(m: MeshStandardMaterial, a: V3, b: V3, sag: number, r: number, steps = 12) {
    // (a step every metre or so: a short drop needs few)
    steps = Math.min(steps, Math.max(4, Math.ceil(len(sub(b, a)))));
    const pts: V3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const q = lerp3(a, b, t);
      q[1] -= 4 * sag * t * (1 - t);
      pts.push(q);
    }
    this.tube(m, pts, r, 4);
  }

  /** A flat polygon (a convex or simple ring, triangulated by `tris`) at its points, facing `n`. UVs: x, z in metres. */
  polygon(m: MeshStandardMaterial, pts: V3[], tris: number[], n: V3) {
    for (let i = 0; i < tris.length; i += 3) {
      const a = pts[tris[i]], b = pts[tris[i + 1]], c = pts[tris[i + 2]];
      this.tri(m, a, b, c, n, [[a[0], a[2]], [b[0], b[2]], [c[0], c[2]]]);
    }
  }

  /** A grid surface over (x0..x1, z0..z1) every `step` m at height `y(x, z)`, facing up. */
  heightfield(m: MeshStandardMaterial, x0: number, z0: number, x1: number, z1: number, step: number, y: (x: number, z: number) => number, keep?: (x: number, z: number) => boolean) {
    const p = this.part(m);
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const base = p.pos.length / 3;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const h = y(x, z), hx = y(x + 0.5, z) - y(x - 0.5, z), hz = y(x, z + 0.5) - y(x, z - 0.5);
      p.pos.push(x, h, z);
      { const q = norm([-hx, 1, -hz]); p.nor.v3(q[0], q[1], q[2]); }
      p.uv.push(x, z);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (keep && !keep(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
      const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      // facing up (y): a, c, d / a, d, b  (x east, z south: a->c is +z, a->b is +x; (c-a) x (b-a) = +y)
      p.idx.push(a, c, d, a, d, b);
      this.triangles += 2;
    }
  }

  /** The batches as arrays, one entry per material (baking). */
  entries(): { material: MeshStandardMaterial; positions: Float32Array; normals: Float32Array; uvs: Float32Array; index: Uint32Array }[] {
    return [...this.parts].filter(([, p]) => p.idx.length).map(([material, p]) => ({ material, positions: p.pos.view() as Float32Array, normals: p.nor.view(), uvs: p.uv.view(), index: p.idx.view() }));
  }

  /** The meshes, one per material. */
  meshes(name: string): Mesh[] {
    const out: Mesh[] = [];
    for (const [m, p] of this.parts) {
      if (!p.idx.length) continue;
      // (the views as they are: setData would copy each array once more)
      const g = new BufferGeometry();
      g.positions = p.pos.view() as Float32Array;
      g.normals = p.nor.view();
      g.uvs = p.uv.view();
      g.index = p.idx.view();
      const mesh = new Mesh(g, m);
      mesh.name = `${name} ${m.name}`;
      out.push(mesh);
    }
    return out;
  }
}

/** The four UVs of an atlas cell given in image terms [u0, top, u1, bottom] (v down the image), as three.js UVs (v up)
 *  in the order rect/quad list corners (bottom-left first). */
function cell(c: [number, number, number, number], mirror: boolean): [number, number][] {
  const [u0, v0, u1, v1] = c;
  const L = mirror ? u1 : u0, R = mirror ? u0 : u1;
  return [[L, 1 - v1], [R, 1 - v1], [R, 1 - v0], [L, 1 - v0]];
}

/** A small deterministic random stream (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next: r,
    range: (a0: number, a1: number) => a0 + (a1 - a0) * r(),
    int: (n: number) => Math.floor(r() * n),
    pick: <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)],
    chance: (p: number) => r() < p,
  };
}
