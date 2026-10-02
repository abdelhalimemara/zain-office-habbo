import type { Facing, Pose } from "./avatars";
import { dirFacing, seatPose, segmentFacing } from "./behavior";
import { prefersMirror } from "./characters";
import { hashString, seededRandom } from "./hash";
import { toScreen, type Box, type Pt } from "./iso";
import { personBox } from "./plan/boxes";
import { findPath, standPoint, tileCenter } from "./plan/grid";
import type { FloorPlan, PlanSeat, SofaSeat, Spot } from "./plan";
import type { WorldAgent } from "./types";

export type PersonMode = "seated" | "sofa" | "standing" | "walking";

export interface PersonPose {
  /** Anchor in tile space: the feet, or the hips on a seat (`seated`), at height `z` tiles. */
  tx: number;
  ty: number;
  z: number;
  /** Anchor in scene pixels. */
  x: number;
  y: number;
  /** The anchor is the hip point on a chair or cushion (place the avatar at anchor − seatOffset). */
  seated: boolean;
  facing: Facing;
  pose: Pose;
  mode: PersonMode;
  /** Depth-sort footprint in tile space. */
  sort: Box;
}

type Target =
  | { kind: "seat"; seat: PlanSeat }
  | { kind: "desk"; seat: PlanSeat }
  | { kind: "cushion"; cushion: SofaSeat }
  | { kind: "spot"; spot: Spot };

const TILES_PER_SECOND = 1.8;
const REST_MS: [number, number] = [5000, 11000];
const SORT_HALF = 0.12;
/** Idle people only take cushions facing the viewer, so they read as sitting rather than hidden behind a backrest. */
const VIEWER_FACING: ReadonlySet<string> = new Set(["+x", "+y"]);

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

/** Sort footprint of someone sitting at a desk seat: between the chair (behind them) and the desk (in front). */
export function seatedSortBox(seat: Pick<PlanSeat, "x" | "y" | "facing">): Box {
  const p = seat.facing === "+y" ? { x: seat.x + 0.5, y: seat.y + 0.61 } : { x: seat.x + 0.61, y: seat.y + 0.5 };
  return { x0: p.x - SORT_HALF, y0: p.y - SORT_HALF, x1: p.x + SORT_HALF, y1: p.y + SORT_HALF, h: 1.4 };
}

/** Sort footprint of someone on a sofa: just in front of it when it faces the viewer, just behind it otherwise. */
export function sofaSortBox(plan: FloorPlan, c: SofaSeat): Box {
  const it = plan.items.find((i) => i.id === c.item);
  const h = 1.4;
  const s = SORT_HALF;
  if (!it) return { x0: c.x - s, y0: c.y - s, x1: c.x + s, y1: c.y + s, h };
  switch (c.facing) {
    case "+y":
      return { x0: c.x - s, y0: it.y + it.d + 0.02, x1: c.x + s, y1: it.y + it.d + 0.2, h };
    case "+x":
      return { x0: it.x + it.w + 0.02, y0: c.y - s, x1: it.x + it.w + 0.2, y1: c.y + s, h };
    case "-y":
      return { x0: c.x - s, y0: it.y - 0.2, x1: c.x + s, y1: it.y - 0.02, h };
    case "-x":
      return { x0: it.x - 0.2, y0: c.y - s, x1: it.x - 0.02, y1: c.y + s, h };
  }
}

/**
 * Movement, pose and facing for one person on a floor plan. Pure (no rendering): the scene reads `pose` every frame.
 * Walks follow A* tile paths, so nobody crosses furniture or walls; idle people stroll between idle spots and sofas.
 */
export class PersonBrain {
  private pos: Pt = { x: 0, y: 0 };
  private path: Pt[] = [];
  private mode: PersonMode = "standing";
  private placed = false;
  private seat: PlanSeat | null = null;
  private rest: Spot | null = null;
  private target: Target | null = null;
  private waitMs = 0;
  private rested = 0;
  private facing: Facing = "SW";
  private readonly rand: () => number;
  readonly seed: number;

  constructor(
    private readonly plan: FloorPlan,
    private agent: WorldAgent,
    private reducedMotion: boolean,
    /** Cushion ids taken by anyone on this floor (shared between brains). */
    private readonly claims: Set<string> = new Set(),
  ) {
    this.seed = hashString(agent.profile);
    this.rand = seededRandom(this.seed);
  }

  get profile(): string {
    return this.agent.profile;
  }

  /** Time spent resting in place (standing or on a sofa) since the last move. */
  get restingMs(): number {
    return this.mode === "standing" || this.mode === "sofa" ? this.rested : 0;
  }

  /** Remaining walk, for tests. */
  get route(): readonly Pt[] {
    return this.path;
  }

  setAgent(agent: WorldAgent): void {
    const moved = wantsSeat(agent, this.seat) !== wantsSeat(this.agent, this.seat) || agent.hired !== this.agent.hired;
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
    if (reduced && this.mode === "walking") this.arrive();
  }

  release(): void {
    if (this.target?.kind === "cushion") this.claims.delete(this.target.cushion.id);
  }

  private retarget(): void {
    if (this.seat && wantsSeat(this.agent, this.seat)) this.go(this.agent.hired ? { kind: "seat", seat: this.seat } : { kind: "desk", seat: this.seat });
    else this.go(this.firstIdle());
  }

  private firstIdle(): Target | null {
    if (this.seed % 3 === 0) {
      const c = this.freeCushion();
      if (c) return { kind: "cushion", cushion: c };
    }
    return this.rest ? { kind: "spot", spot: this.rest } : null;
  }

