import { DIVISION_IDS } from "../../shared/divisions";
import { appearanceFor, vacantAppearance } from "../../src/world/appearance";
import { floorLayout } from "../../src/world/layouts";
import { LABEL_REACH, labelObstacles, labelWidth, placeRoomLabels, tilesUnderLabels } from "../../src/world/labels";
import { loungeTiles } from "../../src/world/pathing";

const saturation = (c: number) => {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b);
};

describe("vacant agents", () => {
  it("are desaturated versions of the hired look", () => {
    const hired = appearanceFor("zain-studio-copy", "studio", "specialist");
    const vacant = vacantAppearance(hired);
    expect(saturation(vacant.shirt)).toBeLessThan(saturation(hired.shirt) / 2);
    expect(vacant.hairStyle).toBe(hired.hairStyle);
    expect(vacantAppearance(hired)).toEqual(vacant);
  });
});

describe("room labels", () => {
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it.each(DIVISION_IDS.map((d) => [d]))("sit on free floor in %s without covering furniture, walls, seats or each other", (division) => {
    const layout = floorLayout(division);
    const obstacles = labelObstacles(layout);
    const placed = placeRoomLabels(layout);
    expect(placed).toHaveLength(layout.rooms.filter((r) => r.name).length);
    for (const { room, at, rect } of placed) {
      expect(at.x >= room.x && at.y >= room.y).toBe(true);
      expect(at.x <= room.x + room.w - 1 + LABEL_REACH && at.y <= room.y + room.h - 1 + LABEL_REACH).toBe(true);
      expect(at.x <= layout.cols - 1 && at.y <= layout.rows - 1).toBe(true);
      expect(obstacles.filter((o) => overlaps(rect, o)), `${division}/${room.id}`).toEqual([]);
      expect(placed.filter((p) => p.rect !== rect && overlaps(rect, p.rect))).toEqual([]);
    }
  });

  it("is deterministic", () => {
    const a = placeRoomLabels(floorLayout("hq")).map((p) => p.at);
    expect(placeRoomLabels(floorLayout("hq")).map((p) => p.at)).toEqual(a);
    expect(labelWidth("LOUNGE")).toBeGreaterThan(20);
  });
});

describe("lounge spots and labels", () => {
  it.each(DIVISION_IDS.map((d) => [d]))("keeps idle agents in %s from resting under a label", (division) => {
    const layout = floorLayout(division);
    const under = tilesUnderLabels(layout);
    const tiles = loungeTiles(layout);
    expect(tiles.length).toBeGreaterThan(8);
    for (const t of tiles) expect(under.has(`${t.x},${t.y}`)).toBe(false);
  });
});
