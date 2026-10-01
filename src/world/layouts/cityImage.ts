import type { DivisionId } from "../../../shared/divisions";
import { pointInPolygon, type Pt, type Rect } from "../iso";

/** The rendered city diorama (src/world/assets/city.webp), in image pixels. */
export const CITY_IMAGE = { width: 2048, height: 1360 } as const;

/** Sampled from the image's flat margins; the canvas uses it so the picture has no visible edge. */
export const CITY_BACKGROUND = 0xf7f7f7;

/** Tight bounds of the diorama (soil slab to antenna tip) with a little breathing room. */
export const CITY_CONTENT: Rect = { x: 255, y: 16, w: 1540, h: 1338 };

export interface CityHotspot {
  division: DivisionId;
  name: string;
  /** Compact label for small screens. */
  short: string;
  /** Visible silhouette: roof plus the two facades facing the viewer. */
  polygon: readonly Pt[];
  /** Where the name label and live badge hang (top of the roof). */
  anchor: Pt;
}

const pts = (coords: readonly (readonly [number, number])[]): Pt[] => coords.map(([x, y]) => ({ x, y }));

export const CITY_HOTSPOTS: readonly CityHotspot[] = [
  {
    division: "hq",
    short: "HQ",
    name: "ZAIN GROUP",
    polygon: pts([
      [940, 80], [1006, 101], [1006, 24], [1015, 24], [1015, 104], [1120, 140], [1133, 172], [1137, 770],
      [1052, 822], [977, 808], [921, 782], [919, 172],
    ]),
    anchor: { x: 1130, y: 128 },
  },
  {
    division: "growth",
    short: "GROWTH",
    name: "ZAIN GROWTH",
    polygon: pts([
      [685, 524], [815, 577], [817, 805], [690, 806], [559, 860], [548, 905], [470, 885], [456, 800],
      [492, 775], [492, 625], [557, 575],
    ]),
    anchor: { x: 680, y: 540 },
  },
  {
    division: "studio",
    short: "STUDIO",
    name: "ZAIN STUDIO",
    polygon: pts([[690, 806], [846, 862], [843, 995], [706, 1062], [568, 1005], [559, 860]]),
    anchor: { x: 703, y: 845 },
  },
  {
    division: "tech",
    short: "TECH",
    name: "ZAIN TECH",
    polygon: pts([[1100, 846], [1221, 905], [1219, 1024], [1096, 1096], [973, 1034], [972, 893]]),
    anchor: { x: 1097, y: 880 },
  },
  {
    division: "labs",
    short: "LABS",
    name: "ZAIN LABS",
    polygon: pts([
      [1375, 566], [1465, 590], [1466, 617], [1505, 625], [1542, 642], [1543, 677], [1570, 690], [1571, 718],
      [1586, 725], [1586, 800], [1601, 803], [1602, 925], [1418, 960], [1292, 920], [1263, 660], [1298, 602],
    ]),
    anchor: { x: 1380, y: 580 },
  },
];

/** Union of the building silhouettes plus a margin: what phones fit to, so the buildings stay readable. */
export const CITY_BUILDINGS_BOUNDS: Rect = (() => {
  const all = CITY_HOTSPOTS.flatMap((h) => h.polygon);
  const m = 40;
  const x0 = Math.min(...all.map((p) => p.x)) - m;
  const y0 = Math.min(...all.map((p) => p.y)) - m;
  const x1 = Math.max(...all.map((p) => p.x)) + m;
  const y1 = Math.max(...all.map((p) => p.y)) + m;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();

/** Viewports narrower than this (css px) fit the buildings rather than the whole slab. */
export const NARROW_CITY = 640;

export function cityFitBounds(area: { w: number }): Rect {
  return area.w < NARROW_CITY ? CITY_BUILDINGS_BOUNDS : CITY_CONTENT;
}

/** The tower's "A" sign, covered by the Zain Group plate. */
export const HQ_SIGN = { x: 1037, y: 752, w: 30, h: 32 } as const;

export function hotspotFor(division: DivisionId): CityHotspot {
  const h = CITY_HOTSPOTS.find((s) => s.division === division);
  if (!h) throw new Error(`No city hotspot for ${division}`);
  return h;
}

export function hotspotAt(x: number, y: number): DivisionId | null {
  for (const h of CITY_HOTSPOTS) if (pointInPolygon({ x, y }, h.polygon)) return h.division;
  return null;
}
