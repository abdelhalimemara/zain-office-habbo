import { Graphics } from "pixi.js";
import { toScreen } from "../iso";
import { walkGrid } from "../plan/grid";
import type { FloorPlan } from "../plan";

/** Dev aid: blocked tiles (red), seats (magenta, board gold) and idle spots (green) over the floor. */
export function drawFloorDebug(plan: FloorPlan): Graphics {
  const g = new Graphics();
  const grid = walkGrid(plan);
  const diamond = (x: number, y: number, inset: number, color: number, alpha: number) => {
    const pts = [toScreen(x + inset, y + inset), toScreen(x + 1 - inset, y + inset), toScreen(x + 1 - inset, y + 1 - inset), toScreen(x + inset, y + 1 - inset)];
    g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color, alpha });
  };
  for (let y = 0; y < plan.rows; y++) {
    for (let x = 0; x < plan.cols; x++) if (grid.blocked[y * plan.cols + x]) diamond(x, y, 0.05, 0xff3b3b, 0.22);
  }
  for (const s of plan.seats) diamond(s.x, s.y, 0.2, s.role === "board" ? 0xf2c230 : 0xff2bb4, 0.75);
  for (const s of plan.idle) diamond(s.x, s.y, 0.25, 0x22c55e, 0.85);
  return g;
}
