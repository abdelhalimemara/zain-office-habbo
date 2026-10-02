import { PlanBuilder } from "./builder";
import type { FloorPlan } from "./types";

const BLUE_RUG = 0x2f4a73;
const GREY_RUG = 0x8a857d;

/** Zain Studio: glass meeting room and kitchen along the back-left, two long benches, manager office back-right. */
export function buildStudio(): FloorPlan {
  const b = new PlanBuilder("studio", 24, 20);
  b.zone(0, 0, 24, 20, "oak").zone(6, 6, 12, 9, "carpet").zone(5, 16, 8, 4, "stone");
  b.wall("x", 0, 0, 24).wall("y", 0, 0, 20);
  b.wall("x", 6, 0, 9, "glass", [[7, 9]]).wall("y", 9, 0, 6, "glass", [[4, 6]]);
  b.wall("y", 16, 0, 6, "glass", [[4, 6]]).wall("x", 6, 16, 24, "glass", [[16, 18]]);
  b.wall("x", 20, 0, 24, "parapet", [[6, 9]]).wall("y", 24, 0, 20, "parapet");

  const meeting = b.item("meetingTable", 2, 2, 5, 2);
  b.chairsAround(meeting);
  b.item("tv", 0, 2, 1, 2, { facing: "+x" });
  b.item("plant", 8, 0);

  b.item("fridge", 0, 7);
  b.item("counter", 0, 8, 1, 5, { facing: "+x" });
  b.item("counter", 3, 9, 1, 3, { facing: "+x", color: 0xe9e4dc });
  for (let y = 9; y <= 11; y++) b.item("stool", 4, y);
  b.rest(1, 10).rest(2, 12);

  b.item("rug", 1, 14, 4, 5, { color: GREY_RUG });
  b.item("sofa", 0, 15, 1, 3, { facing: "+x" });
  b.item("coffeeTable", 2, 16, 1, 1);
  b.item("armchair", 3, 15, 1, 1, { facing: "-x" });
  b.item("plant", 0, 19);
  b.rest(2, 14).rest(3, 17);

  b.deskRow(10, 7, 6, "+y");
  for (let x = 10; x <= 15; x++) b.item("chair", x, 9, 1, 1, { facing: "-y" });
  b.deskRow(7, 11, 6, "+y");
  for (let x = 7; x <= 12; x++) b.item("chair", x, 13, 1, 1, { facing: "-y" });

  b.item("bookcase", 18, 0, 4, 1);
  const mgr = b.item("execDesk", 19, 3, 2, 1);
  b.seat(20, 2, "+y", { role: "manager", desk: "none", table: mgr.id, chair: "execChair" });
  b.item("armchair", 22, 3, 1, 1, { facing: "+y", color: 0x4d5a3a });
  b.item("roundTable", 22, 4);
  b.item("armchair", 23, 4, 1, 1, { facing: "-x", color: 0x4d5a3a });
  b.item("plant", 23, 0);

  b.item("shelf", 20, 8, 1, 4, { facing: "-x" });
  const dining = b.item("meetingTable", 19, 14, 4, 2, { color: 0x4a4d52 });
  b.chairsAround(dining);
  b.rest(18, 12).rest(22, 12);

  b.item("reception", 9, 16, 4, 1, { label: "Zain Studio" });
  b.item("planter", 14, 19, 5, 1);
  b.item("planter", 2, 19, 2, 1);
  b.rest(8, 18).rest(15, 17);

  b.plate("MEETING ROOM", 4.5, 5.5).plate("KITCHEN", 2, 13).plate("LOUNGE", 2.5, 18.6).plate("MANAGER", 20, 5.6);
  return b.build();
}

