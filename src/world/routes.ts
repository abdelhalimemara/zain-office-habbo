import type { Pt } from "./iso";
import type { FloorImage, FloorSpot } from "./layouts/floorImages";

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function adjacency(floor: FloorImage): Map<string, string[]> {
  const adj = new Map<string, string[]>(floor.waypoints.map((w) => [w.id, []]));
  for (const w of floor.waypoints) {
    for (const l of w.links) {
      if (!adj.has(l)) continue;
      adj.get(w.id)!.push(l);
      adj.get(l)!.push(w.id);
    }
  }
  return adj;
}

const adjCache = new WeakMap<FloorImage, Map<string, string[]>>();

/** Shortest chain of waypoint ids from `from` to `to` (inclusive), or null when they aren't connected. */
export function waypointPath(floor: FloorImage, from: string, to: string): string[] | null {
  let adj = adjCache.get(floor);
  if (!adj) {
    adj = adjacency(floor);
    adjCache.set(floor, adj);
  }
  if (!adj.has(from) || !adj.has(to)) return null;
  const byId = new Map(floor.waypoints.map((w) => [w.id, w]));
  const best = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size > 0) {
    let cur = "";
    let curD = Number.POSITIVE_INFINITY;
    for (const id of open) if (best.get(id)! < curD) [cur, curD] = [id, best.get(id)!];
    open.delete(cur);
    if (cur === to) break;
    for (const n of adj.get(cur)!) {
      const d = curD + dist(byId.get(cur)!, byId.get(n)!);
      if (d < (best.get(n) ?? Number.POSITIVE_INFINITY)) {
        best.set(n, d);
        prev.set(n, cur);
        open.add(n);
      }
    }
  }
  if (!best.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return path;
}

/** Points to walk from a spot (or a loose point near `fromVia`) to `to`, ending exactly on `to`. */
export function route(floor: FloorImage, from: Pt, fromVia: string, to: FloorSpot): Pt[] {
  if (fromVia === to.via) return [{ x: to.x, y: to.y }];
  const chain = waypointPath(floor, fromVia, to.via);
  const byId = new Map(floor.waypoints.map((w) => [w.id, w]));
  const points: Pt[] = (chain ?? [fromVia, to.via]).map((id) => byId.get(id)).filter((w): w is NonNullable<typeof w> => !!w);
  const out = points.map((w) => ({ x: w.x, y: w.y }));
  out.push({ x: to.x, y: to.y });
  return out.filter((p, i) => i > 0 || dist(p, from) > 1);
}

/** Total length of a walk, for timing tests. */
export function pathLength(start: Pt, points: readonly Pt[]): number {
  let d = 0;
  let cur = start;
  for (const p of points) {
    d += dist(cur, p);
    cur = p;
  }
  return d;
}

/** Deterministic idle spot for the n-th idle agent, spread across the floor's idle spots. */
export function restingSpot(floor: FloorImage, n: number): FloorSpot | null {
  if (floor.idle.length === 0) return null;
  return floor.idle[(n * 3) % floor.idle.length]!;
}

/** Next idle spot to stroll to, different from the current one when possible. */
export function nextIdleSpot(floor: FloorImage, rand: () => number, current?: string): FloorSpot | null {
  const options = floor.idle.filter((s) => s.id !== current);
  const pool = options.length > 0 ? options : floor.idle;
  if (pool.length === 0) return null;
  return pool[Math.floor(rand() * pool.length) % pool.length]!;
}

/** Small deterministic offset so people sharing an idle spot don't stand on top of each other. */
export function crowdOffset(seed: number, personHeight: number): Pt {
  const a = ((seed % 360) * Math.PI) / 180;
  const r = personHeight * (0.12 + ((seed >>> 9) % 10) / 40);
  return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r * 0.45) };
}
