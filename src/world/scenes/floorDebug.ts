import { Graphics } from "pixi.js";
import type { FloorImage } from "../layouts/floorImages";

/** Dev aid: waypoint graph (blue), seats (magenta) and idle spots (green) over the floor image. */
export function drawFloorDebug(floor: FloorImage): Graphics {
  const g = new Graphics();
  const at = new Map<string, { x: number; y: number }>();
  for (const w of floor.waypoints) at.set(w.id, w);
  for (const w of floor.waypoints) {
    for (const l of w.links) {
      const o = at.get(l);
      if (o) g.moveTo(w.x, w.y).lineTo(o.x, o.y).stroke({ color: 0x2f6bff, width: 3, alpha: 0.8 });
    }
  }
  for (const s of [...floor.seats, ...floor.idle]) {
    const via = at.get(s.via);
    if (via) g.moveTo(s.x, s.y).lineTo(via.x, via.y).stroke({ color: 0x2fc6ff, width: 1.5, alpha: 0.7 });
  }
  for (const w of floor.waypoints) g.rect(w.x - 5, w.y - 5, 10, 10).fill(0x2f6bff);
  for (const s of floor.seats) g.circle(s.x, s.y, 6).fill(s.role === "board" ? 0xf2c230 : 0xff2bb4);
  for (const s of floor.idle) g.circle(s.x, s.y, 6).fill(0x22c55e);
  return g;
}
