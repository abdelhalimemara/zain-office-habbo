import { ROSTER, type Rank } from "../../shared/roster";
import type { FloorLayout, Seat } from "./layouts/types";

export interface SeatCandidate {
  profile: string;
  rank: Rank;
}

export interface SeatAssignment {
  seats: Map<string, Seat>;
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

export function assignSeats(layout: FloorLayout, agents: readonly SeatCandidate[]): SeatAssignment {
  const seats = new Map<string, Seat>();
  const overflow: string[] = [];
  const taken = new Set<string>();
  const ordered = rosterOrder(agents);
  const take = (seat: Seat | undefined, profile: string): boolean => {
    if (!seat || taken.has(seat.id)) return false;
    taken.add(seat.id);
    seats.set(profile, seat);
    return true;
  };
  const roleSeat = (role: Seat["role"]) => layout.seats.find((s) => s.role === role && !taken.has(s.id));

  const rest: SeatCandidate[] = [];
  for (const a of ordered) {
    if (a.rank === "ceo" && take(roleSeat("ceo"), a.profile)) continue;
    if (a.rank === "vp" && take(roleSeat("manager"), a.profile)) continue;
    if (a.rank === "board") {
      if (!take(roleSeat("board"), a.profile)) overflow.push(a.profile);
      continue;
    }
    rest.push(a);
  }
  const free = layout.seats.filter((s) => !s.role);
  let i = 0;
  for (const a of rest) {
    while (i < free.length && taken.has(free[i]!.id)) i++;
    if (!take(free[i], a.profile)) overflow.push(a.profile);
  }
  return { seats, overflow };
}
