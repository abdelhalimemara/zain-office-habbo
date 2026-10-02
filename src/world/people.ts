import { prefersMirror } from "./characters";
import { hashString, seededRandom } from "./hash";
import type { Pt } from "./iso";
import type { FloorImage, FloorSeat, FloorSpot } from "./layouts/floorImages";
import { crowdOffset, nextIdleSpot, route } from "./routes";
import type { WorldAgent } from "./types";

export type PersonMode = "seated" | "standing" | "walking";

export interface PersonPose {
  x: number;
  y: number;
  /** Mirror the sprite (faces down-right instead of down-left). */
  mirror: boolean;
  /** Vertical offset in image pixels (typing bob or step bounce); always 0 with reduced motion. */
  bob: number;
  mode: PersonMode;
}

const WALK_HEIGHTS_PER_SECOND = 1.7;
const REST_MS: [number, number] = [4000, 9000];

/** Desk agents stay at their seat unless idle; the board never leaves the board room; vacant seats stay put. */
export function wantsSeat(agent: WorldAgent, seat: FloorSeat | null): boolean {
  if (!seat) return false;
  return !agent.hired || agent.activity !== "idle" || agent.rank === "board";
}

/**
 * Movement and pose for one person on a floor image. Pure (no rendering): the scene reads `pose` every frame.
 */
export class PersonBrain {
  private pos: Pt = { x: 0, y: 0 };
  private via = "";
  private path: Pt[] = [];
  private mode: PersonMode = "standing";
  private placed = false;
  private seat: FloorSeat | null = null;
  private rest: FloorSpot | null = null;
  private spot: FloorSpot | null = null;
  private waitMs = 0;
  private stride = 0;
  private walkMirror = false;
  private readonly rand: () => number;
  private readonly seed: number;

  constructor(
    private readonly floor: FloorImage,
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

  assign(seat: FloorSeat | null, rest: FloorSpot | null): void {
    const changed = seat?.id !== this.seat?.id || rest?.id !== this.rest?.id;
    this.seat = seat;
    this.rest = rest;
    if (changed || !this.placed) this.retarget();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced && this.mode === "walking") this.arriveAt(this.path[this.path.length - 1] ?? this.pos);
  }

  private destination(): FloorSpot | null {
    return wantsSeat(this.agent, this.seat) ? this.seat : this.rest;
  }

  private standPoint(spot: FloorSpot): Pt {
    if (spot === this.seat) return { x: spot.x, y: spot.y };
    const o = crowdOffset(this.seed, this.floor.personHeight);
    return { x: spot.x + o.x, y: spot.y + o.y };
  }

  private retarget(): void {
    const dest = this.destination();
    if (!dest) return;
    this.walkTo(dest);
  }

  private walkTo(dest: FloorSpot): void {
    const end = this.standPoint(dest);
    this.spot = dest;
    if (!this.placed || this.reducedMotion) {
      this.placed = true;
      this.pos = end;
      this.via = dest.via;
      this.arriveAt(end);
      return;
    }
    const pts = route(this.floor, this.pos, this.via, dest);
    pts[pts.length - 1] = end;
    this.path = pts;
    this.mode = "walking";
  }

  private arriveAt(p: Pt): void {
    this.pos = { x: p.x, y: p.y };
    this.path = [];
    this.via = this.spot?.via ?? this.via;
    const seated = !!this.seat && this.spot === this.seat;
    this.mode = seated ? "seated" : "standing";
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
    const next = nextIdleSpot(this.floor, this.rand, this.spot?.id);
    if (next) this.walkTo(next);
  }

  private walk(dtMs: number): void {
    let budget = (WALK_HEIGHTS_PER_SECOND * this.floor.personHeight * dtMs) / 1000;
    this.stride += budget;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0]!;
      const dx = next.x - this.pos.x;
      const dy = next.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) this.walkMirror = dx > 0;
      if (d <= budget) {
        this.pos = { x: next.x, y: next.y };
        this.path.shift();
        budget -= d;
      } else {
        this.pos = { x: this.pos.x + (dx / d) * budget, y: this.pos.y + (dy / d) * budget };
        budget = 0;
      }
    }
    if (this.path.length === 0) this.arriveAt(this.pos);
  }

  pose(nowMs: number): PersonPose {
    const h = this.floor.personHeight;
    let mirror: boolean;
    let bob = 0;
    if (this.mode === "walking") {
      mirror = this.walkMirror;
      bob = -Math.abs(Math.sin((this.stride / h) * Math.PI * 2.2)) * h * 0.035;
    } else if (this.mode === "seated") {
      mirror = !!this.seat?.flip;
      const working = this.agent.hired && this.agent.activity === "working";
      if (working) bob = -Math.abs(Math.sin(nowMs / 260 + (this.seed % 7))) * h * 0.02;
    } else {
      mirror = prefersMirror(this.agent.profile);
    }
    if (this.reducedMotion) bob = 0;
    return { x: this.pos.x, y: this.pos.y, mirror, bob, mode: this.mode };
  }
}
