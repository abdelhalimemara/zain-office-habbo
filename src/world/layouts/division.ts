import type { DivisionId } from "../../../shared/divisions";
import { LayoutBuilder } from "./builder";
import type { FloorLayout } from "./types";

export const DIVISION_COLS = 24;
export const DIVISION_ROWS = 20;

export function buildDivisionLayout(division: Exclude<DivisionId, "hq">): FloorLayout {
  const b = new LayoutBuilder(division, DIVISION_COLS, DIVISION_ROWS);

  b.room("vp", "VP Office", 0, 0, 8, 7, "wood")
    .room("meeting", "Meeting", 8, 0, 9, 7, "carpet")
    .room("kitchen", "Kitchen", 17, 0, 7, 7, "tile")
    .room("corridor", "", 0, 7, 24, 2, "tile")
    .room("open", "Open Plan", 0, 9, 14, 11, "wood")
    .room("hall", "", 14, 9, 2, 11, "tile")
    .room("lounge", "Lounge", 16, 9, 8, 11, "wood");

  b.wall("x", 7, 0, 8, "glass", [[5, 7]])
    .wall("x", 7, 8, 17, "glass", [[14, 16]])
    .wall("x", 7, 17, 24, "solid", [[18, 20]])
    .wall("y", 8, 0, 7)
    .wall("y", 17, 0, 7)
    .wall("x", 9, 0, 14, "glass", [[3, 4], [11, 13]])
    .wall("y", 14, 9, 20, "glass", [[14, 15]])
    .wall("y", 16, 9, 20, "solid", [[9, 12]])
    .wall("x", 9, 16, 24, "solid", [[21, 23]]);

  b.execSeat(3, 1, "sw", "vp", "manager");
  b.add("bookcase", 5, 0, 2, 1, "sw");
  b.add("plant", 7, 0);
  b.add("plant", 0, 0);
  b.add("sofa", 0, 4, 1, 2, "se");
  b.add("coffeeTable", 1, 4);
  b.add("bigPlant", 7, 5);

  b.add("meetingTable", 10, 2, 5, 2);
  b.chairsAround(10, 2, 5, 2);
  b.add("whiteboard", 11, 0, 3, 1, "sw");
  b.add("plant", 8, 0);
  b.add("plant", 16, 0);

  b.add("counter", 18, 0, 4, 1, "sw");
  b.add("fridge", 22, 0, 1, 1, "sw");
  b.add("waterCooler", 23, 0);
  b.add("bistroTable", 20, 3);
  b.add("chair", 19, 3, 1, 1, "se");
  b.add("chair", 21, 3, 1, 1, "nw");
  b.add("vending", 23, 3, 1, 1, "sw");
  b.add("plant", 17, 6);

  const pod = (px: number, r: number) => {
    b.deskSeat(px, r - 1, "sw", "open");
    b.deskSeat(px + 1, r - 1, "sw", "open");
    b.deskSeat(px, r + 2, "ne", "open");
    b.deskSeat(px + 1, r + 2, "ne", "open");
  };
  pod(1, 11);
  pod(5, 11);
  pod(9, 11);
  pod(1, 16);
  pod(5, 16);
  b.add("printer", 13, 12, 1, 1, "nw");
  b.add("filing", 13, 16, 1, 1, "nw");
  b.add("filing", 13, 17, 1, 1, "nw");
  b.add("bigPlant", 10, 17);
  b.add("plant", 12, 19);
  b.add("plant", 0, 19);

  b.add("rug", 17, 11, 4, 3);
  b.add("sofa", 17, 10, 3, 1, "sw");
  b.add("coffeeTable", 18, 12, 2, 1);
  b.add("armchair", 21, 12, 1, 1, "nw");
  b.add("armchair", 18, 14, 1, 1, "ne");
  b.add("gameTable", 19, 16, 3, 2);
  b.add("tv", 16, 12, 1, 2, "se");
  b.add("bigPlant", 16, 19);
  b.add("bigPlant", 23, 9);
  b.add("waterCooler", 23, 15);
  b.add("bookcase", 16, 15, 1, 2, "se");

  return b.build("lounge");
}
