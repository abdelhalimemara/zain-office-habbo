import { clampPan, clampScale, fitScale, zoomAround } from "../../src/world/camera";
import { seededRandom } from "../../src/world/hash";
import { floorLayout, roomAt } from "../../src/world/layouts";
import { findPath, loungeSpot, wanderTarget } from "../../src/world/pathing";
import { measureText, textRects, truncate } from "../../src/world/pixelFont";

describe("camera", () => {
  const content = { x: -400, y: -50, w: 800, h: 450 };

  it("fits with the largest integer device scale", () => {
    expect(fitScale(content, 1400, 900, 1)).toBe(1);
    expect(fitScale(content, 1400, 900, 2)).toBe(3);
    expect(fitScale(content, 300, 200, 2)).toBe(1);
  });

  it("clamps scale to integer levels", () => {
    expect(clampScale(0)).toBe(1);
    expect(clampScale(2.4)).toBe(2);
    expect(clampScale(99)).toBe(8);
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const pan = { x: 100, y: 60 };
    const next = zoomAround(pan, 300, 200, 2, 4);
    expect(300 - pan.x).toBe(300 * (2 / 4) - next.x);
  });

  it("never lets the content leave the viewport", () => {
    const p = clampPan({ x: 99999, y: -99999 }, content, 700, 450);
    expect(p.x + content.x).toBeLessThanOrEqual(700);
    expect(p.y + content.y + content.h).toBeGreaterThanOrEqual(0);
  });
});

describe("idle wandering", () => {
  it("picks deterministic targets inside the lounge", () => {
    const layout = floorLayout("studio");
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let i = 0; i < 20; i++) {
      const t = wanderTarget(layout, a)!;
      expect(wanderTarget(layout, b)).toEqual(t);
      expect(roomAt(layout, t.x, t.y)?.id).toBe("lounge");
    }
  });

  it("gives distinct resting spots and walkable routes around walls", () => {
    const layout = floorLayout("hq");
    const spots = Array.from({ length: 8 }, (_, i) => loungeSpot(layout, i)!);
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(8);
    const path = findPath(layout, { x: 4, y: 2 }, spots[0]!)!;
    for (let i = 1; i < path.length; i++) {
      expect(Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y)).toBe(1);
    }
  });
});

describe("pixel font", () => {
  it("measures and truncates", () => {
    expect(measureText("A")).toBe(3);
    expect(measureText("AB")).toBe(7);
    expect(measureText("M", 2)).toBe(10);
    expect(textRects("I").length).toBeGreaterThan(0);
    expect(measureText(truncate("Revenue-share growth partnerships", 60))).toBeLessThanOrEqual(60);
  });
});
