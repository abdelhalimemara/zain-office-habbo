import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faceSource, projectFaces, standBox } from "../../src/world/avatars/faces";
import { REST_RIG } from "../../src/world/avatars/model";
import { rigFor } from "../../src/world/avatars/rig";
import { AVATAR_KEYS, specFor } from "../../src/world/avatars/specs";

const atlasPath = (key: string, ext: string) => `src/world/avatars/atlas/${key.replace("/", "-")}.${ext}`;

describe("reference texture atlases", () => {
  it("exist for every character and stay small", () => {
    for (const k of AVATAR_KEYS) {
      expect(statSync(atlasPath(k, "webp")).size, k).toBeLessThan(40 * 1024);
      const meta = JSON.parse(readFileSync(atlasPath(k, "json"), "utf8"));
      expect(meta.fit).toHaveLength(4);
    }
  });

  it("hold a texture for every face visible in the standing reference view", () => {
    for (const k of AVATAR_KEYS) {
      const meta = JSON.parse(readFileSync(atlasPath(k, "json"), "utf8"));
      for (const f of projectFaces(specFor(k), REST_RIG, "SW")) {
        const rect = meta.faces[f.part.name]?.[f.face];
        expect(rect, `${k} ${f.part.name} ${f.face}`).toBeDefined();
        expect(rect[2]).toBeGreaterThan(0);
      }
    }
  });
});

describe("textured faces", () => {
  it("show only front, side and top in the standing SW view, back to front, unshaded", () => {
    const faces = projectFaces(specFor("board/bezos"), REST_RIG, "SW");
    expect(new Set(faces.map((f) => f.face))).toEqual(new Set(["front", "side", "top"]));
    for (let i = 1; i < faces.length; i++) expect(faces[i]!.depth).toBeGreaterThanOrEqual(faces[i - 1]!.depth);
    for (const f of faces) expect(f.tint).toBeCloseTo(1, 6);
  });

  it("synthesise back faces from captured ones in the back view and darken them", () => {
    const faces = projectFaces(specFor("people/male-1"), REST_RIG, "NW");
    const back = faces.filter((f) => f.face === "back");
    expect(back.length).toBeGreaterThan(3);
    for (const f of faces) expect(f.tint).toBeLessThanOrEqual(1);
    expect(faceSource("back").src).toBe("side");
    expect(faceSource("rside")).toEqual({ src: "side", flipU: true });
    expect(faceSource("bottom").src).toBe("top");
  });

  it("keeps texture boxes fixed while limbs move", () => {
    const spec = specFor("board/jobs");
    const walk = projectFaces(spec, rigFor("walk", 1, "none", 0, 33, 16), "SW");
    for (const f of walk) expect(f.box).toBe(standBox(spec, f.part.name) ?? f.box);
    const thigh = walk.find((f) => f.part.name === "thighR" && f.face === "front")!;
    const still = projectFaces(spec, REST_RIG, "SW").find((f) => f.part.name === "thighR" && f.face === "front")!;
    expect(Math.hypot(thigh.eu[0], thigh.eu[1])).toBeCloseTo(Math.hypot(still.eu[0], still.eu[1]), 6);
    expect(thigh.ev).not.toEqual(still.ev);
  });
});
