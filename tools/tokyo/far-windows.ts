// The far level's windows in the near levels' module (to-glb.ts `windows`): a building's storeys split as the dress
// splits its walls, and an upper storey's windows in one bay drawn as scene/hero/dress.ts `dressMid` draws them (a
// ribbon across an office's floors, else the building's single / pair / triple / tall / wide module). So the window
// rows do not move and the bands do not change at the 480 m switch. A curtain wall as `curtainFloor` draws it: on each
// storey the spandrel band its own height over the slab, the vision glass above it up to the transom.
import type { BuildingLook } from "../../scene/hero/dress.ts";

/** What the far level needs of a building's look for its windows (`b.look.windows`, from looks.json). */
export type FarWindows = BuildingLook["windows"] & BuildingLook["floors"] & { ribbon: boolean; spandrelH?: number };

/** A building's window look; null when looks.json is older than its `floors`. A curtain wall has its spandrels' height. */
export function farWindows(l: BuildingLook): FarWindows | null {
  if (!l.floors || !l.windows.bay) return null;
  if (l.curtain) return { ...l.windows, ...l.floors, ribbon: false, spandrelH: l.curtain.spandrelH };
  // (an office's floors are always a ribbon, whatever the module drew: `dressMid`)
  return { ...l.windows, ...l.floors, ribbon: l.kind === "office" || l.windows.layout === "ribbon" };
}

/** A curtain wall's vision glass in one bay `bw` m wide on a storey, as `curtainFloor` (upper floors) and the lobby
 *  (the ground floor) draw it: [u0, u1, v0, v1]. A fin 6 cm wide between bays; on an upper floor the spandrel panel
 *  (`spandrelH`, at most 40 % of the storey) over the slab and a 4 cm transom under the next; the lobby's glass from the
 *  ground to 0.35 m under the first floor. */
export function curtainWindows(fw: FarWindows, row: number, bw: number): [number, number, number, number][] {
  const [fy, fh] = storey(fw, row), m = Math.min(0.2, 0.03 / bw);
  const [wy0, wy1] = row === 0 ? [fy, fy + fh - 0.35] : [fy + Math.min(fw.spandrelH ?? 0, fh * 0.4), fy + fh - 0.04];
  return wy1 - wy0 > 0.5 ? [[m, 1 - m, wy0, wy1]] : [];
}

/** The storey a height above the base is in (0: the ground floor). */
export function rowAt(fw: FarWindows, v: number): number {
  if (v < fw.ground || fw.storeys < 2 || fw.upper <= 0) return 0;
  return Math.min(fw.storeys - 1, 1 + Math.floor((v - fw.ground) / fw.upper));
}

/** A storey's bottom and height (m above the base). */
export function storey(fw: FarWindows, row: number): [number, number] {
  return row === 0 ? [0, fw.ground] : [fw.ground + (row - 1) * fw.upper, fw.upper];
}

/** An upper storey's windows in one bay `bw` m wide: [u0, u1, v0, v1], u across the bay (0..1), v in m above the base.
 *  (`dressMid`, the floors above: the same sizes and places.) */
export function upperWindows(fw: FarWindows, row: number, bw: number): [number, number, number, number][] {
  const [fy, fh] = storey(fw, row);
  if (fw.ribbon) {
    // a ribbon of glass across the floor, a mullion every bay
    const wy0 = fy + 0.85, wy1 = Math.min(fy + fh - 0.25, wy0 + fw.ribbonH), m = Math.min(0.2, 0.03 / bw);
    return wy1 - wy0 > 0.6 ? [[m, 1 - m, wy0, wy1]] : [];
  }
  const h = Math.max(0.8, Math.min(fh - 0.65, fh * fw.h)), tall = fw.layout === "tall";
  const wy0 = tall ? fy + 0.35 : fy + Math.max(0.55, (fh - h) * 0.55), wy1 = tall ? fy + fh - 0.35 : wy0 + (fw.layout === "wide" ? h * 0.75 : h);
  if (wy1 - wy0 <= 0.5) return [];
  const wc = bw / 2, usable = bw - 0.5;
  const spans: [number, number][] =
    fw.layout === "pair" ? [[wc - usable * fw.w * 0.5, wc - 0.12], [wc + 0.12, wc + usable * fw.w * 0.5]]
    : fw.layout === "triple" ? [-1, 0, 1].map((q) => [wc + q * usable * 0.31 - usable * 0.13, wc + q * usable * 0.31 + usable * 0.13] as [number, number])
    : tall ? [[wc - usable * 0.34, wc - usable * 0.08], [wc + usable * 0.08, wc + usable * 0.34]]
    : fw.layout === "wide" ? [[wc - usable * 0.42, wc + usable * 0.42]]
    : [[wc - (usable * fw.w) / 2, wc + (usable * fw.w) / 2]];
  return spans.filter(([a0, a1]) => a1 - a0 > 0.35).map(([a0, a1]) => [a0 / bw, a1 / bw, wy0, wy1]);
}
