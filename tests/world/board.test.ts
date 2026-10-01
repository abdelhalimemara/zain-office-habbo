import { ROSTER, agentsInDivision, boardMembers } from "../../shared/roster";
import { BOARD_HAIR_STYLES, appearanceFor } from "../../src/world/appearance";
import { diffAgents } from "../../src/world/diff";
import { FACING_VEC, NON_BLOCKING, floorLayout, roomAt } from "../../src/world/layouts";
import { BOARD_SEATS } from "../../src/world/layouts/hq";
import { pixelTextSupports } from "../../src/world/pixelFont";
import { findPath, loungeTiles } from "../../src/world/pathing";
import { assignSeats } from "../../src/world/seating";

const hq = floorLayout("hq");
const boardSeats = hq.seats.filter((s) => s.role === "board");

describe("board room seats", () => {
  it("has exactly five board seats at the board-room table", () => {
    expect(boardSeats).toHaveLength(BOARD_SEATS);
    expect(BOARD_SEATS).toBe(5);
    for (const s of boardSeats) {
      expect(s.room).toBe("board");
      expect(roomAt(hq, s.x, s.y)?.id).toBe("board");
      const table = hq.furniture.find((f) => f.id === s.desk)!;
      expect(table.kind).toBe("meetingTable");
      const v = FACING_VEC[s.facing];
      const tx = s.x + v.dx;
      const ty = s.y + v.dy;
      expect(tx >= table.x && tx < table.x + table.w && ty >= table.y && ty < table.y + table.d).toBe(true);
    }
  });

  it("keeps board seats free of furniture and walls", () => {
    for (const s of boardSeats) {
      for (const f of hq.furniture) {
        if (NON_BLOCKING.has(f.kind)) continue;
        const covers = s.x >= f.x && s.x < f.x + f.w && s.y >= f.y && s.y < f.y + f.d;
        expect(covers, `${f.id} on board seat ${s.x},${s.y}`).toBe(false);
      }
      const v = FACING_VEC[s.facing];
      const edge = v.dy !== 0 ? { axis: "x", at: s.y + Math.max(0, v.dy), along: s.x } : { axis: "y", at: s.x + Math.max(0, v.dx), along: s.y };
      const blocked = hq.walls.some((w) => w.axis === edge.axis && w.at === edge.at && edge.along >= w.from && edge.along < w.to);
      expect(blocked, `wall between board seat ${s.x},${s.y} and the table`).toBe(false);
      expect(findPath(hq, s, loungeTiles(hq)[0]!), `board seat ${s.x},${s.y} reachable`).not.toBeNull();
    }
  });

  it("seats the board in roster order, never at a department desk", () => {
    const candidates = [
      ...agentsInDivision("hq"),
      ...["zain-board-b", "zain-board-c", "zain-board-d", "zain-board-e", "zain-board-f"].map((profile) => ({
        profile,
        rank: "board" as const,
      })),
    ];
    const { seats, overflow } = assignSeats(hq, candidates);
    const hormozi = boardMembers()[0]!;
    expect(seats.get(hormozi.profile)?.id).toBe(boardSeats[0]!.id);
    for (const p of ["zain-board-b", "zain-board-c", "zain-board-d", "zain-board-e"]) expect(seats.get(p)?.role).toBe("board");
    expect(overflow).toEqual(["zain-board-f"]);
    for (const a of agentsInDivision("hq").filter((a) => a.rank === "lead")) expect(seats.get(a.profile)?.role).toBeUndefined();
  });
});

describe("board avatars", () => {
  it("wear a distinct, deterministic board look", () => {
    const a = appearanceFor("zain-board-hormozi", "hq", "board");
    expect(a).toEqual(appearanceFor("zain-board-hormozi", "hq", "board"));
    expect(a.outfit).toBe("board");
    expect(BOARD_HAIR_STYLES).toContain(a.hairStyle);
    expect(appearanceFor("zain-hq-coo", "hq", "vp").outfit).toBe("suit");
    expect(appearanceFor("zain-hq-coo", "hq", "vp").glasses).toBe(false);
  });

  it("keeps everyone else's look unchanged by the board styles", () => {
    for (const r of ROSTER.filter((x) => x.rank !== "board")) {
      expect(appearanceFor(r.profile, r.division, r.rank).hairStyle).not.toBe("receding");
    }
  });

  it("is accepted by the world's agent diffing and renders its title", () => {
    const hormozi = ROSTER.find((r) => r.rank === "board")!;
    expect(hormozi.title).toBe("Board · Alex Hormozi");
    expect(pixelTextSupports(hormozi.title)).toBe(true);
    const d = diffAgents(new Map(), [{ ...hormozi, activity: "working", hired: true }]);
    expect(d.added.map((x) => x.profile)).toEqual([hormozi.profile]);
  });
});
