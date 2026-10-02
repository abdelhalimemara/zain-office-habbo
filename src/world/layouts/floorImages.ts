import type { DivisionId } from "../../../shared/divisions";
import type { Pt, Rect } from "../iso";

/** A traced standing spot in floor-image pixels (feet position). `via` is the waypoint it is reached from. */
export interface FloorSpot extends Pt {
  id: string;
  via: string;
}

export type SeatRole = "ceo" | "manager" | "board";

export interface FloorSeat extends FloorSpot {
  role?: SeatRole;
  /** HQ department the seat belongs to (see HQ_TEAMS). */
  team?: string;
  /** Mirror the sprite so it faces down-right (towards the desk or table). */
  flip?: boolean;
}

export interface Waypoint extends Pt {
  id: string;
  links: readonly string[];
}

export interface FloorImage {
  division: DivisionId;
  width: number;
  height: number;
  /** Standing height of a person in image pixels (about one desk depth). */
  personHeight: number;
  seats: readonly FloorSeat[];
  idle: readonly FloorSpot[];
  waypoints: readonly Waypoint[];
}

/** HQ leads work in their department's room. */
export const HQ_TEAMS: Readonly<Record<string, string>> = {
  "zain-hq-ops": "ops",
  "zain-hq-care": "accounts",
  "zain-hq-accounts": "accounts",
  "zain-hq-finance": "finance",
  "zain-hq-people": "hr",
  "zain-hq-legal": "legal",
};

const seat = (id: string, x: number, y: number, via: string, extra: Omit<FloorSeat, "id" | "x" | "y" | "via"> = {}): FloorSeat => ({
  id,
  x,
  y,
  via,
  ...extra,
});
const spot = (id: string, x: number, y: number, via: string): FloorSpot => ({ id, x, y, via });
const wp = (id: string, x: number, y: number, ...links: string[]): Waypoint => ({ id, x, y, links });

const hq: FloorImage = {
  division: "hq",
  width: 1974,
  height: 1176,
  personHeight: 70,
  seats: [
    seat("board-1", 375, 130, "b1", { role: "board" }),
    seat("board-2", 426, 130, "b1", { role: "board" }),
    seat("board-3", 479, 130, "b1", { role: "board" }),
    seat("board-4", 298, 214, "b1", { role: "board", flip: true }),
    seat("board-5", 556, 210, "b1", { role: "board" }),
    seat("ceo", 1560, 885, "x1", { role: "ceo", flip: true }),
    seat("coo", 1772, 880, "x1", { role: "manager" }),
    seat("finance", 1660, 160, "f1", { team: "finance" }),
    seat("hr", 1660, 360, "h1", { team: "hr" }),
    seat("legal", 1733, 568, "l1", { team: "legal" }),
    seat("ops-1", 190, 595, "o1", { team: "ops", flip: true }),
    seat("ops-2", 330, 598, "o1", { team: "ops" }),
    seat("ops-3", 398, 605, "o1", { team: "ops", flip: true }),
    seat("ops-4", 530, 605, "o1", { team: "ops" }),
    seat("acc-1", 160, 850, "a1", { team: "accounts", flip: true }),
    seat("acc-2", 282, 852, "a1", { team: "accounts" }),
    seat("acc-3", 405, 852, "a1", { team: "accounts" }),
    seat("acc-4", 530, 852, "a1", { team: "accounts" }),
    seat("acc-5", 160, 925, "a1", { team: "accounts", flip: true }),
    seat("acc-6", 530, 925, "a1", { team: "accounts" }),
  ],
  idle: [
    spot("i-cafe", 760, 350, "c1"),
    spot("i-sofa-l", 960, 335, "c2"),
    spot("i-sofa-r", 1175, 335, "c3"),
    spot("i-bar", 1040, 198, "c4"),
    spot("i-common", 890, 450, "c2"),
    spot("i-print", 1300, 525, "e2"),
    spot("i-recep-l", 800, 865, "r2"),
    spot("i-recep-r", 1130, 860, "r3"),
    spot("i-recep-c", 960, 768, "r1"),
  ],
  waypoints: [
    wp("r1", 960, 790, "r2", "r3"),
    wp("r2", 745, 820, "c1", "k2"),
    wp("r3", 1180, 820, "c3", "e3"),
    wp("c1", 720, 470, "c2", "k1", "b1"),
    wp("c2", 990, 455, "c3", "c4"),
    wp("c3", 1180, 455, "e1"),
    wp("c4", 1000, 195, "e0"),
    wp("k1", 700, 620, "k2", "o1"),
    wp("k2", 700, 860, "a1"),
    wp("o1", 600, 640),
    wp("a1", 585, 890),
    wp("b1", 585, 300),
    wp("e0", 1345, 200, "e1", "f1"),
    wp("e1", 1345, 420, "e2", "h1"),
    wp("e2", 1385, 560, "e3", "l1"),
    wp("e3", 1390, 800, "x1"),
    wp("f1", 1440, 215),
    wp("h1", 1450, 420),
    wp("l1", 1470, 640),
    wp("x1", 1500, 820),
  ],
};

