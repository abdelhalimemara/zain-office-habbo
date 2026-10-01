import { boxHull, compareBoxes, depthKey, dynamicDepth, pointInPolygon, sortDepth, toScreen, toTile, type Box } from "../../src/world/iso";

const box = (x0: number, y0: number, w: number, d: number, h = 10): Box => ({ x0, y0, x1: x0 + w, y1: y0 + d, h });

describe("iso math", () => {
  it("round-trips tile ↔ screen", () => {
    for (const [x, y] of [[0, 0], [3, 7], [12.5, 4.25], [-2, 9], [35, 35]] as const) {
      const s = toScreen(x, y);
      const t = toTile(s.x, s.y);
      expect(t.x).toBeCloseTo(x, 9);
      expect(t.y).toBeCloseTo(y, 9);
    }
  });

  it("uses a 2:1 dimetric projection", () => {
    expect(toScreen(1, 0)).toEqual({ x: 16, y: 8 });
    expect(toScreen(0, 1)).toEqual({ x: -16, y: 8 });
    expect(toScreen(1, 1, 5)).toEqual({ x: 0, y: 11 });
  });

  it("depth key increases toward the viewer", () => {
    expect(depthKey(2, 2)).toBeGreaterThan(depthKey(1, 2));
    expect(depthKey(2, 3)).toBeGreaterThan(depthKey(2, 2));
  });

  it("orders boxes back to front", () => {
    expect(compareBoxes(box(0, 0, 1, 1), box(1, 0, 1, 1))).toBe(-1);
    expect(compareBoxes(box(0, 1, 1, 1), box(0, 0, 1, 1))).toBe(1);
    expect(compareBoxes(box(0, 0, 1, 1), box(10, -10, 1, 1))).toBe(0);
  });

  it("sorts a big table behind a chair in front of it and ahead of one behind it", () => {
    const boxes = [box(4, 6, 1, 1), box(2, 3, 5, 2), box(4, 2, 1, 1)];
    const d = sortDepth(boxes);
    expect(d[2]!).toBeLessThan(d[1]!);
    expect(d[1]!).toBeLessThan(d[0]!);
    expect(new Set(d).size).toBe(3);
  });

  it("places a moving object between statics", () => {
    const statics = sortDepth([box(0, 0, 1, 1), box(0, 3, 1, 1)]).map((depth, i) => ({
      depth,
      box: [box(0, 0, 1, 1), box(0, 3, 1, 1)][i]!,
    }));
    const z = dynamicDepth(statics, box(0.2, 1.2, 0.6, 0.6, 28));
    expect(z).toBeGreaterThan(statics[0]!.depth);
    expect(z).toBeLessThan(statics[1]!.depth);
  });

  it("hit-tests the extruded hull", () => {
    const hull = boxHull(box(0, 0, 2, 2, 50));
    expect(pointInPolygon({ x: 0, y: 0 }, hull)).toBe(true);
    expect(pointInPolygon({ x: 0, y: -45 }, hull)).toBe(true);
    expect(pointInPolygon({ x: 100, y: 0 }, hull)).toBe(false);
  });
});
