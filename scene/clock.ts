// A clock for the day preset (ROADMAP 6h's street-ref is judged in late-afternoon sun): the room id's "-clock=HH:MM"
// puts the sun where it stands over Shinjuku at that time (JST) on 2026-11-09, the date tools/tokyo/street-ref.ts ranks
// its stretches for. The sun's position is the engine's own (`sunAt`, engine/games/tokyo/tokyo-tod.game.ts: NOAA's
// approximations); the exposure follows the engine's exposure curve for the time of day (`evAt`), shifted to agree with
// the day preset where the day preset's sun stands (it then gives 8.6 at dusk's 3 degrees, against dusk's 8.5). With no
// "-clock" in the room id nothing here is used.
import { evAt, sunAt } from "../engine/games/tokyo/tokyo-tod.game.ts";

/** Shinjuku's compiled area's origin (its tiles' manifest), where the sun is computed. */
export const SHINJUKU = { lat: 35.6896, lon: 139.7005 };
/** The date: 2026-11-09 (day 313 of the year), street-ref.ts's default. */
export const CLOCK_DATE = "2026-11-09";
const [y, m, d] = CLOCK_DATE.split("-").map(Number);
export const CLOCK_DAY = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;

/** The room id's clock ("-clock=15:30", JST) in hours, or null. */
export function parseClock(room: string): number | null {
  const c = /-clock=(\d{1,2}):(\d{2})/.exec(room);
  if (!c) return null;
  const hour = Number(c[1]) + Number(c[2]) / 60;
  return hour >= 0 && hour < 24 ? hour : null;
}

/** The sun and exposure at `hour` (JST): elevation, azimuth as `setSunAngles` takes it (degrees), EV100; the exposure
 *  anchored at `day` (the day preset: its sun elevation and EV). */
export function clockSun(hour: number, day: { elevation: number; ev: number }): { elevation: number; azimuth: number; ev: number } {
  const s = sunAt(hour, SHINJUKU.lat, SHINJUKU.lon, CLOCK_DAY);
  return { elevation: s.elevation, azimuth: s.azimuth, ev: day.ev + evAt(s.elevation) - evAt(day.elevation) };
}
