import { describe, expect, it } from "vitest";
import { BOARD_SPRITE_BY_PROFILE, BOARD_SPRITES, CEO_SPRITE, WORKER_SPRITES, spriteFor } from "../../src/world/characters";
import { bodyOf } from "../../src/world/avatars/body";
import { standHeightUnits, unitFor } from "../../src/world/avatars/cache";
import { mul, rasterize, VoxelGrid } from "../../src/world/avatars/raster";
import { buildMesh, buildParts, facingMatrix, farSide, legLength, REST_RIG, seatHeight, type PartName } from "../../src/world/avatars/model";
import { rigFor } from "../../src/world/avatars/rig";
import { AVATAR_KEYS, AVATAR_SPECS, specFor } from "../../src/world/avatars/specs";
import { FACINGS, type AvatarSpec, type Facing } from "../../src/world/avatars/types";

const SYMMETRIC: AvatarSpec = {
  key: "board/bezos",
  skin: 0xf0b482,
  hair: { style: "bald", color: 0x222222 },
  top: { kind: "suit", color: 0x2f3846, tie: 0x992222, vDepth: 0.6 },
  bottom: { kind: "trousers", color: 0x323b46, belt: 0x111111 },
  shoes: { kind: "dress", color: 0x4a3a2e },
  accessories: [],
};

describe("avatar specs", () => {
  it("cover exactly the sprite keys used by characters.ts", () => {
    const expected = [...WORKER_SPRITES.map((k) => `people/${k}`), ...BOARD_SPRITES.map((k) => `board/${k}`)].sort();
    expect([...AVATAR_KEYS].sort()).toEqual(expected);
    expect(Object.keys(AVATAR_SPECS).sort()).toEqual(expected);
    for (const k of AVATAR_KEYS) expect(specFor(k).key).toBe(k);
  });

  it("resolve every board profile, the CEO and hashed workers", () => {
    for (const board of Object.values(BOARD_SPRITE_BY_PROFILE)) expect(AVATAR_SPECS[`board/${board}`]).toBeDefined();
    expect(AVATAR_SPECS[CEO_SPRITE]).toBeDefined();
    for (const p of ["zain-dev-1", "zain-ops-7", "someone-else"]) expect(AVATAR_SPECS[spriteFor(p, "worker" as never)]).toBeDefined();
  });

  it("keep every leg, shin and arm on whole voxels", () => {
    for (const k of AVATAR_KEYS) {
      const d = bodyOf(specFor(k));
      expect(Number.isInteger(d.hipX - d.thighW / 2), k).toBe(true);
      expect(Number.isInteger(d.torsoW / 2) && Number.isInteger(d.headW / 2) && Number.isInteger(d.headD / 2), k).toBe(true);
    }
  });
});

describe("voxel model", () => {
  it("normalises every character to the requested standing height", () => {
    for (const k of AVATAR_KEYS) {
      const spec = specFor(k);
      const mesh = buildMesh(spec, REST_RIG, "SW");
      expect((mesh.maxY - mesh.minY) * unitFor(spec, 96)).toBeCloseTo(96, 6);
      expect(mesh.count).toBeGreaterThan(500);
    }
  });

  it("keeps the feet at the origin and the body centred over them", () => {
    for (const k of AVATAR_KEYS) {
      const mesh = buildMesh(specFor(k), REST_RIG, "SW");
      expect(mesh.maxY).toBeGreaterThan(0);
      expect(mesh.maxY).toBeLessThan(mesh.maxY - mesh.minY);
      expect(mesh.minX).toBeLessThan(0);
      expect(mesh.maxX).toBeGreaterThan(0);
    }
  });

  it("gives the head about a third of the on-screen height", () => {
    for (const k of AVATAR_KEYS) {
      const spec = specFor(k);
      const full = buildMesh(spec, REST_RIG, "SW");
      const head = buildMesh(spec, REST_RIG, "SW", (p) => p.name === "head" || p.name === "neck");
      const chin = (head.maxY - full.minY) / (full.maxY - full.minY);
      expect(chin, k).toBeGreaterThan(0.3);
      expect(chin, k).toBeLessThan(0.48);
      expect(head.minY).toBeCloseTo(full.minY, 6);
    }
  });

  it("keeps similar voxel scales across characters at one height", () => {
    const units = AVATAR_KEYS.map((k) => standHeightUnits(specFor(k)));
    expect(Math.max(...units) / Math.min(...units)).toBeLessThan(1.25);
  });

  it("emits faces back to front", () => {
    for (const f of FACINGS) {
      const mesh = buildMesh(specFor("board/alwaleed"), rigFor("walk", 1, "wave", 2, 33, 16), f);
      for (let i = 1; i < mesh.count; i++) expect(mesh.depth[i]!).toBeGreaterThanOrEqual(mesh.depth[i - 1]!);
    }
  });
});

