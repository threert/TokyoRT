// The far level's facade category against the near levels' look (b.look): no city data needed.
// Usage: node tools/city/tests/far-looks.test.mjs
import assert from 'node:assert/strict';
import { buildingMesh, facadeCategory } from '../mesh/meshing.js';
import { CAT, KIND } from '../mesh/constants.js';
import { MATERIAL } from '../shared/tileformat.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

const punched = { wall: [0.6, 0.58, 0.52], curtain: null };
const curtain = { wall: [0.3, 0.32, 0.35], curtain: 'curtain glass blue' };
const office = (height, storeys, extra = {}) => ({ usage: 401, storeys, height, base: 0, hint: 0, ...extra });

test('without a look: the source\'s categories, unchanged', () => {
  assert.equal(facadeCategory(office(34, 10), 0.1), CAT.GLASS); // a quarter of 24-45 m offices
  assert.equal(facadeCategory(office(34, 10), 0.6), CAT.COMMERCIAL);
  assert.equal(facadeCategory(office(60, 8), 0.6), CAT.GLASS);
  assert.equal(facadeCategory({ usage: 412, storeys: 4, height: 12, hint: MATERIAL.GLASS << 24 }, 0.6), CAT.GLASS);
  assert.equal(facadeCategory({ usage: 412, storeys: 30, height: 100 }, 0.6, true), CAT.GLASS);
});

test('a look without a curtain wall is never glass', () => {
  for (const seed of [0, 0.1, 0.24, 0.5, 0.99]) {
    assert.equal(facadeCategory(office(34, 10, { look: punched }), seed), CAT.COMMERCIAL); // 24-45 m
    assert.equal(facadeCategory(office(60, 8, { look: punched }), seed), CAT.COMMERCIAL); // 45 m+, < 10 storeys
    assert.equal(facadeCategory({ usage: 403, storeys: 10, height: 34, look: punched }, seed), CAT.COMMERCIAL);
    // a tall tower that is not an office or shop, a photoless shell, OSM's glass: the look still decides
    assert.equal(facadeCategory({ usage: 412, storeys: 30, height: 100, look: punched }, seed, true), CAT.APARTMENT);
    assert.equal(facadeCategory({ usage: 421, storeys: 6, height: 24, hint: MATERIAL.GLASS << 24, look: punched }, seed), CAT.PUBLIC);
  }
});

test('a look with a curtain wall is glass, whatever its use', () => {
  assert.equal(facadeCategory(office(80, 18, { look: curtain }), 0.9), CAT.GLASS);
  assert.equal(facadeCategory({ usage: 402, storeys: 12, height: 50, look: curtain }, 0.9), CAT.GLASS);
});

// The mesh itself (aBldg: height, category, kind, bay width): a 34 m, 10-storey office (8 x 8 m) on the tiles where its seed makes the source call it glass.
test('buildingMesh: a punched look is meshed with its own bays, not a 1.5 m curtain grid', () => {
  const sq = Float32Array.from([0, 0, 8, 0, 8, -8, 0, -8]);
  const b = (look) => ({ ...office(34, 10), flags: 0, polygons: [[sq]], ...(look ? { look } : {}) });
  const cats = (m) => { const s = new Set(); for (let t = 0; t < m.aBldg.length / 12; t++) if (m.aBldg[t * 12 + 2] === KIND.WALL) s.add(m.aBldg[t * 12 + 1] % 8); return [...s]; };
  const bay = (m) => { let n = 0; for (let t = 0; t < m.aBldg.length / 12; t++) if (m.aBldg[t * 12 + 2] === KIND.WALL) n = Math.max(n, m.aBldg[t * 12 + 3]); return n; };
  let glassTiles = 0;
  for (let tx = 0; tx < 40; tx++) {
    const source = buildingMesh([b(null)], tx, 0);
    if (cats(source)[0] !== CAT.GLASS) continue;
    glassTiles++;
    const far = buildingMesh([b(punched)], tx, 0);
    assert.deepEqual(cats(far), [CAT.COMMERCIAL], `tile ${tx}`);
    assert.ok(bay(far) > 2.5 && bay(source) < 2, `tile ${tx}: a ${bay(far)} m bay, the curtain grid's ${bay(source)} m`); // 8 m: 3 bays, not 5
    assert.deepEqual(cats(buildingMesh([b(curtain)], tx, 0)), [CAT.GLASS]);
  }
  assert.ok(glassTiles > 0, 'some seed below 0.25 in 40 tiles');
});

test('buildingMesh: a look with a window module is meshed with its bay', () => {
  const sq = Float32Array.from([0, 0, 8, 0, 8, -8, 0, -8]);
  const bay = (m) => { let n = 0; for (let t = 0; t < m.aBldg.length / 12; t++) if (m.aBldg[t * 12 + 2] === KIND.WALL) n = Math.max(n, m.aBldg[t * 12 + 3]); return n; };
  const withBay = (b) => ({ ...office(34, 10), flags: 0, polygons: [[sq]], look: { ...punched, windows: { bay: b } } });
  assert.equal(bay(buildingMesh([withBay(1.7)], 0, 0)), Math.fround(8 / 5)); // 8 m: 5 bays of 1.6 m, an office's near module
  assert.equal(bay(buildingMesh([withBay(3.6)], 0, 0)), Math.fround(8 / 2));
  const tower = { ...withBay(1.7), look: { ...curtain, windows: { bay: 1.7 } } };
  assert.equal(bay(buildingMesh([tower], 0, 0)), Math.fround(8 / 5)); // (a curtain wall keeps its 1.5 m grid: 8 m is 5 of them too)
});

console.log(`${passed} passed`);
