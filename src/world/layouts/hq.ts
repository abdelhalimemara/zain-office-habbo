import { PAL } from "../palette";
import { LayoutBuilder } from "./builder";
import type { FloorLayout } from "./types";

export const HQ_COLS = 30;
export const HQ_ROWS = 24;

const DEPARTMENTS = [
  { id: "ops", name: "Ops / PMO", x: 0, y: 10 },
  { id: "care", name: "Customer Care", x: 7, y: 10 },
  { id: "accounts", name: "Account Mgmt", x: 14, y: 10 },
  { id: "finance", name: "Finance", x: 0, y: 18 },
  { id: "people", name: "People / HR", x: 7, y: 18 },
  { id: "legal", name: "Legal & Risk", x: 14, y: 18 },
] as const;

export function buildHqLayout(): FloorLayout {
  const b = new LayoutBuilder("hq", HQ_COLS, HQ_ROWS);

  b.room("ceo", "CEO", 0, 0, 9, 8, "gold")
    .room("coo", "COO", 9, 0, 7, 8, "wood")
    .room("board", "Board Room", 16, 0, 14, 8, "carpet")
    .room("corridor", "", 0, 8, 30, 2, "tile")
    .room("corridor2", "", 0, 16, 21, 2, "tile")
    .room("reception", "Reception", 21, 10, 9, 14, "tile");
  for (const d of DEPARTMENTS) b.room(d.id, d.name, d.x, d.y, 7, 6, "wood");

  b.wall("x", 8, 0, 9, "glass", [[6, 8]])
    .wall("x", 8, 9, 16, "glass", [[13, 15]])
    .wall("x", 8, 16, 30, "glass", [[17, 19]])
    .wall("y", 9, 0, 8)
    .wall("y", 16, 0, 8)
    .wall("x", 10, 0, 21, "glass", [[5, 7], [12, 14], [19, 21]])
    .wall("x", 18, 0, 21, "glass", [[5, 7], [12, 14], [19, 21]])
    .wall("y", 7, 10, 16)
    .wall("y", 14, 10, 16)
    .wall("y", 7, 18, 24)
    .wall("y", 14, 18, 24)
    .wall("y", 21, 10, 16, "glass")
    .wall("y", 21, 18, 24, "glass");

  b.execSeat(4, 2, "sw", "ceo", "ceo", PAL.gold);
  b.execSeat(12, 2, "sw", "coo", "manager");
  for (const d of DEPARTMENTS) b.deskSeat(d.x + 1, d.y + 1, "sw", d.id);
  for (const d of DEPARTMENTS) b.deskSeat(d.x + 3, d.y + 1, "sw", d.id);

  b.add("rug", 1, 4, 4, 3, "sw", PAL.goldDark);
  b.add("bookcase", 6, 0, 2, 1, "sw");
  b.add("plant", 8, 0);
  b.add("plant", 0, 0);
  b.add("sofa", 0, 5, 1, 2, "se");
  b.add("coffeeTable", 1, 5);
  b.add("bigPlant", 8, 6);

  b.add("bookcase", 13, 0, 2, 1, "sw");
  b.add("plant", 15, 0);
  b.add("armchair", 10, 5, 1, 1, "ne");
  b.add("armchair", 12, 5, 1, 1, "ne");
  b.add("plant", 15, 6);

  b.add("meetingTable", 19, 3, 8, 2);
  b.chairsAround(19, 3, 8, 2);
  b.add("tv", 21, 0, 4, 1, "sw");
  b.add("plant", 16, 0);
  b.add("bigPlant", 29, 0);
  b.add("plant", 29, 7);

  const [ops, care, accounts, finance, people, legal] = DEPARTMENTS;
  b.add("whiteboard", ops.x + 1, ops.y + 4, 3, 1, "sw");
  b.add("tv", care.x + 4, care.y + 4, 2, 1, "sw");
  b.add("sofa", accounts.x + 1, accounts.y + 4, 3, 1, "ne");
  b.add("safe", finance.x + 1, finance.y + 4);
  b.add("filing", finance.x + 2, finance.y + 4, 1, 1, "ne");
  b.add("filing", finance.x + 3, finance.y + 4, 1, 1, "ne");
  b.add("armchair", people.x + 1, people.y + 4, 1, 1, "ne");
  b.add("coffeeTable", people.x + 2, people.y + 4);
  b.add("armchair", people.x + 3, people.y + 4, 1, 1, "ne");
  b.add("bookcase", legal.x + 1, legal.y + 5, 3, 1, "sw");
  for (const d of DEPARTMENTS) b.add("plant", d.x + 6, d.y + 5);

  b.add("receptionDesk", 24, 12, 3, 1, "sw");
  b.add("rug", 24, 16, 4, 4, "sw", PAL.goldDark);
  b.add("sofa", 22, 16, 1, 3, "se");
  b.add("sofa", 29, 16, 1, 3, "nw");
  b.add("bigPlant", 29, 10);
  b.add("waterCooler", 29, 21);
  b.add("plant", 22, 23);
  b.add("plant", 29, 23);

  return b.build("reception");
}
