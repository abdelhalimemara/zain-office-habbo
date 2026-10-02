import { pointInPolygon, type Pt } from "../../src/world/iso";
import { CITY_CONTENT, hotspotFor } from "../../src/world/layouts/cityImage";
import { CONFLICT_ZONES, ROUTES } from "../../src/world/traffic/lanes";
import { OCCLUDERS } from "../../src/world/traffic/occluders";
import { Path, curve } from "../../src/world/traffic/path";
import { TRAFFIC, TrafficSim, buildRoutes, crosswalkFactor, fadeAlpha, mirroredFor, type Car } from "../../src/world/traffic/sim";

/** Top face of the diorama slab (opaque, from the image alpha), with a few px of slack for the traced corners. */
const SLAB_TOP: Pt[] = [
  { x: 24, y: 1316 },
  { x: 1000, y: 1724 },
  { x: 1942, y: 1278 },
  { x: 966, y: 856 },
];

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function run(sim: TrafficSim, seconds: number, each: (sim: TrafficSim) => void): void {
  for (let f = 0; f < seconds * 60; f++) {
    sim.update(1 / 60);
    each(sim);
  }
}

/** b sits on a's lane: within a few px of a's route. */
function onLaneOf(sim: TrafficSim, a: Car, b: Car): boolean {
  const path = sim.routes[a.route]!.path;
  const p = path.sample(path.project(b), { x: 0, y: 0, dx: 0, dy: 0 });
  return Math.hypot(p.x - b.x, p.y - b.y) < 6;
}

