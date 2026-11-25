// The room id's clock and the sun it gives (scene/clock.ts), without the city's data.
//   node scene/clock.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evAt, sunAt } from "../engine/games/tokyo/tokyo-tod.game.ts";
import { CLOCK_DAY, SHINJUKU, clockSun, parseClock } from "./clock.ts";

const DAY = { elevation: 38, ev: 11.5 };
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("the room id's clock", () => {
  assert.equal(parseClock("tokyo-day"), null);
  assert.equal(parseClock("tokyo-day-whole-at=371.5,32.3,-491.8"), null);
  assert.equal(parseClock("tokyo-day-clock=15:30"), 15.5);
  assert.equal(parseClock("tokyo-day-clock=9:45-whole-at=1,2,3"), 9.75);
  assert.equal(parseClock("tokyo-day-at=1,2-clock=16:00-look=10,0"), 16);
  assert.equal(parseClock("tokyo-day-clock=25:00"), null);
});

test("the date is street-ref.ts's: 2026-11-09, day 313", () => assert.equal(CLOCK_DAY, 313));

test("15:30 is the engine's sun over Shinjuku: low in the south-west", () => {
  const s = clockSun(15.5, DAY), e = sunAt(15.5, SHINJUKU.lat, SHINJUKU.lon, 313);
  assert.equal(s.elevation, e.elevation);
  assert.equal(s.azimuth, e.azimuth);
  // the sun street-ref.ts ranks its stretches for (elevation 12.0, azimuth 300.8: compass bearing 239.2)
  near(s.elevation, 12.0, 0.1, "elevation");
  near(s.azimuth, 300.8, 0.1, "azimuth");
});

test("the sun goes down through the afternoon, westwards", () => {
  let last = clockSun(13, DAY);
  for (const h of [14, 15, 15.5, 16]) {
    const s = clockSun(h, DAY);
    assert.ok(s.elevation < last.elevation, `${h}: lower than an hour before`);
    // setSunAngles' azimuth runs from the south (+z) towards the east (+x): the west is 270, so the compass bearing
    // (180 - azimuth, mod 360) grows from south towards west
    assert.ok(((540 - s.azimuth) % 360) > ((540 - last.azimuth) % 360), `${h}: further west`);
    last = s;
  }
  assert.ok(clockSun(16.75, DAY).elevation < 0, "set by 16:45");
});

test("the exposure: the engine's curve, anchored at the day preset", () => {
  for (const h of [10, 12, 14, 15.5, 16.5]) {
    const s = clockSun(h, DAY);
    near(s.ev, DAY.ev + evAt(s.elevation) - evAt(DAY.elevation), 1e-12, `${h}`);
  }
  // where the day preset's sun stands it is the day preset's EV, and at dusk's 3 degrees close to dusk's 8.5
  near(DAY.ev + evAt(38) - evAt(DAY.elevation), 11.5, 1e-12, "day");
  near(DAY.ev + evAt(3) - evAt(DAY.elevation), 8.5, 0.15, "dusk");
  // 15:30: a little more exposure than the high sun's
  const s = clockSun(15.5, DAY);
  assert.ok(s.ev < DAY.ev && s.ev > 10, `15:30 EV ${s.ev}`);
});
