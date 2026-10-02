import { TECH_TEAMS } from "../../../shared/techTeams";
import { PlanBuilder } from "./builder";
import type { FloorPlan } from "./types";

export const TECH_COLS = 38;
export const TECH_ROWS = 24;

/** Pod slots: 3 columns × 2 rows of 8×6 tiles; the named teams first, then spare slots for runtime teams. */
const POD_X = [1, 11, 21] as const;
const POD_Y = [9, 16] as const;
export const POD_W = 8;
export const POD_D = 6;
export const POD_SLOTS = POD_X.length * POD_Y.length;

const POD_CARPETS = ["carpet", "carpetDark"] as const;

/** Plate text for a pod: the team name in capitals, shortened where a full name would crowd the pod. */
export function podLabel(name: string): string {
  return name.replace(/^Zain Group /, "").toUpperCase();
}

/**
 * Zain Tech: café, server room and stairs, glass meeting room and VP office along the back; a 3×2 grid of team pods
 * (one per repo team plus spare slots); the platform team and lounge down the right; reception at the front right.
 */
export function buildTech(): FloorPlan {
  const b = new PlanBuilder("tech", TECH_COLS, TECH_ROWS);
  b.zone(0, 0, TECH_COLS, TECH_ROWS, "stone").zone(0, 0, 8, 7, "oak").zone(29, 0, 9, 7, "walnut").zone(19, 0, 9, 7, "carpet");
  b.zone(8, 0, 7, 5, "carpetDark").zone(31, 16, 7, 8, "oak");

  b.wall("x", 0, 0, TECH_COLS).wall("y", 0, 0, TECH_ROWS);
  b.wall("y", 8, 0, 7, "glass", [[5, 7]]);
  b.wall("x", 5, 8, 15, "glass", [[11, 13]]).wall("y", 15, 0, 5);
  b.wall("y", 19, 0, 7, "glass").wall("x", 7, 19, 28, "glass", [[23, 25]]).wall("y", 28, 0, 7);
  b.wall("y", 29, 0, 7, "glass").wall("x", 7, 29, 38, "glass", [[30, 32]]);
  b.wall("y", 31, 9, 15, "glass", [[11, 13]]);
  b.wall("x", TECH_ROWS, 0, TECH_COLS, "parapet", [[14, 18]]).wall("y", TECH_COLS, 0, TECH_ROWS, "parapet");

  b.item("counter", 0, 1, 1, 5, { facing: "+x" });
  b.item("fridge", 0, 0);
  for (const [x, y] of [[3, 2], [3, 5], [6, 3]] as const) b.chairsAround(b.item("roundTable", x, y), { back: false, front: false });
  b.item("foosball", 1, 6, 2, 1);
  b.rest(2, 3).rest(5, 5).rest(4, 1);

  for (const x of [8, 11]) b.item("rack", x, 0, 3, 1);
  b.item("rack", 8, 2, 3, 1);
  b.item("rack", 12, 2, 3, 1);
  b.item("stairs", 16, 0, 3, 3);
  b.item("planter", 15, 5, 3, 1);

  const meeting = b.item("meetingTable", 21, 2, 5, 2);
  b.chairsAround(meeting);
  b.item("tv", 22, 0, 3, 1);
  b.item("plant", 27, 0);

  b.item("bookcase", 31, 0, 4, 1);
  const vp = b.item("execDesk", 33, 3, 2, 1);
  b.seat(34, 2, "+y", { role: "manager", desk: "none", table: vp.id, chair: "execChair" });
  b.item("armchair", 32, 5, 1, 1, { facing: "-y" });
  b.item("armchair", 35, 5, 1, 1, { facing: "-y" });
  b.item("plant", 37, 0);

  const named = TECH_TEAMS.map((t) => ({ team: t.id as string | null, label: podLabel(t.name) }));
  const slots = [...named, ...Array.from({ length: POD_SLOTS - named.length }, () => ({ team: null, label: "NEW TEAM" }))];
  slots.forEach((slot, i) => {
    const px = POD_X[i % POD_X.length]!;
    const py = POD_Y[Math.floor(i / POD_X.length)]!;
    const pod = b.pod(slot.team, slot.label, px, py, POD_W, POD_D);
    b.zone(px, py, POD_W, POD_D, POD_CARPETS[i % 2]!);
    const opts = { pod: pod.index, ...(slot.team ? { team: slot.team } : {}) };
    for (let k = 0; k < 4; k++) b.seat(px + 1 + k, py + 1, "+y", { ...opts, lead: k < 2 });
    for (let k = 0; k < 4; k++) b.seat(px + 1 + k, py + 3, "+y", opts);
    b.item("planter", px + 6, py + 1, 1, 4);
    b.item("plant", px + 7, py);
    b.plate(slot.label, px + 3, py + POD_D - 0.3, pod.index);
  });

  b.item("rug", 32, 9, 5, 6, { color: 0x6b6f75 });
  b.deskRow(32, 9, 6, "+x", { team: "platform" });
  b.item("whiteboard", 35, 9, 1, 3, { facing: "+x" });
  b.item("plant", 37, 14);

  b.item("sofa", 32, 17, 3, 1, { facing: "+y", color: 0x3a3d44 });
  b.item("coffeeTable", 32, 19, 3, 1);
  b.item("armchair", 36, 18, 1, 1, { facing: "-x", color: 0x3a3d44 });
  b.item("sofa", 31, 21, 1, 2, { facing: "+x", color: 0x3a3d44 });
  b.item("slatWall", 34, 22, 4, 1);
  b.item("reception", 34, 21, 3, 1, { label: "Zain Tech" });
  b.item("plant", 37, 16);
  b.rest(33, 20).rest(35, 18).rest(32, 23).rest(30, 18).rest(30, 12);

  b.plate("CAFÉ", 4, 7.4).plate("SERVER ROOM", 11.5, 5.4).plate("MEETING ROOM", 23.5, 7.4).plate("VP OFFICE", 33.5, 7.4);
  b.plate("PLATFORM", 34, 15.4).plate("LOUNGE", 34, 23.5);
  return b.build();
}
