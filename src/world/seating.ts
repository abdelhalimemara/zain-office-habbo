import { ROSTER, type Rank } from "../../shared/roster";
import { HQ_TEAMS, type FloorPlan, type PlanSeat, type Pod, type SeatRole } from "./plan";

export interface SeatCandidate {
  profile: string;
  rank: Rank;
  /** Zain Tech repo team id. */
  team?: string;
  /** Used to order a pod's two leads (Head Engineer before Project Manager) when `teamRole` is missing. */
  title?: string;
  /** Zain Tech role inside a team (shared/techRoster.ts). */
  teamRole?: string;
  /** Studio / Growth unit id; unit members sit at the seats tagged with it. */
  unit?: string;
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
 * their department and Studio / Growth specialists in their unit's cluster; everyone else fills the remaining
 * workstations in roster order.
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
  if (floor.pods.length > 0) {
    seatPods(floor, rest, take, free, overflow);
    return { seats, overflow };
  }
  const unplaced: SeatCandidate[] = [];
  for (const a of rest) {
    const team = a.unit ?? HQ_TEAMS[a.profile];
    if (!team || !take(free((s) => !s.role && s.team === team), a.profile)) unplaced.push(a);
  }
  for (const a of unplaced) {
    if (!take(free((s) => !s.role), a.profile)) overflow.push(a.profile);
  }
  return { seats, overflow };
}

/**
 * Which pod each team works in: named teams have their own pod; teams added at runtime take the spare pods in
 * alphabetical order of id. Teams beyond the spare pods get none (their people overflow).
 */
export function podsForTeams(floor: Pick<FloorPlan, "pods">, teamIds: Iterable<string>): Map<string, Pod> {
  const out = new Map<string, Pod>();
  for (const p of floor.pods) if (p.team) out.set(p.team, p);
  const spare = floor.pods.filter((p) => p.team === null);
  const runtime = [...new Set(teamIds)].filter((t) => !out.has(t)).sort();
  runtime.forEach((t, i) => {
    const p = spare[i];
    if (p) out.set(t, p);
  });
  return out;
}

/** Head engineers and project managers lead a pod; teamRole wins, then rank and title for rosters without it. */
export function isPodLead(a: SeatCandidate): boolean {
  if (a.teamRole) return a.teamRole === "head-engineer" || a.teamRole === "project-manager";
  return a.rank === "lead" || /head engineer|project manager/i.test(a.title ?? "");
}

function leadOrder(a: SeatCandidate): number {
  if (a.teamRole) return a.teamRole === "head-engineer" ? 0 : 1;
  return /head/i.test(a.title ?? "") ? 0 : 1;
}

function seatPods(
  floor: FloorPlan,
  agents: readonly SeatCandidate[],
  take: (seat: PlanSeat | undefined, profile: string) => boolean,
  free: (pred: (s: PlanSeat) => boolean) => PlanSeat | undefined,
  overflow: string[],
): void {
  const pods = podsForTeams(floor, agents.flatMap((a) => (a.team ? [a.team] : [])));
  const used = new Set([...pods.values()].map((p) => p.index));
  const leads = agents.filter((a) => a.team && isPodLead(a)).sort((a, b) => leadOrder(a) - leadOrder(b));
  const unplaced: SeatCandidate[] = [];
  for (const a of [...leads, ...agents.filter((x) => !(x.team && isPodLead(x)))]) {
    if (a.team) {
      const pod = pods.get(a.team);
      const lead = isPodLead(a);
      const inPod = (s: PlanSeat) => !s.role && pod !== undefined && s.pod === pod.index;
      const placed = pod && (lead ? take(free((s) => inPod(s) && !!s.lead), a.profile) : false);
      if (placed || (pod && take(free((s) => inPod(s) && !s.lead), a.profile))) continue;
      if (pod && lead && take(free(inPod), a.profile)) continue;
    } else if (take(free((s) => !s.role && s.team === "platform"), a.profile)) {
      continue;
    }
    unplaced.push(a);
  }
  for (const a of unplaced) {
    if (!take(free((s) => !s.role && s.pod !== undefined && !used.has(s.pod)), a.profile)) overflow.push(a.profile);
  }
}
