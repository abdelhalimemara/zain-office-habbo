import { PlanBuilder } from "./builder";
import type { FloorPlan } from "./types";

/**
 * Zain Group HQ, after the HQ render: board room top-left, Operations and Account Management down the left, common
 * area top-centre, marble reception with the "Zain Group" wall and lounge in the middle, print/copy, Finance / HR /
 * Legal down the right, Executive Lounge bottom-right, entrance at the front.
 */
export function buildHq(): FloorPlan {
  const b = new PlanBuilder("hq", 30, 17);

  b.zone(0, 0, 9, 8, "walnut")
    .zone(1, 1, 8, 6, "carpet")
    .zone(0, 8, 9, 9, "carpetDark")
    .zone(9, 0, 12, 8, "carpet")
    .zone(9, 8, 9, 9, "marble")
    .zone(18, 8, 3, 4, "stone")
    .zone(18, 12, 4, 5, "marble")
    .zone(21, 0, 1, 12, "marble")
    .zone(22, 0, 8, 17, "walnut");

  b.wall("x", 0, 0, 30).wall("y", 0, 0, 17);
  b.wall("x", 8, 0, 9, "glass").wall("x", 12, 0, 9, "glass");
  b.wall("y", 9, 0, 8, "solid", [[6, 8]]).wall("y", 9, 8, 12, "glass", [[10, 11]]).wall("y", 9, 12, 17, "glass", [[13, 14]]);
  b.wall("x", 8, 18, 21).wall("x", 12, 18, 21, "glass").wall("y", 18, 8, 12, "glass", [[9, 10]]);
  b.wall("y", 22, 0, 17, "solid", [[2, 3], [6, 7], [10, 11], [13, 15]]);
  b.wall("x", 4, 22, 30).wall("x", 8, 22, 30).wall("x", 12, 22, 30);
  b.wall("x", 17, 0, 30, "parapet", [[14, 17]]).wall("y", 30, 0, 17, "parapet");

  const board = b.item("boardTable", 2, 3, 6, 2);
  b.chairsAround(board);
  for (let x = 2; x <= 6; x++) b.seat(x, 1, "+y", { role: "board", desk: "none", table: board.id, chair: "none", reach: 2 });
  b.item("plant", 0, 0);
  b.item("plant", 0, 7);
  b.item("credenza", 3, 0, 4, 1);

  for (const x of [1, 2, 5, 6]) b.seat(x, 9, "+y", { team: "ops" });
  for (const x of [1, 2, 5, 6]) b.item("chair", x, 11, 1, 1, { facing: "-y" });
  b.item("planter", 3, 10, 2, 1);
  b.item("plant", 8, 9);

  for (const x of [1, 2, 4, 5, 7, 8]) b.seat(x, 13, "+y", { team: "accounts" });
  for (const x of [1, 2, 4, 5, 7, 8]) b.item("chair", x, 15, 1, 1, { facing: "-y" });
  b.item("plant", 0, 16);

  const cafe1 = b.item("roundTable", 11, 2);
  const cafe2 = b.item("roundTable", 11, 5);
  b.chairsAround(cafe1, { back: false, front: false }).chairsAround(cafe2, { back: false, front: false });
  b.item("counter", 13, 0, 5, 1, { facing: "+y" });
  for (let x = 13; x <= 17; x++) b.item("stool", x, 1);
  b.item("fridge", 18, 0);
  b.item("credenza", 9, 0, 3, 1);
  b.item("sofa", 14, 3, 1, 2, { facing: "+x" });
  b.item("sofa", 18, 3, 1, 2, { facing: "-x" });
  b.item("coffeeTable", 15, 3, 2, 2);
  b.item("planter", 20, 2, 1, 4);
  b.rest(12, 3).rest(16, 5).rest(19, 1).rest(10, 7).rest(15, 6);

  b.item("featureWall", 12, 8, 6, 1, { label: "Zain Group" });
  b.item("reception", 13, 10, 4, 1, { facing: "+y" });
  b.item("planter", 10, 8);
  b.item("planter", 17, 9);
  b.item("rug", 12, 12, 6, 4, { color: 0x6b6259 });
  b.item("sofa", 13, 15, 3, 1, { facing: "-y" });
  b.item("armchair", 12, 13, 1, 1, { facing: "+x" });
  b.item("armchair", 16, 13, 1, 1, { facing: "-x" });
  b.item("roundTable", 14, 13);
  b.rest(13, 14).rest(15, 14).rest(11, 14).rest(17, 15);

  b.item("printer", 19, 8);
  b.item("printer", 20, 8);
  b.item("credenza", 20, 10, 1, 2, { facing: "-x" });
  b.rest(19, 10);

  const office = (y: number, team: string) => {
    b.item("bookcase", 24, y, 3, 1);
    const desk = b.item("execDesk", 25, y + 2, 2, 1);
    b.seat(26, y + 1, "+y", { team, desk: "none", table: desk.id, chair: "execChair" });
    b.item("armchair", 25, y + 3, 1, 1, { facing: "-y" });
    b.item("armchair", 26, y + 3, 1, 1, { facing: "-y" });
    b.item("plant", 29, y);
  };
  office(0, "finance");
  office(4, "hr");
  office(8, "legal");

  const ceoDesk = b.item("execDesk", 23, 14, 2, 1, { color: 0x2a2420 });
  b.seat(24, 13, "+y", { role: "ceo", desk: "none", table: ceoDesk.id, chair: "execChair" });
  const cooDesk = b.item("execDesk", 27, 14, 2, 1);
  b.seat(28, 13, "+y", { role: "manager", desk: "none", table: cooDesk.id, chair: "execChair" });
  b.item("credenza", 25, 12, 2, 1);
  b.item("sofa", 24, 16, 3, 1, { facing: "-y" });
  b.item("plant", 29, 12);
  b.item("plant", 22, 16);

  b.plate("BOARD ROOM", 4.5, 7.4)
    .plate("OPERATIONS TEAM", 4.5, 11.6)
    .plate("ACCOUNT MANAGEMENT", 4.5, 16.6)
    .plate("COMMON AREA", 10.5, 7.4)
    .plate("PRINT / COPY", 19.5, 11.6)
    .plate("FINANCE", 26.5, 3.7)
    .plate("HR", 26.5, 7.7)
    .plate("LEGAL", 26.5, 11.7)
    .plate("EXECUTIVE LOUNGE", 26, 16.6);
  return b.build();
}
