import { screenBounds, type Rect } from "../iso";
import { podsForTeams } from "../seating";
import type { FloorPlan, Pod } from "./types";

/** The pod a team works in, given every team id currently on the floor (runtime teams take spare pods). */
export function podFor(plan: FloorPlan, teamId: string, teamIds: Iterable<string> = []): Pod | null {
  return podsForTeams(plan, [teamId, ...teamIds]).get(teamId) ?? null;
}

/** Scene-pixel rectangle around a team's pod floor (with room for the people standing in it), or null. */
export function teamZone(plan: FloorPlan, teamId: string, teamIds: Iterable<string> = []): Rect | null {
  const pod = podFor(plan, teamId, teamIds);
  if (!pod) return null;
  return screenBounds({ x0: pod.x, y0: pod.y, x1: pod.x + pod.w, y1: pod.y + pod.d, h: 1.8 });
}
