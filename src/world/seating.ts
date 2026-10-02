import { ROSTER, type Rank } from "../../shared/roster";
import { HQ_TEAMS, type FloorPlan, type PlanSeat, type SeatRole } from "./plan";

export interface SeatCandidate {
  profile: string;
  rank: Rank;
}

export interface SeatAssignment {
  seats: Map<string, PlanSeat>;
  /** Agents with no seat left; they stand in the idle areas. */
  overflow: string[];
}

const rosterIndex = new Map(ROSTER.map((a, i) => [a.profile, i]));

export function rosterOrder<T extends SeatCandidate>(agents: readonly T[]): T[] {
  return [...agents].sort((a, b) => {
    const ia = rosterIndex.get(a.profile) ?? Number.MAX_SAFE_INTEGER;
    const ib = rosterIndex.get(b.profile) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib || (a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : 0);
  });
}

const ROLE_FOR_RANK: Partial<Record<Rank, SeatRole>> = { ceo: "ceo", vp: "manager", board: "board" };

/**
 * Deterministic seating: the CEO, the division manager and board members take their role seats; HQ leads sit in
 * their department; everyone else fills the remaining workstations in roster order.
 */
export function assignSeats(floor: FloorPlan, agents: readonly SeatCandidate[]): SeatAssignment {
  const seats = new Map<string, PlanSeat>();
  const overflow: string[] = [];
  const taken = new Set<string>();
  const take = (seat: PlanSeat | undefined, profile: string): boolean => {
    if (!seat) return false;
    taken.add(seat.id);
    seats.set(profile, seat);
    return true;
  };
  const free = (pred: (s: PlanSeat) => boolean) => floor.seats.find((s) => !taken.has(s.id) && pred(s));

  const rest: SeatCandidate[] = [];
  for (const a of rosterOrder(agents)) {
    const role = ROLE_FOR_RANK[a.rank];
    if (role && take(free((s) => s.role === role), a.profile)) continue;
    if (a.rank === "board") {
      overflow.push(a.profile);
      continue;
    }
    rest.push(a);
  }
  const unplaced: SeatCandidate[] = [];
  for (const a of rest) {
    const team = HQ_TEAMS[a.profile];
    if (!team || !take(free((s) => !s.role && s.team === team), a.profile)) unplaced.push(a);
  }
  for (const a of unplaced) {
    if (!take(free((s) => !s.role), a.profile)) overflow.push(a.profile);
  }
  return { seats, overflow };
}