function quadKeys(spec: AvatarSpec, facing: Facing, mirror: boolean): string[] {
  const m = buildMesh(spec, REST_RIG, facing);
  const keys: string[] = [];
  for (let i = 0; i < m.count; i++) {
    const pts: string[] = [];
    for (let k = 0; k < 4; k++) pts.push(`${(mirror ? -1 : 1) * m.pts[i * 8 + k * 2]! + 0}:${m.pts[i * 8 + k * 2 + 1]}`);
    keys.push(pts.sort().join("|"));
  }
  return keys.sort();
}

describe("facings", () => {
  it("SE is the mirror image of SW and NE of NW for a symmetric character", () => {
    expect(quadKeys(SYMMETRIC, "SE", false)).toEqual(quadKeys(SYMMETRIC, "SW", true));
    expect(quadKeys(SYMMETRIC, "NE", false)).toEqual(quadKeys(SYMMETRIC, "NW", true));
  });

  it("shows the face from the front facings and the back of the head from the back facings", () => {
    const spec = specFor("board/bezos");
    const eyes = (f: Facing) => {
      const m = buildMesh(spec, REST_RIG, f, (p) => p.name === "head");
      let n = 0;
      for (let i = 0; i < m.count; i++) {
        const c = m.colors[i]!;
        if (((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255) < 120) n++;
      }
      return n;
    };
    expect(eyes("SW")).toBeGreaterThan(12);
    expect(eyes("SE")).toBeGreaterThan(12);
    expect(eyes("NW")).toBeLessThan(eyes("SW") / 3);
    expect(eyes("NE")).toBeLessThan(eyes("SE") / 3);
  });

  it("puts the far arm behind the torso and the near arm in front of it", () => {
    const spec = specFor("people/male-1");
    const depthOf = (f: Facing, name: PartName) => {
      const grid = new VoxelGrid();
      grid.clear();
      const part = buildParts(spec, REST_RIG).find((p) => p.name === name)!;
      rasterize(grid, { ...part, m: mul(facingMatrix(f), part.m) });
      let sum = 0;
      let n = 0;
      for (let z = grid.min[2]!; z <= grid.max[2]!; z++)
        for (let y = grid.min[1]!; y <= grid.max[1]!; y++)
          for (let x = grid.min[0]!; x <= grid.max[0]!; x++) {
            if (!grid.get(x, y, z)) continue;
            sum += x + y;
            n++;
          }
      return sum / n;
    };
    for (const f of FACINGS) {
      const far = farSide(f);
      const near = far === "R" ? "L" : "R";
      expect(depthOf(f, `upper${far}`), f).toBeLessThan(depthOf(f, "torso"));
      expect(depthOf(f, `upper${near}`), f).toBeGreaterThan(depthOf(f, "torso"));
    }
  });
});

describe("poses", () => {
  it("sits with horizontal thighs on a seat lower than the standing hips", () => {
    for (const k of AVATAR_KEYS) {
      const spec = specFor(k);
      const d = bodyOf(spec);
      const rig = rigFor("sit", 0, "none", 0, legLength(d), d.thighLen);
      expect(rig.hipL).toBe(90);
      expect(rig.kneeL).toBe(90);
      expect(rig.drop).toBe(d.thighLen);
      expect(seatHeight(spec)).toBeGreaterThan(0);
      expect(seatHeight(spec)).toBeLessThan(legLength(d) - rig.drop);
    }
  });

  it("keeps the walking feet on the floor", () => {
    const spec = specFor("people/male-2");
    const stand = buildMesh(spec, REST_RIG, "SW");
    const d = bodyOf(spec);
    for (let f = 0; f < 6; f++) {
      const walk = buildMesh(spec, rigFor("walk", f, "none", 0, legLength(d), d.thighLen), "SW");
      expect(Math.abs(walk.maxY - stand.maxY)).toBeLessThan(6);
    }
  });

  it("raises an arm above the head when waving", () => {
    const spec = specFor("people/female-3");
    const d = bodyOf(spec);
    const head = buildMesh(spec, REST_RIG, "SW", (p) => p.name === "head");
    const arm = buildMesh(spec, rigFor("stand", 0, "wave", 2, legLength(d), d.thighLen), "SW", (p) => p.name === "foreL");
    const rest = buildMesh(spec, REST_RIG, "SW", (p) => p.name === "foreL");
    expect(arm.minY).toBeLessThan((head.minY + head.maxY) / 2);
    expect(rest.minY).toBeGreaterThan(head.maxY);
  });
});
