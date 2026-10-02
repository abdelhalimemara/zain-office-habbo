import {
  centerIn,
  clampPan,
  clampScale,
  fitScale,
  lerpCamera,
  normalizeInsets,
  panFor,
  stepZoom,
  visibleArea,
  zoomAround,
} from "../../src/world/camera";

describe("camera", () => {
  const content = { x: -400, y: -50, w: 800, h: 450 };
  const full = (w: number, h: number) => ({ x: 0, y: 0, w, h });

  it("fills most of the visible area, preferring integer scales", () => {
    expect(fitScale(content, full(1400, 836), 1)).toBe(1.5);
    expect(fitScale(content, full(1400, 836), 2)).toBe(3);
    expect(fitScale(content, full(1000, 1000), 2)).toBe(2);
    expect(fitScale(content, full(300, 200), 1)).toBe(0.75);
  });

  it("shrinks below 1x to fit beside an open side panel on DPR-1 screens", () => {
    const s = fitScale(content, full(680, 836), 1);
    expect(s).toBeLessThan(1);
    expect(content.w * s).toBeLessThanOrEqual(680);
  });

  it("fills 75-90% of the limiting dimension at DPR 1", () => {
    for (const [w, h] of [[1400, 836], [1920, 1016], [1280, 656]] as const) {
      const s = fitScale(content, full(w, h), 1);
      const fill = Math.max((content.w * s) / w, (content.h * s) / h);
      expect(fill).toBeGreaterThan(0.75);
      expect(fill).toBeLessThanOrEqual(0.9);
    }
  });

  it("keeps art readable on phones and lets it overflow", () => {
    const s = fitScale(content, full(390, 780), 3);
    expect(s).toBe(2.25);
    expect((content.w * s) / 3).toBeGreaterThan(390);
  });

  it("steps through zoom levels and clamps", () => {
    expect(stepZoom(1.5, 1)).toBe(1.75);
    expect(stepZoom(1.6, -1)).toBe(1.5);
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(clampScale(0)).toBe(0.5);
    expect(clampScale(99)).toBe(8);
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const pan = { x: 100, y: 60 };
    const next = zoomAround(pan, 300, 200, 2, 4);
    expect(300 - pan.x).toBe(300 * (2 / 4) - next.x);
  });

  it("subtracts insets and centres inside what is left", () => {
    const area = visibleArea(1400, 900, normalizeInsets({ top: 64, right: 420 }));
    expect(area).toEqual({ x: 0, y: 64, w: 980, h: 836 });
    const pan = centerIn(content, area, 1, 1);
    expect(pan.x + content.x + content.w / 2).toBe(490);
    expect(pan.y + content.y + content.h / 2).toBe(64 + 418);
  });

  it("never lets insets swallow the whole viewport", () => {
    const area = visibleArea(390, 844, normalizeInsets({ top: 64, right: 420 }));
    expect(area.w).toBeGreaterThanOrEqual(240);
    expect(area.x + area.w).toBeLessThanOrEqual(390);
    expect(normalizeInsets({ top: -5, left: Number.NaN })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("keeps content inside the visible area when panning", () => {
    const area = visibleArea(700, 450, normalizeInsets({ top: 64 }));
    const p = clampPan({ x: 99999, y: -99999 }, content, area, 1, 1);
    expect(p.x + content.x).toBeLessThanOrEqual(700);
    expect(p.y + content.y + content.h).toBeGreaterThanOrEqual(64);
  });

  it("interpolates a refit without jumping", () => {
    const a = { scale: 1, world: { x: 0, y: 0 }, focus: { x: 700, y: 450 } };
    const b = { scale: 2, world: { x: 100, y: 50 }, focus: { x: 490, y: 482 } };
    expect(panFor(lerpCamera(a, b, 0), 1)).toEqual(panFor(a, 1));
    expect(panFor(lerpCamera(a, b, 1), 1)).toEqual(panFor(b, 1));
    expect(lerpCamera(a, b, 0.5).scale).toBeGreaterThan(1.5);
  });
});
