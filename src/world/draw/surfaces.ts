import type { Graphics } from "pixi.js";
import { hashString } from "../hash";
import { BACK_WALL_H, isBackWall, wallBox } from "../plan/boxes";
import type { FloorPlan, Material, Wall } from "../plan";
import { box, faceX, faceY, mix, shade, top } from "./iso3d";

export const MATERIALS: Record<Material, { base: number; line: number }> = {
  oak: { base: 0xc9a47c, line: 0xae8862 },
  walnut: { base: 0x7d5639, line: 0x5f3f29 },
  marble: { base: 0xe9e4dd, line: 0xd2cac0 },
  stone: { base: 0xbab7b2, line: 0x9f9c97 },
  carpet: { base: 0x8f8d89, line: 0x7f7d79 },
  carpetDark: { base: 0x4a4c50, line: 0x3e4044 },
};

export const WALL = { face: 0x2f3237, side: 0x25282c, cap: 0x6f737a, plaster: 0xe9e3da, plasterShade: 0xd9d2c7 };
export const GLASS = { pane: 0xcfdde3, frame: 0x2b2e33 };

/** Tile-hash noise in [0, 1). */
function noise(x: number, y: number, salt: number): number {
  return (hashString(`${x},${y},${salt}`) % 1000) / 1000;
}

function floorTile(g: Graphics, x: number, y: number, m: Material): void {
  const { base, line } = MATERIALS[m];
  if (m === "oak" || m === "walnut") {
    for (let p = 0; p < 3; p++) {
      const v = noise(x, y * 3 + p, 1) * 0.08 - 0.04;
      top(g, x, y + p / 3, x + 1, y + (p + 1) / 3, 0, shade(base, v));
      top(g, x, y + (p + 1) / 3 - 0.012, x + 1, y + (p + 1) / 3 + 0.012, 0, line, 0.55);
      const seam = noise(x, y * 3 + p, 2);
      if (seam > 0.45) top(g, x + seam - 0.01, y + p / 3, x + seam + 0.01, y + (p + 1) / 3, 0, line, 0.5);
    }
    return;
  }
  if (m === "marble" || m === "stone") {
    const v = noise(x, y, 3) * 0.05 - 0.025;
    top(g, x, y, x + 1, y + 1, 0, shade(base, v));
    top(g, x, y, x + 1, y + 0.02, 0, line, 0.8);
    top(g, x, y, x + 0.02, y + 1, 0, line, 0.8);
    if (m === "marble" && noise(x, y, 4) > 0.55) {
      const a = noise(x, y, 5);
      top(g, x + a * 0.6, y + 0.2, x + a * 0.6 + 0.5, y + 0.24, 0, 0xc4bbb0, 0.6);
    }
    return;
  }
  top(g, x, y, x + 1, y + 1, 0, base);
  for (let i = 0; i < 6; i++) {
    const px = x + noise(x, y, 10 + i);
    const py = y + noise(x, y, 20 + i);
    top(g, px, py, Math.min(x + 1, px + 0.06), Math.min(y + 1, py + 0.06), 0, line, 0.7);
  }
}

/** Floor finishes, the slab edge and the tall back walls (always behind everything). */
export function drawFloorBase(g: Graphics, plan: FloorPlan): void {
  const { cols, rows } = plan;
  const slab = 0.3;
  faceY(g, rows, 0, cols, -slab, 0, 0x34373c);
  faceX(g, cols, 0, rows, -slab, 0, 0x2a2d31);
  faceY(g, rows, 0, cols, -0.04, 0, 0x55585e);
  faceX(g, cols, 0, rows, -0.04, 0, 0x4a4d52);
  const material: (Material | null)[] = new Array(cols * rows).fill(null);
  for (const z of plan.zones) {
    for (let y = z.y; y < z.y + z.d; y++) for (let x = z.x; x < z.x + z.w; x++) material[y * cols + x] = z.material;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) floorTile(g, x, y, material[y * cols + x] ?? "stone");
}

export function drawBackWalls(g: Graphics, plan: FloorPlan): void {
  const H = BACK_WALL_H;
  const t = 0.18;
  for (const w of plan.walls.filter(isBackWall)) {
    if (w.axis === "x") {
      box(g, w.from - (w.from === 0 ? t : 0), -t, w.to, 0, 0, H, WALL.face, { left: WALL.plaster, right: WALL.side, top: WALL.cap, gradient: false });
      faceY(g, 0, w.from, w.to, 0, 0.12, 0x3a3d42);
      faceY(g, 0, w.from, w.to, H - 0.08, H, WALL.plasterShade);
    } else {
      box(g, -t, w.from, 0, w.to, 0, H, WALL.face, { left: WALL.side, right: mix(WALL.plaster, 0x000000, 0.06), top: WALL.cap, gradient: false });
      faceX(g, 0, w.from, w.to, 0, 0.12, 0x34373c);
      faceX(g, 0, w.from, w.to, H - 0.08, H, mix(WALL.plasterShade, 0x000000, 0.05));
    }
  }
}

export function drawWall(g: Graphics, w: Wall): void {
  const b = wallBox(w);
  if (w.kind !== "glass") {
    box(g, b.x0, b.y0, b.x1, b.y1, 0, b.h, WALL.face, { top: WALL.cap, left: WALL.face, right: WALL.side });
    return;
  }
  const frame = GLASS.frame;
  box(g, b.x0, b.y0, b.x1, b.y1, 0, 0.06, frame, { gradient: false });
  if (w.axis === "x") {
    faceY(g, b.y1, b.x0, b.x1, 0.06, b.h - 0.05, GLASS.pane, 0.3);
    faceY(g, b.y1, b.x0 + 0.18, b.x0 + 0.3, 0.2, b.h - 0.2, 0xffffff, 0.22);
    box(g, b.x0, b.y0, b.x0 + 0.04, b.y1, 0, b.h, frame, { gradient: false });
  } else {
    faceX(g, b.x1, b.y0, b.y1, 0.06, b.h - 0.05, GLASS.pane, 0.3);
    faceX(g, b.x1, b.y0 + 0.18, b.y0 + 0.3, 0.2, b.h - 0.2, 0xffffff, 0.22);
    box(g, b.x0, b.y0, b.x1, b.y0 + 0.04, 0, b.h, frame, { gradient: false });
  }
  box(g, b.x0, b.y0, b.x1, b.y1, b.h - 0.05, 0.05, frame, { gradient: false });
}