describe("traffic lanes", () => {
  it.each(ROUTES.map((r) => [r.id, r] as const))("%s stays on the slab", (_id, route) => {
    for (const p of route.points) expect(pointInPolygon(p, SLAB_TOP), `${p.x},${p.y}`).toBe(true);
  });

  it.each(ROUTES.map((r) => [r.id, r] as const))("%s only heads towards the viewer", (_id, route) => {
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!;
      const b = route.points[i]!;
      expect(b.y - a.y, `segment ${i}`).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
    }
  });

  it("routes are long enough to fade in, drive and fade out", () => {
    for (const r of buildRoutes()) expect(r.path.length).toBeGreaterThan((TRAFFIC.fadeIn + TRAFFIC.fadeOut) * 4);
  });

  it("maps crosswalks onto their routes", () => {
    for (const r of buildRoutes()) {
      for (const s of r.crosswalks) {
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(r.path.length);
      }
    }
  });

  it("every conflict zone is shared by at least two routes", () => {
    const routes = buildRoutes();
    CONFLICT_ZONES.forEach((_z, zone) => {
      expect(routes.filter((r) => r.zones.some((s) => s.zone === zone)).length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("occluders", () => {
  it("are inside the image content bounds", () => {
    for (const poly of OCCLUDERS) {
      expect(poly.length).toBeGreaterThanOrEqual(3);
      for (const p of poly) {
        expect(p.x).toBeGreaterThanOrEqual(CITY_CONTENT.x);
        expect(p.x).toBeLessThanOrEqual(CITY_CONTENT.x + CITY_CONTENT.w);
        expect(p.y).toBeGreaterThanOrEqual(CITY_CONTENT.y);
        expect(p.y).toBeLessThanOrEqual(CITY_CONTENT.y + CITY_CONTENT.h);
      }
    }
  });

  it("hide the crossing behind Tech and the inner-road spawns", () => {
    const hidden = (p: Pt) => OCCLUDERS.some((poly) => pointInPolygon(p, poly));
    expect(hidden(CONFLICT_ZONES[0]!)).toBe(true);
    expect(pointInPolygon(CONFLICT_ZONES[0]!, hotspotFor("tech").polygon)).toBe(true);
    for (const id of ["inner-1", "inner-2"]) expect(hidden(ROUTES.find((r) => r.id === id)!.points[0]!)).toBe(true);
  });

  it("never cover the open edge roads", () => {
    const hidden = (p: Pt) => OCCLUDERS.some((poly) => pointInPolygon(p, poly));
    for (const id of ["c-far", "c-near", "a"]) {
      const path = new Path(ROUTES.find((r) => r.id === id)!.points);
      const out = { x: 0, y: 0, dx: 0, dy: 0 };
      for (let s = 0; s <= path.length; s += 5) {
        path.sample(s, out);
        expect(hidden({ x: out.x, y: out.y - 25 }), `${id} at ${s}`).toBe(false);
      }
    }
  });
});

describe("path", () => {
  it("samples by arc length with a unit heading", () => {
    const p = new Path([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 100 }]);
    expect(p.length).toBe(110);
    const out = p.sample(25, { x: 0, y: 0, dx: 0, dy: 0 });
    expect(out.x).toBeCloseTo(15);
    expect(out.y).toBeCloseTo(20);
    expect(Math.hypot(out.dx, out.dy)).toBeCloseTo(1);
    expect(p.sample(80, out).x).toBeCloseTo(30);
    expect(p.project({ x: 40, y: 70 })).toBeCloseTo(80);
  });

  it("curves end on the target point", () => {
    const pts = curve({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 });
    expect(pts.at(-1)).toEqual({ x: 10, y: 10 });
  });
});

describe("traffic behaviour", () => {
  it("mirrors cars heading right and keeps the art for cars heading left", () => {
    expect(mirroredFor(0.9, false)).toBe(true);
    expect(mirroredFor(-0.9, true)).toBe(false);
    expect(mirroredFor(0.01, true)).toBe(true);
    expect(mirroredFor(-0.01, false)).toBe(false);
  });

  it("slows at crosswalks and eases back", () => {
    expect(crosswalkFactor(100, [100])).toBeCloseTo(TRAFFIC.crosswalkSpeed);
    expect(crosswalkFactor(100 + TRAFFIC.crosswalkReach / 2, [100])).toBeGreaterThan(TRAFFIC.crosswalkSpeed);
    expect(crosswalkFactor(100 + TRAFFIC.crosswalkReach, [100])).toBe(1);
  });

  it("fades in at the far end and out at the near end", () => {
    expect(fadeAlpha(0, 500)).toBe(0);
    expect(fadeAlpha(250, 500)).toBe(1);
    expect(fadeAlpha(500, 500)).toBe(0);
    expect(fadeAlpha(10, 500)).toBeGreaterThan(0);
  });

  it("spawns at route starts and despawns at route ends", () => {
    const sim = new TrafficSim(buildRoutes(), seeded(3));
    const starts = sim.routes.map((r) => r.path.start);
    let spawned = 0;
    let despawned = 0;
    let was = sim.cars.map((c) => c.active);
    run(sim, 120, (s) => {
      s.cars.forEach((c, i) => {
        if (c.active && !was[i]) {
          spawned++;
          expect(starts.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 20)).toBe(true);
          expect(c.alpha).toBeLessThan(0.2);
        }
        if (!c.active && was[i]) despawned++;
      });
      was = s.cars.map((c) => c.active);
    });
    expect(spawned).toBeGreaterThan(20);
    expect(despawned).toBeGreaterThan(10);
  });

  it("keeps about five to eight cars on the roads", () => {
    const sim = new TrafficSim(buildRoutes(), seeded(11));
    sim.seed();
    expect(sim.activeCount).toBe(TRAFFIC.seedCars);
    const counts: number[] = [];
    run(sim, 300, (s) => counts.push(s.activeCount));
    expect(Math.max(...counts)).toBeLessThanOrEqual(TRAFFIC.maxCars);
    const late = counts.slice(60 * 30);
    expect(late.reduce((a, b) => a + b, 0) / late.length).toBeGreaterThanOrEqual(5);
  });

  it.each([1, 7, 42])("never lets cars in one lane overlap (seed %i)", (seed) => {
    const sim = new TrafficSim(buildRoutes(), seeded(seed));
    sim.seed();
    let closest = Number.POSITIVE_INFINITY;
    run(sim, 400, (s) => {
      const cars = s.cars.filter((c) => c.active);
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          if (!onLaneOf(s, cars[i]!, cars[j]!) || !onLaneOf(s, cars[j]!, cars[i]!)) continue;
          closest = Math.min(closest, Math.hypot(cars[i]!.x - cars[j]!.x, cars[i]!.y - cars[j]!.y));
        }
      }
    });
    expect(closest).toBeGreaterThan(TRAFFIC.minGap * 0.8);
  });

  it("lets one car at a time through each crossing and merge", () => {
    const sim = new TrafficSim(buildRoutes(), seeded(5));
    sim.seed();
    run(sim, 400, (s) => {
      for (const z of CONFLICT_ZONES) {
        const inside = s.cars.filter((c) => c.active && Math.hypot(c.x - z.x, c.y - z.y) < z.r * 0.6);
        expect(inside.length).toBeLessThanOrEqual(1);
      }
    });
  });

  it("draws every car facing its direction of travel", () => {
    const sim = new TrafficSim(buildRoutes(), seeded(9));
    sim.seed();
    run(sim, 120, (s) => {
      for (const c of s.cars) {
        if (!c.active) continue;
        expect(c.dy).toBeGreaterThanOrEqual(0);
        if (c.dx > 0.05) expect(c.mirrored).toBe(true);
        if (c.dx < -0.05) expect(c.mirrored).toBe(false);
      }
    });
  });

  it("keeps moving: no car waits forever", () => {
    const sim = new TrafficSim(buildRoutes(), seeded(21));
    sim.seed();
    const still = new Array<number>(sim.cars.length).fill(0);
    let longest = 0;
    run(sim, 400, (s) => {
      s.cars.forEach((c, i) => {
        still[i] = c.active && c.v < 1 ? still[i]! + 1 : 0;
        longest = Math.max(longest, still[i]!);
      });
    });
    expect(longest / 60).toBeLessThan(8);
  });

  it("does nothing for a zero or negative step", () => {
    const sim = new TrafficSim(buildRoutes(), seeded(2));
    sim.seed();
    const before = sim.cars.map((c) => c.s);
    sim.update(0);
    sim.update(-1);
    expect(sim.cars.map((c) => c.s)).toEqual(before);
  });
});
