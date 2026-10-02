import { writeFileSync } from "node:fs";
import { projectFaces, type Box3, type ProjectedFace } from "../faces";
import { buildMesh, REST_RIG } from "../model";
import { volumeOf } from "../raster";
import { AVATAR_KEYS, specFor } from "../specs";

/** Usage: tsx exportRig.ts <out.json> — stand-pose (SW) face geometry and surface colours for bakeAtlases.py. */
function surface(f: ProjectedFace): { cols: number; rows: number; data: number[] } {
  const p = f.part;
  const vol = volumeOf(p);
  const k: Box3 = f.box;
  const at = (a: number, b: number, c: number) => vol[(c * p.d + b) * p.w + a]! - 1;
  const data: number[] = [];
  let cols = 0;
  let rows = 0;
  if (f.face === "front") {
    cols = k.a1 - k.a0;
    rows = k.c1 - k.c0;
    for (let c = k.c1 - 1; c >= k.c0; c--)
      for (let a = k.a0; a < k.a1; a++) {
        let col = -1;
        for (let b = k.b1 - 1; b >= k.b0 && col < 0; b--) col = at(a, b, c);
        data.push(col);
      }
  } else if (f.face === "side") {
    cols = k.b1 - k.b0;
    rows = k.c1 - k.c0;
    for (let c = k.c1 - 1; c >= k.c0; c--)
      for (let b = k.b1 - 1; b >= k.b0; b--) {
        let col = -1;
        for (let a = k.a1 - 1; a >= k.a0 && col < 0; a--) col = at(a, b, c);
        data.push(col);
      }
  } else {
    cols = k.a1 - k.a0;
    rows = k.b1 - k.b0;
    for (let b = k.b0; b < k.b1; b++)
      for (let a = k.a0; a < k.a1; a++) {
        let col = -1;
        for (let c = k.c1 - 1; c >= k.c0 && col < 0; c--) col = at(a, b, c);
        data.push(col);
      }
  }
  return { cols, rows, data };
}

const out = AVATAR_KEYS.map((key) => {
  const spec = specFor(key);
  const mesh = buildMesh(spec, REST_RIG, "SW");
  const faces = projectFaces(spec, REST_RIG, "SW").map((f) => ({
    part: f.part.name,
    face: f.face,
    o: f.o,
    eu: f.eu,
    ev: f.ev,
    surface: surface(f),
  }));
  return { key, bounds: [mesh.minX, mesh.minY, mesh.maxX, mesh.maxY], quads: Array.from(mesh.pts, (v) => Math.round(v * 1000) / 1000), faces };
});
writeFileSync(process.argv[2] ?? "rig.json", JSON.stringify(out));