const studio: FloorImage = {
  division: "studio",
  width: 1913,
  height: 1415,
  personHeight: 92,
  seats: [
    seat("manager", 1470, 412, "mgr", { role: "manager" }),
    seat("desk-a1", 932, 459, "north"),
    seat("desk-a2", 1024, 479, "north"),
    seat("desk-a3", 1084, 503, "north"),
    seat("desk-a4", 1164, 531, "north"),
    seat("desk-a5", 1272, 567, "north"),
    seat("desk-a6", 1360, 603, "north"),
    seat("desk-b1", 772, 603, "aisle"),
    seat("desk-b2", 852, 631, "aisle"),
    seat("desk-b3", 932, 667, "aisle"),
    seat("desk-b4", 1016, 695, "aisle"),
    seat("desk-b5", 1096, 723, "aisle"),
    seat("desk-b6", 1180, 759, "aisle"),
  ],
  idle: [
    spot("i-kitchen", 600, 600, "west"),
    spot("i-island", 300, 660, "west"),
    spot("i-lounge", 460, 730, "center"),
    spot("i-reception", 1000, 1020, "south"),
    spot("i-dining", 1300, 790, "east"),
    spot("i-chairs", 1560, 540, "east"),
  ],
  waypoints: [
    wp("west", 580, 560, "center", "aisle", "nw"),
    wp("aisle", 700, 600),
    wp("nw", 790, 440, "north"),
    wp("center", 600, 790, "front"),
    wp("front", 1000, 930, "south"),
    wp("south", 1180, 990, "east"),
    wp("east", 1450, 700, "ne"),
    wp("ne", 1440, 600, "north"),
    wp("north", 1150, 430, "mgr"),
    wp("mgr", 1185, 455),
  ],
};

const growth: FloorImage = {
  division: "growth",
  width: 1981,
  height: 1166,
  personHeight: 78,
  seats: [
    seat("manager", 1540, 225, "mgr", { role: "manager" }),
    seat("desk-a1", 430, 505, "g1"),
    seat("desk-a2", 530, 505, "g1"),
    seat("desk-a3", 640, 500, "g1"),
    seat("desk-b1", 540, 735, "g3"),
    seat("desk-b2", 620, 735, "g3"),
    seat("desk-c0", 1290, 470, "g2", { flip: true }),
    seat("desk-c1", 1440, 515, "g2"),
    seat("desk-c2", 1580, 540, "g2"),
    seat("desk-d1", 1405, 730, "g4"),
    seat("desk-d2", 1520, 730, "g4"),
    seat("desk-d3", 1650, 725, "g4"),
  ],
  idle: [
    spot("i-lounge", 870, 310, "g5"),
    spot("i-lounge2", 1080, 320, "g6"),
    spot("i-table", 790, 520, "g1"),
    spot("i-rug", 560, 860, "g3"),
    spot("i-bar", 420, 740, "g3"),
    spot("i-open", 1200, 600, "g2"),
    spot("i-entry", 1190, 770, "g4"),
  ],
  waypoints: [
    wp("g5", 730, 330, "g6", "g1"),
    wp("g6", 1200, 330, "g2", "mgr"),
    wp("g1", 730, 540, "g2", "g3"),
    wp("g2", 1200, 540, "g4"),
    wp("g3", 730, 760),
    wp("g4", 1200, 760),
    wp("mgr", 1340, 345),
  ],
};

