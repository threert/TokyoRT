// The far level's windows against the near levels' (far-windows.ts, scene/hero/dress.ts): no city data needed.
//   node tools/tokyo/far-windows.test.ts
import assert from "node:assert/strict";
import { storeySplit, type BuildingLook } from "../../scene/hero/dress.ts";
import { curtainWindows, farWindows, rowAt, storey, upperWindows } from "./far-windows.ts";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log("ok  ", name); };
const look = (height: number, storeys: number, parapet: number, over: Partial<BuildingLook> = {}, small = false): BuildingLook => {
  const { ground, upper } = storeySplit(height - parapet, storeys, small);
  return {
    wall: "w", kind: "commercial", curtain: null,
    windows: { layout: "single", w: 0.6, h: 0.5, frame: "f", bay: 3, ribbonH: 1.3 },
    floors: { storeys, ground, upper }, ...over,
  };
};

test("the rows are the dress's storeys: no drift up the wall", () => {
  for (const [h, n, par] of [[24, 7, 1.1], [34, 10, 0.9], [40, 12, 1.3], [60, 16, 1.2]]) {
    const fw = farWindows(look(h, n, par))!;
    // the dress's floors (dress.ts, a wall standing on the base): a 4 m ground floor, the rest under the parapet
    const { ground, upper } = storeySplit(h - par, n, false);
    const near = [0, ...Array.from({ length: n - 1 }, (_, k) => ground + k * upper), h - par];
    for (let row = 0; row < n; row++) {
      const [fy, fh] = storey(fw, row);
      assert.ok(Math.abs(fy - near[row]) < 1e-9 && Math.abs(fy + fh - near[row + 1]) < 1e-9, `${h} m / ${n}: storey ${row}`);
      assert.equal(rowAt(fw, fy + fh / 2), row);
    }
    // what it was: the wall over the storeys from the base, the parapet in: the top row a third of a storey high
    const old = h / n, top = near[n - 1] + (near[n] - near[n - 1]) / 2;
    assert.ok((n - 0.5) * old - top > 0.8, `${h} m / ${n}: the old rows drifted ${((n - 0.5) * old - top).toFixed(2)} m`);
  }
});

test("an office's floors are a ribbon; a punched module keeps its share of the bay", () => {
  const office = farWindows(look(34, 10, 1, { kind: "office", windows: { layout: "single", w: 0.6, h: 0.5, frame: "f", bay: 1.7, ribbonH: 1.7 } }))!;
  assert.ok(office.ribbon);
  const [r] = upperWindows(office, 3, 1.7), [fy, fh] = storey(office, 3);
  assert.ok(r[1] - r[0] > 0.95, "a ribbon runs the bay");
  assert.ok(Math.abs(r[2] - (fy + 0.85)) < 1e-9 && r[3] <= fy + fh - 0.25 + 1e-9);
  const shop = farWindows(look(24, 7, 1))!;
  const w = upperWindows(shop, 2, 3);
  assert.equal(w.length, 1);
  assert.ok(Math.abs((w[0][1] - w[0][0]) * 3 - 2.5 * 0.6) < 1e-9, "single: wFrac of the usable bay");
  assert.equal(upperWindows(farWindows(look(24, 7, 1, { windows: { layout: "pair", w: 0.6, h: 0.5, frame: "f", bay: 3, ribbonH: 1.3 } }))!, 2, 3).length, 2);
  assert.equal(upperWindows(farWindows(look(24, 7, 1, { windows: { layout: "triple", w: 0.6, h: 0.5, frame: "f", bay: 3, ribbonH: 1.3 } }))!, 2, 3).length, 3);
});

test("a curtain wall: the spandrel band its height over each slab, the vision glass above it to the transom", () => {
  for (const spandrelH of [0.9, 1.1, 1.3]) {
    const fw = farWindows(look(80, 18, 1.2, { kind: "office", curtain: { glass: "g", spandrel: "s", fin: "f", spandrelH } }))!;
    assert.equal(fw.spandrelH, spandrelH);
    for (let row = 1; row < 18; row++) {
      const [fy, fh] = storey(fw, row), w = curtainWindows(fw, row, 1.5);
      assert.equal(w.length, 1, "one pane a bay");
      const [u0, u1, v0, v1] = w[0];
      // (dress.ts curtainFloor: the spandrel min(spandrelH, 40 % of the storey) over the slab, a 4 cm transom, 6 cm fins)
      assert.ok(Math.abs(v0 - (fy + Math.min(spandrelH, fh * 0.4))) < 1e-9 && Math.abs(v1 - (fy + fh - 0.04)) < 1e-9, `storey ${row}`);
      assert.ok(Math.abs((u1 - u0) * 1.5 - 1.44) < 1e-9, "the bay less a fin");
      // the old grid's glass: 74 % of a storey from 26 % up (WINDOW_RECT[GLASS]); the dress's is the storey less its spandrel
      assert.ok(Math.abs((v1 - v0) / fh - (1 - Math.min(spandrelH, fh * 0.4) / fh - 0.04 / fh)) < 1e-9);
    }
    // the lobby: glass from the ground to 0.35 m under the first floor
    const [g] = curtainWindows(fw, 0, 1.5), [, gh] = storey(fw, 0);
    assert.ok(g[2] === 0 && Math.abs(g[3] - (gh - 0.35)) < 1e-9);
  }
  // (and a punched look has none)
  assert.equal(farWindows(look(24, 7, 1))!.spandrelH, undefined);
});

test("a look from before the storeys were recorded keeps the far level's grid", () => {
  const old = look(24, 7, 1) as Partial<BuildingLook>;
  delete old.floors;
  assert.equal(farWindows(old as BuildingLook), null);
});

console.log(`${passed} passed`);
