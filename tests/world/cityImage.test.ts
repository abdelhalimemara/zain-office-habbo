import { DIVISION_IDS } from "../../shared/divisions";
import { worldBackground } from "../../src/world/background";
import { centerIn, fitSmooth, stepSmooth, visibleArea, normalizeInsets } from "../../src/world/camera";
import { pointInPolygon } from "../../src/world/iso";
import {
  CITY_BACKGROUND,
  CITY_BUILDINGS_BOUNDS,
  CITY_CONTENT,
  CITY_HOTSPOTS,
  CITY_IMAGE,
  HQ_SIGN,
  cityFitBounds,
  hotspotAt,
  hotspotFor,
} from "../../src/world/layouts/cityImage";

describe("city image hotspots", () => {
  it("maps every division to exactly one building", () => {
    expect(CITY_HOTSPOTS.map((h) => h.division).sort()).toEqual([...DIVISION_IDS].sort());
    expect(hotspotFor("hq").name).toBe("ZAIN GROUP");
    expect(hotspotFor("studio").name).toBe("ZAIN STUDIO");
  });

  it.each([
    ["hq", 1030, 400],
    ["hq", 1010, 60],
    ["growth", 640, 700],
    ["growth", 500, 850],
    ["studio", 700, 930],
    ["tech", 1100, 980],
    ["labs", 1420, 780],
    ["labs", 1560, 760],
  ] as const)("hits %s at (%i, %i)", (division, x, y) => {
    expect(hotspotAt(x, y)).toBe(division);
  });

  it.each([
    ["tree left of the tower", 840, 727],
    ["tree right of the tower", 1208, 758],
    ["road between studio and tech", 880, 880],
    ["road right of tech", 1250, 1000],
    ["front street", 600, 1100],
    ["road in front of tech", 1180, 1100],
    ["sky beside the tower", 1200, 300],
    ["margin", 100, 100],
  ] as const)("misses the %s", (_name, x, y) => {
    expect(hotspotAt(x, y)).toBeNull();
  });

  it("keeps every polygon inside the image and the content bounds", () => {
    const c = CITY_CONTENT;
    expect(c.x >= 0 && c.y >= 0 && c.x + c.w <= CITY_IMAGE.width && c.y + c.h <= CITY_IMAGE.height).toBe(true);
    for (const h of CITY_HOTSPOTS) {
      expect(h.polygon.length).toBeGreaterThanOrEqual(4);
      for (const p of [...h.polygon, h.anchor]) {
        expect(p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h, `${h.division} ${p.x},${p.y}`).toBe(true);
      }
    }
  });

  it("has no overlapping polygons", () => {
    for (let y = 0; y < CITY_IMAGE.height; y += 3) {
      for (let x = 0; x < CITY_IMAGE.width; x += 3) {
        const hits = CITY_HOTSPOTS.filter((h) => pointInPolygon({ x: x + 0.5, y: y + 0.5 }, h.polygon));
        if (hits.length > 1) throw new Error(`${hits.map((h) => h.division).join("+")} overlap at ${x},${y}`);
      }
    }
  });

  it("places the Zain plate over the tower's sign, inside the tower", () => {
    expect(hotspotAt(HQ_SIGN.x, HQ_SIGN.y)).toBe("hq");
    expect(HQ_SIGN.w).toBeGreaterThan(20);
  });
});

describe("city fit", () => {
  it("fills the visible area with the diorama, not the image margins", () => {
    const area = visibleArea(1400, 900, normalizeInsets({ top: 64 }));
    const s = fitSmooth(CITY_CONTENT, area, 1);
    const fill = Math.max((CITY_CONTENT.w * s) / area.w, (CITY_CONTENT.h * s) / area.h);
    expect(fill).toBeCloseTo(0.95, 2);
    const narrow = visibleArea(1400, 900, normalizeInsets({ top: 64, right: 720 }));
    const whole = { x: 0, y: 0, w: CITY_IMAGE.width, h: CITY_IMAGE.height };
    expect(fitSmooth(CITY_CONTENT, narrow, 1)).toBeGreaterThan(fitSmooth(whole, narrow, 1) * 1.25);
    expect(fitSmooth(CITY_CONTENT, area, 2)).toBeCloseTo(s * 2, 6);
  });

  it("centres the content in the area below the HUD and beside a panel", () => {
    const area = visibleArea(1400, 900, normalizeInsets({ top: 64, right: 720 }));
    const s = fitSmooth(CITY_CONTENT, area, 1);
    const pan = centerIn(CITY_CONTENT, area, s, 1);
    const cx = (pan.x + CITY_CONTENT.x + CITY_CONTENT.w / 2) * s;
    const cy = (pan.y + CITY_CONTENT.y + CITY_CONTENT.h / 2) * s;
    expect(cx).toBeCloseTo(area.x + area.w / 2, 6);
    expect(cy).toBeCloseTo(area.y + area.h / 2, 6);
  });

  it("fits phones to the buildings so they stay readable", () => {
    const b = CITY_BUILDINGS_BOUNDS;
    expect(cityFitBounds({ w: 390 })).toBe(b);
    expect(cityFitBounds({ w: 1400 })).toBe(CITY_CONTENT);
    for (const h of CITY_HOTSPOTS) for (const p of h.polygon) expect(p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h).toBe(true);
    expect(b.w).toBeLessThan(CITY_CONTENT.w * 0.85);
  });

  it("zooms smoothly within limits", () => {
    expect(stepSmooth(1, 1, 1, 1)).toBeCloseTo(1.25);
    expect(stepSmooth(0.5, -1, 1, 1)).toBe(0.5);
    expect(stepSmooth(3, 1, 1, 1)).toBe(3);
  });

  it("paints the image's own background behind the city and navy behind floors", () => {
    expect(CITY_BACKGROUND).toBe(0xf7f7f7);
    expect(worldBackground({ kind: "city" })).toBe("#F7F7F7");
    expect(worldBackground({ kind: "floor", division: "labs" })).toBe("#13294B");
  });
});
