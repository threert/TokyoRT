// The street-ref scoring on a synthetic area whose numbers are known: a 6 m kerbless lane with poles every 30 m and
// 4-storey flats close on both sides, beside a 12 m road with kerbed footways and no poles; and the sun term on its own.
//   node tools/tokyo/street-ref.test.ts
import assert from "node:assert/strict";
import { AREA, PROP } from "../city/shared/tileformat.js";
import { band, refPoses, score, straightRuns, sunAgainst, sunDir, type Edge, type Tile } from "./street-ref.ts";

const ring = (pts: number[][]) => Float32Array.from(pts.flat());
const box = (x0: number, z0: number, x1: number, z1: number) => [ring([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])];
const flat = (x0: number, z0: number, x1: number, z1: number, storeys: number) => ({ storeys, base: 30, height: storeys * 3, polygons: [box(x0, z0, x1, z1)] });

// the lane: along +x at z = 0, 0-150 m, 6 m wide; flats 1 m back on both sides every 15 m
const areas: Tile["areas"] = [{ kind: AREA.CARRIAGEWAY, polygons: [box(0, -3, 150, 3)] }];
const buildings = [];
for (let x = 0; x < 150; x += 15) buildings.push(flat(x, -16, x + 13, -4, 4), flat(x, 4, x + 13, 16, 4));
const props = [0, 30, 60, 90, 120, 150].map((x) => ({ kind: PROP.POLE, variant: 0, rot: 0, x, z: 3.5 }));
// the wide road: along +x at z = 300, 12 m wide, footways beside it, no poles, low buildings
areas.push({ kind: AREA.CARRIAGEWAY, polygons: [box(0, 294, 150, 306)] }, { kind: AREA.SIDEWALK, polygons: [box(0, 290, 150, 294)] }, { kind: AREA.SIDEWALK, polygons: [box(0, 306, 150, 310)] });
for (let x = 0; x < 150; x += 15) buildings.push(flat(x, 276, x + 13, 289, 1), flat(x, 311, x + 13, 324, 1));
const tiles: Tile[] = [{ areas, props, wires: new Float32Array(0), buildings }];
// each road in two edges joined at a node (straight on), and a bent street that is cut at its corner
const edges: Edge[] = [
  { a: 0, b: 1, highway: "residential", pts: [0, 30, 0, 75, 30, 0] },
  { a: 1, b: 2, highway: "residential", pts: [75, 30, 0, 150, 30, 0] },
  { a: 3, b: 4, highway: "unclassified", lanes: 2, pts: [0, 30, 300, 150, 30, 300] },
  { a: 5, b: 6, highway: "residential", pts: [600, 30, 0, 640, 30, 0, 640, 30, 40] },
  { a: 7, b: 8, highway: "primary", pts: [0, 30, 900, 300, 30, 900] },
];

// the joined runs: the lane whole (150 m), the wide road; the bent street's legs (40 m) and the primary are not runs
const runs = straightRuns(edges);
assert.equal(runs.length, 2);
assert.ok(Math.abs(runs[0].len - 150) < 1e-6 && runs[0].pts.length === 3);

// the sun: azimuth as setSunAngles takes it (0 = towards +z, 90 = towards +x)
assert.deepEqual(sunDir({ elevation: 10, azimuth: 90 }).map((v) => +v.toFixed(6)), [1, 0]);
// a street along x, the sun 40 degrees off its axis to the +x end and +z side: the camera turned to look towards -x,
// the sun behind it on its left (+z), lighting the right side's facades (those facing +z)
const az = 90 - 40, s = sunAgainst(1, 0, { elevation: 12, azimuth: az }, 12, 12, 10);
assert.equal(s.dx, -1);
assert.ok(Math.abs(s.off - 40) < 1e-6);
assert.equal(s.litSide, "right");
// the shadow of 12 m across 10 m between facades: 12 - (10 / sin 40) tan 12 = 8.69 m, so 27.6 % of 12 m is lit
assert.ok(Math.abs(s.litFacade - (1 - (12 - (10 / Math.sin(40 * Math.PI / 180)) * Math.tan(12 * Math.PI / 180)) / 12)) < 1e-9);
assert.equal(sunAgainst(1, 0, { elevation: -2, azimuth: az }, 12, 12, 10).litFacade, 0);
// the sun term: 1 from 20 to 60 degrees off the axis, none straight down the street or square across it
assert.equal(band(40, 20, 60, 20), 1);
assert.equal(band(0, 20, 60, 20), 0);
assert.equal(band(90, 20, 60, 20), 0);
assert.ok(Math.abs(band(10, 20, 60, 20) - 0.5) < 1e-9);

// the whole: the lane first, its parts as built; the wide road behind it on width, kerbs, poles and flats
const sun = { elevation: 12, azimuth: az };
const cs = refPoses(tiles, edges, sun, (x, z) => [x, z], 5);
assert.equal(cs.length, 2);
const [lane, wide] = cs;
assert.ok(Math.abs(lane.pos[2]) < 4 && Math.abs(wide.pos[2] - 300) < 4, "the lane ranks first");
assert.ok(lane.m.width > 5.5 && lane.m.width <= 6.5, `lane width ${lane.m.width}`);
assert.equal(lane.m.kerbed, 0);
assert.equal(lane.m.poles, 6);
assert.equal(lane.m.poleSpacing, 30);
for (const side of lane.m.sides) { assert.equal(side.storeys, 4); assert.ok(side.frontage > 0.8 && side.setback <= 1.5, JSON.stringify(side)); }
assert.ok(wide.m.width > 11 && wide.m.kerbed === 1 && wide.m.poles === 0);
assert.equal(lane.parts.width, 1);
assert.equal(lane.parts.kerbless, 1);
assert.equal(lane.parts.poles, 1);
assert.ok(lane.parts.sun > 0.5 && lane.sunOff > 39 && lane.sunOff < 41);
assert.ok(lane.score > wide.score + 0.3, `${lane.score} vs ${wide.score}`);
// the eye: 1.7 m over the road, looking away from the sun (towards -x), 8 m in from the run's far end
assert.equal(lane.pos[1], 31.7);
assert.ok(lane.target[0] < lane.pos[0] && Math.abs(lane.pos[0] - 142) < 1e-6);
// towers at the end of the view count against it
const towerTiles: Tile[] = [{ ...tiles[0], buildings: [...buildings, flat(-400, -20, -380, 0, 40)] }];
const [withTower] = refPoses(towerTiles, edges, sun, (x, z) => [x, z], 1);
assert.equal(withTower.towers, 1);
assert.ok(withTower.score < lane.score);
// and the score's weights sum to one
assert.ok(Math.abs(score(lane.m, 40, 1, 0).score - 1 + 0.2 * (1 - lane.parts.flats)) < 1e-9);
console.log("street-ref: ok");