  private freeCushion(): SofaSeat | null {
    const free = this.plan.sofaSeats.filter((c) => VIEWER_FACING.has(c.facing) && !this.claims.has(c.id));
    return free.length ? free[Math.floor(this.rand() * free.length) % free.length]! : null;
  }

  private nextIdle(): Target | null {
    if (this.rand() < 0.4) {
      const c = this.freeCushion();
      if (c) return { kind: "cushion", cushion: c };
    }
    const options = this.plan.idle.filter((s) => !(this.target?.kind === "spot" && this.target.spot.id === s.id));
    if (options.length === 0) return this.rest ? { kind: "spot", spot: this.rest } : null;
    return { kind: "spot", spot: options[Math.floor(this.rand() * options.length) % options.length]! };
  }

  /** Floor point (tile space) where the walk ends for a target. */
  private endPoint(t: Target): Pt {
    switch (t.kind) {
      case "seat":
        return { x: t.seat.sit.x, y: t.seat.sit.y };
      case "desk":
        return standPoint(t.seat);
      case "cushion":
        return { x: t.cushion.x, y: t.cushion.y };
      case "spot": {
        const dx = ((this.seed % 5) - 2) * 0.1;
        const dy = (((this.seed >>> 3) % 5) - 2) * 0.1;
        return { x: t.spot.x + 0.5 + dx, y: t.spot.y + 0.5 + dy };
      }
    }
  }

  private targetTile(t: Target): Pt {
    switch (t.kind) {
      case "seat":
      case "desk":
        return { x: t.seat.x, y: t.seat.y };
      case "cushion":
        return { x: Math.floor(t.cushion.x), y: Math.floor(t.cushion.y) };
      case "spot":
        return { x: t.spot.x, y: t.spot.y };
    }
  }

  private go(t: Target | null): void {
    if (!t) return;
    this.release();
    if (t.kind === "cushion") this.claims.add(t.cushion.id);
    this.target = t;
    const end = this.endPoint(t);
    if (!this.placed || this.reducedMotion) {
      this.placed = true;
      this.pos = end;
      this.arrive();
      return;
    }
    const from = { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y) };
    const tile = this.targetTile(t);
    const tiles = findPath(this.plan, from, tile);
    const pts = (tiles ?? [from, tile]).slice(1).map(tileCenter);
    if (pts.length === 0) pts.push(end);
    else pts[pts.length - 1] = end;
    this.path = pts;
    this.mode = "walking";
    this.rested = 0;
  }

  private arrive(): void {
    const t = this.target;
    this.path = [];
    this.rested = 0;
    this.waitMs = REST_MS[0] + this.rand() * (REST_MS[1] - REST_MS[0]);
    if (!t) {
      this.mode = "standing";
      return;
    }
    if (t.kind === "seat") {
      this.pos = { x: t.seat.sit.x, y: t.seat.sit.y };
      this.mode = "seated";
      this.facing = dirFacing(t.seat.facing);
    } else if (t.kind === "desk") {
      this.pos = standPoint(t.seat);
      this.mode = "standing";
      this.facing = dirFacing(t.seat.facing);
    } else if (t.kind === "cushion") {
      this.pos = { x: t.cushion.x, y: t.cushion.y };
      this.mode = "sofa";
      this.facing = dirFacing(t.cushion.facing);
    } else {
      this.mode = "standing";
      this.facing = prefersMirror(this.agent.profile) ? "SE" : "SW";
    }
  }

  tick(dtMs: number): void {
    if (this.mode === "walking") {
      this.walk(dtMs);
      return;
    }
    this.rested += dtMs;
    if (this.reducedMotion || this.mode === "seated") return;
    if (this.target?.kind === "desk") return;
    if (this.agent.activity !== "idle" || wantsSeat(this.agent, this.seat)) return;
    this.waitMs -= dtMs;
    if (this.waitMs <= 0) this.go(this.nextIdle());
  }

  private walk(dtMs: number): void {
    let budget = (TILES_PER_SECOND * dtMs) / 1000;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0]!;
      const dx = next.x - this.pos.x;
      const dy = next.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) this.facing = segmentFacing(dx, dy, this.facing);
      if (d <= budget) {
        this.pos = { x: next.x, y: next.y };
        this.path.shift();
        budget -= d;
      } else {
        this.pos = { x: this.pos.x + (dx / d) * budget, y: this.pos.y + (dy / d) * budget };
        budget = 0;
      }
    }
    if (this.path.length === 0) this.arrive();
  }

  pose(): PersonPose {
    const t = this.target;
    let z = 0;
    let seated = false;
    let pose: Pose = "stand";
    let sort = personBox(this.pos.x, this.pos.y);
    if (this.mode === "walking") pose = this.reducedMotion ? "stand" : "walk";
    else if (this.mode === "seated" && t?.kind === "seat") {
      z = t.seat.sit.height;
      seated = true;
      pose = seatPose(this.agent);
      sort = seatedSortBox(t.seat);
    } else if (this.mode === "sofa" && t?.kind === "cushion") {
      z = t.cushion.height;
      seated = true;
      pose = "sit";
      sort = sofaSortBox(this.plan, t.cushion);
    }
    const s = toScreen(this.pos.x, this.pos.y, z);
    return { tx: this.pos.x, ty: this.pos.y, z, x: s.x, y: s.y, seated, facing: this.facing, pose, mode: this.mode, sort };
  }
}