const labs: FloorImage = {
  division: "labs",
  width: 1954,
  height: 1496,
  personHeight: 100,
  seats: [
    seat("manager", 1340, 790, "mgr", { role: "manager" }),
    seat("desk-a1", 345, 900, "L5"),
    seat("desk-a2", 455, 840, "L5"),
    seat("desk-a3", 560, 780, "L5"),
    seat("desk-b1", 505, 1080, "L6"),
    seat("desk-b2", 615, 1040, "L6"),
    seat("desk-b3", 725, 990, "L6"),
    seat("table-1", 690, 730, "L1"),
    seat("table-2", 760, 770, "L1"),
    seat("table-3", 830, 800, "L1"),
    seat("meet-1", 900, 1090, "mtg", { flip: true }),
    seat("meet-2", 1175, 1150, "mtg"),
  ],
  idle: [
    spot("i-lounge", 1040, 610, "L4"),
    spot("i-sofa", 1100, 460, "L4"),
    spot("i-shelf", 980, 390, "L4"),
    spot("i-open", 1000, 780, "L2"),
    spot("i-recep", 1280, 612, "L3"),
  ],
  waypoints: [
    wp("L5", 620, 790, "L1"),
    wp("L1", 800, 860, "L2", "L6"),
    wp("L6", 790, 960),
    wp("L2", 1000, 780, "L3", "L4", "mgr", "mtg"),
    wp("L3", 1180, 640),
    wp("L4", 980, 660),
    wp("mgr", 1130, 770),
    wp("mtg", 1000, 930),
  ],
};

const tech: FloorImage = {
  division: "tech",
  width: 1923,
  height: 1363,
  personHeight: 92,
  seats: [
    seat("manager", 1723, 612, "mgr", { role: "manager" }),
    seat("desk-a1", 974, 495, "t6"),
    seat("desk-a2", 1035, 456, "t6"),
    seat("desk-a3", 1092, 422, "t6"),
    seat("desk-a4", 1144, 387, "t6"),
    seat("desk-b1", 1157, 643, "t2"),
    seat("desk-b2", 1213, 608, "t2"),
    seat("desk-b3", 1274, 565, "t2"),
    seat("desk-b4", 1326, 535, "t2"),
    seat("desk-c1", 1344, 782, "t3"),
    seat("desk-c2", 1387, 748, "t3"),
    seat("desk-c3", 1457, 708, "t3"),
  ],
  idle: [
    spot("i-lounge", 790, 920, "t5"),
    spot("i-sofa", 940, 425, "t6"),
    spot("i-open", 900, 620, "t1"),
    spot("i-whiteboard", 1180, 850, "t3"),
  ],
  waypoints: [
    wp("t6", 960, 460, "t1", "t7"),
    wp("t1", 880, 620, "t2", "t9"),
    wp("t2", 1100, 620, "t3"),
    wp("t3", 1250, 760),
    wp("t5", 690, 880),
    wp("t7", 1300, 470, "mgr"),
    wp("mgr", 1560, 580),
    wp("t9", 700, 670, "t5"),
  ],
};

export const FLOOR_IMAGES: Readonly<Record<DivisionId, FloorImage>> = { hq, studio, growth, labs, tech };

export function floorImage(division: DivisionId): FloorImage {
  return FLOOR_IMAGES[division];
}

export function floorBounds(floor: FloorImage): Rect {
  return { x: 0, y: 0, w: floor.width, h: floor.height };
}
