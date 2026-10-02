import { prefersMirror } from "./characters";
import { hashString, seededRandom } from "./hash";
import { toScreen, type Pt } from "./iso";
import { findPath, standPoint, tileCenter } from "./plan/grid";
import type { FloorPlan, PlanSeat, Spot } from "./plan";
import type { WorldAgent } from "./types";

export type PersonMode = "seated" | "standing" | "walking";

export interface PersonPose {
  /** Feet position in tile space. */
  tx: number;
  ty: number;
  /** Feet position in scene pixels. */
  x: number;
  y: number;
  /** Mirror the sprite (faces down-right instead of down-left). */
  mirror: boolean;
  /** Vertical offset in tiles of height (typing bob or step bounce); always 0 with reduced motion. */
  bob: number;
  mode: PersonMode;
}

const TILES_PER_SECOND = 1.8;
const REST_MS: [number, number] = [4000, 9000];

/** Desk agents stay at their seat unless idle; the board never leaves the board room; vacant seats stay put. */
export function wantsSeat(agent: WorldAgent, seat: PlanSeat | null): boolean {
  if (!seat) return false;
  return !agent.hired || agent.activity !== "idle" || agent.rank === "board";
}

/** Deterministic idle spot for the n-th person, spread across the floor's idle spots. */
export function restingSpot(plan: FloorPlan, n: number): Spot | null {
  if (plan.idle.length === 0) return null;
  return plan.idle[(n * 3) % plan.idle.length]!;
}

function nextIdleSpot(plan: FloorPlan, rand: () => number, current?: string): Spot | null {
  const options = plan.idle.filter((s) => s.id !== current);
  if (options.length === 0) return plan.idle[0] ?? null;
  return options[Math.floor(rand() * options.length) % options.length]!;
}

/**
 * Movement and pose for one person on a floor plan. Pure (no rendering): the scene reads `pose` every frame.
 * Walks follow A* tile paths, so nobody crosses furniture or walls.
 */
export class PersonBrain {
  private pos: Pt = { x: 0, y: 0 };
  private path: Pt[] = [];
  private mode: PersonMode = "standing";
  private placed = false;
  private seat: PlanSeat | null = null;
  private rest: Spot | null = null;
  private spotId: string | undefined;
  private atSeat = false;
  private waitMs = 0;
  private stride = 0;
  private walkMirror = false;
  private readonly rand: () => number;
  private readonly seed: number;

  constructor(
    private readonly plan: FloorPlan,
    private agent: WorldAgent,
    private reducedMotion: boolean,
  ) {
    this.seed = hashString(agent.profile);
    this.rand = seededRandom(this.seed);
  }

  get profile(): string {
    return this.agent.profile;
  }

  setAgent(agent: WorldAgent): void {
    const moved = wantsSeat(agent, this.seat) !== wantsSeat(this.agent, this.seat);
    this.agent = agent;
    if (moved) this.retarget();
  }

  assign(seat: PlanSeat | null, rest: Spot | null): void {
    const changed = seat?.id !== this.seat?.id || rest?.id !== this.rest?.id;
    this.seat = seat;
    this.rest = rest;
    if (changed || !this.placed) this.retarget();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced && this.mode === "walking") this.arrive(this.path[this.path.length - 1] ?? this.pos);
  }

  private retarget(): void {
    if (wantsSeat(this.agent, this.seat) && this.seat) this.walkTo(this.seat, standPoint(this.seat), true);
    else if (this.rest) this.walkTo(this.rest, this.restPoint(this.rest), false);
  }

  /** Idle spot centre nudged per person so a small group doesn't stand on one point. */
  private restPoint(spot: Pt): Pt {
    const dx = ((this.seed % 5) - 2) * 0.1;
    const dy = (((this.seed >>> 3) % 5) - 2) * 0.1;
    return { x: spot.x + 0.5 + dx, y: spot.y + 0.5 + dy };
  }

  private walkTo(tile: Pt & { id: string }, end: Pt, seat: boolean): void {
    this.spotId = tile.id;
    this.atSeat = seat;
    if (!this.placed || this.reducedMotion) {
      this.placed = true;
      this.arrive(end);
      return;
    }
    const from = { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y) };
    const tiles = findPath(this.plan, from, { x: tile.x, y: tile.y });
    const pts = (tiles ?? [from, tile]).slice(1).map(tileCenter);
    if (pts.length === 0) pts.push(end);
    else pts[pts.length - 1] = end;
    this.path = pts;
    this.mode = "walking";
  }

  private arrive(p: Pt): void {
    this.pos = { x: p.x, y: p.y };
    this.path = [];
    this.mode = this.atSeat ? "seated" : "standing";
    this.waitMs = REST_MS[0] + this.rand() * (REST_MS[1] - REST_MS[0]);
  }

  tick(dtMs: number): void {
    if (this.mode === "walking") {
      this.walk(dtMs);
      return;
    }
    if (this.mode !== "standing" || this.reducedMotion) return;
    if (this.agent.activity !== "idle" || wantsSeat(this.agent, this.seat)) return;
    this.waitMs -= dtMs;
    if (this.waitMs > 0) return;
    const next = nextIdleSpot(this.plan, this.rand, this.spotId);
    if (next) this.walkTo(next, this.restPoint(next), false);
  }

  private walk(dtMs: number): void {
    let budget = (TILES_PER_SECOND * dtMs) / 1000;
    this.stride += budget;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0]!;
      const dx = next.x - this.pos.x;
      const dy = next.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      const screenDx = dx - dy;
      if (Math.abs(screenDx) > 0.05) this.walkMirror = screenDx > 0;
      if (d <= budget) {
        this.pos = { x: next.x, y: next.y };
        this.path.shift();
        budget -= d;
      } else {
        this.pos = { x: this.pos.x + (dx / d) * budget, y: this.pos.y + (dy / d) * budget };
        budget = 0;
      }
    }
    if (this.path.length === 0) this.arrive(this.pos);
  }

  /** Remaining walk, for tests. */
  get route(): readonly Pt[] {
    return this.path;
  }

  pose(nowMs: number): PersonPose {
    let mirror: boolean;
    let bob = 0;
    if (this.mode === "walking") {
      mirror = this.walkMirror;
      bob = Math.abs(Math.sin(this.stride * Math.PI * 2)) * 0.05;
    } else if (this.mode === "seated") {
      mirror = this.seat?.facing === "+x";
      if (this.agent.hired && this.agent.activity === "working") bob = Math.abs(Math.sin(nowMs / 260 + (this.seed % 7))) * 0.03;
    } else {
      mirror = prefersMirror(this.agent.profile);
    }
    if (this.reducedMotion) bob = 0;
    const s = toScreen(this.pos.x, this.pos.y);
    return { tx: this.pos.x, ty: this.pos.y, x: s.x, y: s.y, mirror, bob, mode: this.mode };
  }
}
