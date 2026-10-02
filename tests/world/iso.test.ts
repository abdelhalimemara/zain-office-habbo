import { pointInPolygon } from "../../src/world/iso";

describe("pointInPolygon", () => {
  const hull = [{ x: 0, y: -60 }, { x: 32, y: -40 }, { x: 32, y: 16 }, { x: 0, y: 32 }, { x: -32, y: 16 }, { x: -32, y: -40 }];

  it("hits points inside and misses points outside", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, hull)).toBe(true);
    expect(pointInPolygon({ x: 0, y: -45 }, hull)).toBe(true);
    expect(pointInPolygon({ x: 100, y: 0 }, hull)).toBe(false);
    expect(pointInPolygon({ x: 30, y: -58 }, hull)).toBe(false);
  });
});
