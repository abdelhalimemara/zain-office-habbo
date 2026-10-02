import { CONFLICT_ZONES, ROUTES, type ConflictZone, type RouteDef } from "./lanes";
import { Path, type PathSample } from "./path";

/** Distances in image pixels, times in seconds. */
export const TRAFFIC = {
  maxCars: 8,
  seedCars: 5,
  minSpeed: 52,
  maxSpeed: 78,
  accel: 38,
  decel: 110,
  /** Centre-to-centre distance a follower never closes below. */
  minGap: 64,
  /** Followers start easing off this far beyond minGap. */
  slowGap: 70,
  /** How far ahead a car looks for a leader. */
  lookahead: 150,
  /** A leader counts when its centre is within this distance of the follower's heading line. */
  laneTolerance: 16,
  crosswalkSpeed: 0.55,
  crosswalkReach: 40,
  fadeIn: 40,
  fadeOut: 55,
  /**
   * A car stops this far before a conflict zone it cannot claim, and frees it this far past the exit. It claims
   * a free zone only within half a minGap of that line, so a queued follower can never claim ahead of its leader.
   */
  zoneClear: 42,
  spawnClear: 80,
  spawnEvery: [1.1, 2.8] as const,
};

export interface Route {
  id: string;
  path: Path;
  crosswalks: readonly number[];
  zones: readonly { zone: number; enter: number; exit: number }[];
  weight: number;
}

export interface Car {
  active: boolean;
  route: number;
  s: number;
  v: number;
  cruise: number;
  sprite: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  alpha: number;
  /** Drawn flipped: heading down-right. */
  mirrored: boolean;
}

export function buildRoutes(defs: readonly RouteDef[] = ROUTES, zones: readonly ConflictZone[] = CONFLICT_ZONES): Route[] {
  return defs.map((def) => {
    const path = new Path(def.points);
    const probe: PathSample = { x: 0, y: 0, dx: 0, dy: 0 };
    const spans: { zone: number; enter: number; exit: number }[] = [];
    zones.forEach((z, zone) => {
      let enter = -1;
      let exit = -1;
      for (let s = 0; s <= path.length; s += 2) {
        path.sample(s, probe);
        if (Math.hypot(probe.x - z.x, probe.y - z.y) <= z.r) {
          if (enter < 0) enter = s;
          exit = s;
        }
      }
      if (enter >= 0) spans.push({ zone, enter, exit });
    });
    return {
      id: def.id,
      path,
      crosswalks: def.crosswalks.map((p) => path.project(p)),
      zones: spans,
      weight: def.weight,
    };
  });
}

/** Mirroring rule: only the down-left art exists, so anything heading right is flipped. */
export function mirroredFor(dx: number, previous: boolean): boolean {
  if (dx > 0.05) return true;
  if (dx < -0.05) return false;
  return previous;
}

/** Where along the cosine ramp around a crosswalk the speed factor sits. */
export function crosswalkFactor(s: number, crosswalks: readonly number[]): number {
  let f = 1;
  for (const c of crosswalks) {
    const d = Math.abs(s - c);
    if (d >= TRAFFIC.crosswalkReach) continue;
    const t = 0.5 + 0.5 * Math.cos((Math.PI * d) / TRAFFIC.crosswalkReach);
    f = Math.min(f, 1 - (1 - TRAFFIC.crosswalkSpeed) * t);
  }
  return f;
}

export function fadeAlpha(s: number, length: number): number {
  const a = Math.min(1, s / TRAFFIC.fadeIn, (length - s) / TRAFFIC.fadeOut);
  const t = Math.max(0, a);
  return t * t * (3 - 2 * t);
}

/** Car traffic over fixed routes: a pool of cars, spawning, following, crosswalks and one-at-a-time conflict zones. */
export class TrafficSim {
  readonly cars: Car[];
  readonly routes: readonly Route[];
  private readonly zoneOwner: Int32Array;
  private readonly sample: PathSample = { x: 0, y: 0, dx: 0, dy: 0 };
  private readonly totalWeight: number;
  private spawnIn = 0;

  constructor(
    routes: readonly Route[] = buildRoutes(),
    private readonly rng: () => number = Math.random,
    readonly spriteCount = 7,
    zoneCount = CONFLICT_ZONES.length,
  ) {
    this.routes = routes;
    this.zoneOwner = new Int32Array(zoneCount).fill(-1);
    this.totalWeight = routes.reduce((sum, r) => sum + r.weight, 0);
    this.cars = Array.from({ length: TRAFFIC.maxCars }, () => ({
      active: false, route: 0, s: 0, v: 0, cruise: 0, sprite: 0, x: 0, y: 0, dx: -1, dy: 0, alpha: 0, mirrored: false,
    }));
  }

  get activeCount(): number {
    let n = 0;
    for (const c of this.cars) if (c.active) n++;
    return n;
  }

