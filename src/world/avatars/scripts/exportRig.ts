import { writeFileSync } from "node:fs";
import { facePoint, projectFaces, texBox, type Box3, type FaceName } from "../faces";
import { buildMesh, buildParts, REST_RIG, type NamedPart } from "../model";
import { volumeOf } from "../raster";
import { AVATAR_KEYS, specFor } from "../specs";

/** Usage: tsx exportRig.ts <out.json> — stand-pose (SW) face geometry and surface colours for bakeAtlases.py. */
function surface(p: NamedPart, k: Box3, face: FaceName): { cols: number; rows: number; data: number[] } {
  const vol = volumeOf(p);
  const at = (a: number, b: number, c: number) => vol[(c * p.d + b) * p.w + a]! - 1;
  const W = k.a1 - k.a0;
  const D = k.b1 - k.b0;
  const H = k.c1 - k.c0;
  const [cols, rows] = face === "front" || face === "back" ? [W, H] : face === "side" || face === "rside" ? [D, H] : [W, D];
  const data: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const [a, b, c] = facePoint(k, face, (q + 0.5) / cols, (r + 0.5) / rows).map(Math.floor) as [number, number, number];
      let col = -1;
      if (face === "front" || face === "back") for (let y = 0; y < D && col < 0; y++) col = at(a, face === "front" ? k.b1 - 1 - y : k.b0 + y, c);
      else if (face === "side" || face === "rside") for (let x = 0; x < W && col < 0; x++) col = at(face === "side" ? k.a1 - 1 - x : k.a0 + x, b, c);
      else for (let z = 0; z < H && col < 0; z++) col = at(a, b, face === "top" ? k.c1 - 1 - z : k.c0 + z);
      data.push(col);
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
    surface: surface(f.part, f.box, f.face),
  }));
  const parts = buildParts(spec, REST_RIG).map((p) => {
    const box = texBox(p);
    return { part: p.name, back: surface(p, box, "back"), rside: surface(p, box, "rside") };
  });
  return { key, bounds: [mesh.minX, mesh.minY, mesh.maxX, mesh.maxY], quads: Array.from(mesh.pts, (v) => Math.round(v * 1000) / 1000), faces, parts };
});
writeFileSync(process.argv[2] ?? "rig.json", JSON.stringify(out));