/** Zain Growth: meeting room and lounge at the back, manager office back-right, desk clusters, reception front. */
export function buildGrowth(): FloorPlan {
  const b = new PlanBuilder("growth", 25, 14);
  b.zone(0, 0, 25, 14, "stone").zone(0, 0, 8, 4, "carpetDark").zone(16, 0, 9, 5, "walnut").zone(0, 10, 7, 4, "oak");
  b.wall("x", 0, 0, 25).wall("y", 0, 0, 14);
  b.wall("x", 4, 0, 8, "glass", [[6, 8]]).wall("y", 8, 0, 4);
  b.wall("y", 16, 0, 5, "solid", [[3, 5]]).wall("x", 5, 16, 25, "glass", [[17, 19]]);
  b.wall("y", 9, 8, 12, "glass").wall("y", 15, 8, 12, "glass");
  b.wall("x", 14, 0, 25, "parapet", [[11, 14]]).wall("y", 25, 0, 14, "parapet");

  const meeting = b.item("meetingTable", 2, 2, 4, 1);
  b.chairsAround(meeting);
  b.item("tv", 2, 0, 4, 1);

  b.item("sofa", 11, 1, 3, 1);
  b.item("armchair", 10, 2, 1, 1, { facing: "+x" });
  b.item("armchair", 14, 2, 1, 1, { facing: "-x" });
  b.item("roundTable", 12, 2);
  b.item("plant", 9, 0);
  b.item("plant", 15, 0);
  b.rest(11, 3).rest(13, 3);

  b.item("bookcase", 18, 0, 4, 1);
  const mgr = b.item("execDesk", 19, 2, 2, 1);
  b.seat(20, 1, "+y", { role: "manager", desk: "none", table: mgr.id, chair: "execChair" });
  b.item("armchair", 23, 3, 1, 1, { facing: "-x" });
  b.item("plant", 23, 0);

  for (const x of [2, 3, 5, 6]) b.seat(x, 5, "+y");
  for (const x of [2, 3, 5, 6]) b.item("chair", x, 7, 1, 1, { facing: "-y" });
  const big = b.item("meetingTable", 10, 5, 5, 2);
  b.chairsAround(big);
  for (const x of [18, 19, 21, 22]) b.seat(x, 6, "+y");
  for (const x of [18, 19, 21, 22]) b.item("chair", x, 8, 1, 1, { facing: "-y" });

  b.item("counter", 0, 8, 4, 1, { facing: "+y" });
  for (const x of [1, 2, 3]) b.item("stool", x, 9);
  for (const x of [5, 6, 7]) b.seat(x, 9, "+y");
  for (const x of [5, 6, 7]) b.item("chair", x, 11, 1, 1, { facing: "-y" });
  for (const x of [18, 19, 21, 22]) b.seat(x, 9, "+y");
  for (const x of [18, 19, 21, 22]) b.item("chair", x, 11, 1, 1, { facing: "-y" });
  b.rest(2, 10).rest(16, 7).rest(9, 7);

  b.item("featureWall", 10, 8, 5, 1);
  b.item("reception", 10, 10, 5, 1, { label: "Zain Growth" });
  b.item("featureWall", 16, 12, 8, 1, { label: "Performance Marketing", color: 0x2b2e33 });

  b.item("rug", 1, 11, 5, 3, { color: GREY_RUG });
  b.item("sofa", 0, 11, 1, 2, { facing: "+x", color: 0x4d5a3a });
  b.item("roundTable", 3, 12);
  b.item("armchair", 4, 11, 1, 1, { facing: "-x" });
  b.rest(4, 13).rest(2, 13);

  b.plate("MEETING ROOM", 4, 3.6).plate("MANAGER", 20.5, 4.6).plate("KITCHEN", 2, 9.8).plate("LOUNGE", 3.5, 13.6);
  return b.build();
}

/** Zain Labs: bookcase wall with two desk rows on the left, blue-rug lounges, reception right, office and meeting front. */
export function buildLabs(): FloorPlan {
  const b = new PlanBuilder("labs", 24, 20);
  b.zone(0, 0, 24, 20, "oak").zone(14, 11, 6, 6, "carpet").zone(8, 15, 6, 5, "carpet");
  b.wall("x", 0, 0, 24).wall("y", 0, 0, 20);
  b.wall("x", 11, 14, 20).wall("y", 14, 11, 17, "glass", [[15, 17]]).wall("y", 20, 11, 17);
  b.wall("x", 15, 8, 14).wall("y", 14, 17, 20, "glass", [[17, 19]]);
  b.wall("x", 20, 0, 24, "parapet", [[4, 8]]).wall("y", 24, 0, 20, "parapet");

  b.item("bookcase", 0, 2, 1, 9, { facing: "+x" });
  b.deskRow(2, 3, 6, "+x");
  for (let y = 3; y <= 8; y++) b.item("chair", 4, y, 1, 1, { facing: "-x" });
  b.deskRow(5, 10, 6, "+x");
  for (let y = 10; y <= 15; y++) b.item("chair", 7, y, 1, 1, { facing: "-x" });
  b.item("planter", 9, 9, 1, 4);

  const communal = b.item("meetingTable", 8, 4, 5, 1);
  b.chairsAround(communal);

  b.item("rug", 13, 5, 5, 4, { color: BLUE_RUG });
  b.item("armchair", 14, 6, 1, 1, { facing: "+x", color: 0x2f4a73 });
  b.item("armchair", 15, 5, 1, 1, { facing: "+y", color: 0x3a3d44 });
  b.item("roundTable", 15, 7);
  b.item("stool", 17, 6);
  b.item("stool", 17, 8);
  b.rest(16, 7).rest(14, 8);

  b.item("rug", 14, 1, 5, 3, { color: BLUE_RUG });
  b.item("sofa", 15, 1, 3, 1, { color: 0xc9c5bf });
  b.item("roundTable", 16, 2);
  b.item("shelf", 11, 0, 2, 1);
  b.item("plant", 13, 0);
  b.rest(14, 2).rest(18, 2);

  b.item("slatWall", 20, 0, 4, 1);
  b.item("reception", 19, 3, 4, 1, { label: "Zain Labs" });
  b.item("plant", 23, 3);
  b.rest(20, 5);

  const mgr = b.item("execDesk", 16, 13, 2, 1);
  b.seat(17, 12, "+y", { role: "manager", desk: "none", table: mgr.id, chair: "execChair" });
  b.item("bookcase", 19, 12, 1, 3, { facing: "-x" });
  b.item("plant", 15, 11);

  const meeting = b.item("meetingTable", 9, 16, 3, 2);
  b.chairsAround(meeting);
  b.item("planter", 3, 18, 4, 1);
  b.item("sofa", 18, 18, 3, 1, { facing: "-y", color: 0xc9c5bf });
  b.item("plant", 22, 18);
  b.item("plant", 1, 13);
  b.rest(19, 17);

  b.plate("MANAGER", 17, 16.5).plate("MEETING ROOM", 11, 19.5).plate("LOUNGE", 15.5, 9.6);
  return b.build();
}