  /** Scatters cars along the routes so the city starts busy rather than empty. */
  seed(count = TRAFFIC.seedCars): void {
    for (let tries = 0; tries < count * 12 && this.activeCount < count; tries++) {
      const route = this.pickRoute();
      const r = this.routes[route]!;
      const s = TRAFFIC.fadeIn + this.rng() * (r.path.length - TRAFFIC.fadeIn - TRAFFIC.fadeOut - 20);
      r.path.sample(s, this.sample);
      if (!this.clearAt(this.sample.x, this.sample.y, TRAFFIC.minGap + 30)) continue;
      if (r.zones.some((z) => s > z.enter - TRAFFIC.zoneClear - 40 && s < z.exit + TRAFFIC.zoneClear)) continue;
      this.spawn(route, s);
    }
    this.spawnIn = this.nextSpawnDelay();
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = this.nextSpawnDelay();
      if (this.activeCount < TRAFFIC.maxCars) {
        const route = this.pickRoute();
        const start = this.routes[route]!.path.start;
        if (this.clearAt(start.x, start.y, TRAFFIC.spawnClear)) this.spawn(route, 0);
      }
    }
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      if (car.active) this.step(i, car, dt);
    }
  }

  private step(i: number, car: Car, dt: number): void {
    const route = this.routes[car.route]!;
    let desired = car.cruise * crosswalkFactor(car.s, route.crosswalks);
    let limit = Number.POSITIVE_INFINITY;

    const gap = this.leaderGap(i, car);
    if (gap < TRAFFIC.lookahead) {
      const room = gap - TRAFFIC.minGap;
      desired = Math.min(desired, car.cruise * clamp01(room / TRAFFIC.slowGap));
      limit = Math.max(0, room);
    }

    for (const span of route.zones) {
      const stopLine = span.enter - TRAFFIC.zoneClear;
      const owner = this.zoneOwner[span.zone]!;
      if (owner === i) {
        if (car.s > span.exit + TRAFFIC.zoneClear) this.zoneOwner[span.zone] = -1;
        continue;
      }
      if (car.s > stopLine) continue;
      const toLine = stopLine - car.s;
      if (toLine > TRAFFIC.lookahead) continue;
      if (owner < 0 && toLine < TRAFFIC.minGap / 2) {
        this.zoneOwner[span.zone] = i;
        continue;
      }
      if (owner >= 0) {
        desired = Math.min(desired, car.cruise * clamp01(toLine / TRAFFIC.slowGap));
        limit = Math.min(limit, toLine);
      }
    }

    const dv = desired - car.v;
    car.v += dv > 0 ? Math.min(dv, TRAFFIC.accel * dt) : Math.max(dv, -TRAFFIC.decel * dt);
    if (car.v < 0) car.v = 0;
    const move = Math.min(car.v * dt, limit);
    if (move < car.v * dt) car.v = move / dt;
    car.s += move;

    if (car.s >= route.path.length) {
      this.despawn(i, car);
      return;
    }
    this.place(car);
  }

  /** Distance to the nearest car ahead in roughly the same direction, or Infinity. */
  private leaderGap(i: number, car: Car): number {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < this.cars.length; j++) {
      const o = this.cars[j]!;
      if (j === i || !o.active) continue;
      if (o.dx * car.dx + o.dy * car.dy < 0.5) continue;
      const rx = o.x - car.x;
      const ry = o.y - car.y;
      const fwd = rx * car.dx + ry * car.dy;
      if (fwd <= 0 || fwd >= best) continue;
      if (Math.abs(rx * car.dy - ry * car.dx) > TRAFFIC.laneTolerance) continue;
      best = fwd;
    }
    return best;
  }

  private place(car: Car): void {
    const route = this.routes[car.route]!;
    const p = route.path.sample(car.s, this.sample);
    car.x = p.x;
    car.y = p.y;
    car.dx = p.dx;
    car.dy = p.dy;
    car.mirrored = mirroredFor(p.dx, car.mirrored);
    car.alpha = fadeAlpha(car.s, route.path.length);
  }

  private spawn(route: number, s: number): void {
    const i = this.cars.findIndex((c) => !c.active);
    if (i < 0) return;
    const car = this.cars[i]!;
    car.active = true;
    car.route = route;
    car.s = s;
    car.cruise = TRAFFIC.minSpeed + this.rng() * (TRAFFIC.maxSpeed - TRAFFIC.minSpeed);
    car.v = car.cruise * 0.85;
    car.sprite = Math.floor(this.rng() * this.spriteCount) % this.spriteCount;
    car.mirrored = false;
    this.place(car);
  }

  private despawn(i: number, car: Car): void {
    car.active = false;
    car.alpha = 0;
    for (let z = 0; z < this.zoneOwner.length; z++) if (this.zoneOwner[z] === i) this.zoneOwner[z] = -1;
  }

  private clearAt(x: number, y: number, radius: number): boolean {
    for (const c of this.cars) if (c.active && Math.hypot(c.x - x, c.y - y) < radius) return false;
    return true;
  }

  private pickRoute(): number {
    let r = this.rng() * this.totalWeight;
    for (let i = 0; i < this.routes.length; i++) {
      r -= this.routes[i]!.weight;
      if (r < 0) return i;
    }
    return this.routes.length - 1;
  }

  private nextSpawnDelay(): number {
    const [lo, hi] = TRAFFIC.spawnEvery;
    return lo + this.rng() * (hi - lo);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
