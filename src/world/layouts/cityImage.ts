import type { DivisionId } from "../../../shared/divisions";
import { pointInPolygon, type Pt, type Rect } from "../iso";
import { PAGE_BACKGROUND } from "../palette";

/** The rendered, car-free city diorama (src/world/assets/city.webp, transparent background), in image pixels. */
export const CITY_IMAGE = { width: 2000, height: 2000 } as const;

/** Canvas colour behind the transparent diorama: the shared warm-white page. */
export const CITY_BACKGROUND = PAGE_BACKGROUND;

/** Opaque-pixel bounds of the diorama (alpha > 8: x 27–1937, y 111–1832) plus a 10 px margin. */
export const CITY_CONTENT: Rect = { x: 17, y: 101, w: 1931, h: 1742 };

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
      [895, 185], [989, 215], [989, 114], [996, 114], [996, 218], [1137, 265], [1150, 305], [1166, 927],
      [1165, 1110], [1150, 1170], [1045, 1182], [955, 1172], [947, 1092], [872, 1100], [872, 300],
    ]),
    anchor: { x: 1140, y: 250 },
  },
  {
    division: "growth",
    short: "GROWTH",
    name: "ZAIN GROWTH",
    polygon: pts([
      [570, 760], [742, 826], [742, 1148], [567, 1138], [404, 1211], [398, 1268], [265, 1255], [262, 1125],
      [306, 1105], [308, 900], [400, 828],
    ]),
    anchor: { x: 570, y: 780 },
  },
  {
    division: "studio",
    short: "STUDIO",
    name: "ZAIN STUDIO",
    polygon: pts([[567, 1138], [781, 1221], [778, 1388], [590, 1467], [409, 1420], [404, 1211]]),
    anchor: { x: 592, y: 1175 },
  },
  {
    division: "tech",
    short: "TECH",
    name: "ZAIN TECH",
    polygon: pts([[1098, 1196], [1268, 1255], [1268, 1428], [1087, 1528], [947, 1492], [948, 1262]]),
    anchor: { x: 1105, y: 1225 },
  },
  {
    division: "labs",
    short: "LABS",
    name: "ZAIN LABS",
    polygon: pts([
      [1470, 796], [1582, 842], [1590, 875], [1686, 898], [1700, 945], [1736, 995], [1737, 1110], [1760, 1118],
      [1760, 1294], [1511, 1322], [1314, 1226], [1312, 938], [1355, 846],
    ]),
    anchor: { x: 1470, y: 815 },
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
export const HQ_SIGN = { x: 1028, y: 1073, w: 32, h: 34 } as const;

export function hotspotFor(division: DivisionId): CityHotspot {
  const h = CITY_HOTSPOTS.find((s) => s.division === division);
  if (!h) throw new Error(`No city hotspot for ${division}`);
  return h;
}

export function hotspotAt(x: number, y: number): DivisionId | null {
  for (const h of CITY_HOTSPOTS) if (pointInPolygon({ x, y }, h.polygon)) return h.division;
  return null;
}
