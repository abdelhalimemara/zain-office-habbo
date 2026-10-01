import type { Graphics } from "pixi.js";
import type { Box } from "../iso";
import type { FloorKind, FloorLayout, WallSeg } from "../layouts/types";
import { PAL, shade } from "../palette";
import { box, diamond, faceX, faceY } from "./primitives";

export const WALL_H = 24;
export const BACK_WALL_H = 40;
const WALL_T = 0.1;
const SLAB = 10;

const FLOOR_COLORS: Record<FloorKind, [number, number]> = {
  tile: [PAL.tileA, PAL.tileB],
  wood: [PAL.wood, PAL.woodLight],
  carpet: [PAL.carpet, PAL.carpetLight],
  gold: [0x9c7a34, 0xa88540],
  dark: [0x3a3f47, 0x42474f],
};

function floorTile(g: Graphics, x: number, y: number, kind: FloorKind): void {
  const [a, b] = FLOOR_COLORS[kind];
  const alt = (x + y) % 2 === 0;
  if (kind === "wood") {
    diamond(g, x, y, x + 1, y + 1, 0, alt ? a : shade(a, 0.04));
    for (const t of [0.33, 0.66]) diamond(g, x, y + t - 0.02, x + 1, y + t + 0.02, 0, PAL.woodDark);
    diamond(g, x + ((x * 7 + y * 3) % 3) * 0.3 + 0.1, y, x + ((x * 7 + y * 3) % 3) * 0.3 + 0.13, y + 0.33, 0, PAL.woodDark);
    return;
  }
  diamond(g, x, y, x + 1, y + 1, 0, alt ? a : b);
  if (kind === "tile") {
    diamond(g, x, y, x + 1, y + 0.04, 0, PAL.tileEdge, 0.5);
    diamond(g, x, y, x + 0.04, y + 1, 0, PAL.tileEdge, 0.5);
  }
}

export function drawFloorBase(g: Graphics, layout: FloorLayout, accent: number): void {
  const { cols, rows } = layout;
  faceX(g, rows, 0, cols, -SLAB, 0, PAL.slab);
  faceY(g, cols, 0, rows, -SLAB, 0, PAL.slabDark);
  faceX(g, rows, 0, cols, -SLAB, -SLAB + 2, shade(accent, -0.3));
  faceY(g, cols, 0, rows, -SLAB, -SLAB + 2, shade(accent, -0.45));
  for (const r of layout.rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) floorTile(g, x, y, r.floor);
  }
  drawBackWalls(g, cols, rows, accent);
}

function drawBackWalls(g: Graphics, cols: number, rows: number, accent: number): void {
  const t = 0.3;
  const H = BACK_WALL_H;
  box(g, -t, -t, cols, 0, 0, H, { top: PAL.wallTop, left: PAL.wall, right: PAL.wallDark });
  box(g, -t, 0, 0, rows, 0, H, { top: PAL.wallTop, left: PAL.wall, right: PAL.wallDark });
  diamond(g, -t, -t, cols, -t + 0.08, H, PAL.wallTopHi);
  diamond(g, -t, -t, -t + 0.08, rows, H, PAL.wallTopHi);
  faceX(g, 0, 0, cols, 0, 3, PAL.black);
  faceY(g, 0, 0, rows, 0, 3, shade(PAL.black, 0.1));
  faceX(g, 0, 0, cols, H - 8, H - 5, accent);
  faceY(g, 0, 0, rows, H - 8, H - 5, shade(accent, -0.15));
  for (let i = 1; i + 2 <= cols; i += 4) {
    faceX(g, 0, i + 0.3, i + 1.9, 12, 28, PAL.glassFrame);
    faceX(g, 0, i + 0.38, i + 1.82, 13, 27, 0x2a4f7a);
    faceX(g, 0, i + 0.5, i + 0.8, 14, 26, 0x4f7fae);
  }
  for (let j = 1; j + 2 <= rows; j += 4) {
    faceY(g, 0, j + 0.3, j + 1.9, 12, 28, PAL.glassFrame);
    faceY(g, 0, j + 0.38, j + 1.82, 13, 27, 0x23466f);
    faceY(g, 0, j + 0.5, j + 0.8, 14, 26, 0x46739f);
  }
}

export function wallBox(w: WallSeg): Box {
  return w.axis === "x"
    ? { x0: w.from, y0: w.at - WALL_T, x1: w.to, y1: w.at + WALL_T, h: WALL_H }
    : { x0: w.at - WALL_T, y0: w.from, x1: w.at + WALL_T, y1: w.to, h: WALL_H };
}

/** Walls are split into one-tile pieces so avatars sort correctly beside them. */
export function wallPieces(w: WallSeg): WallSeg[] {
  const out: WallSeg[] = [];
  for (let i = w.from; i < w.to; i++) out.push({ ...w, from: i, to: i + 1 });
  return out;
}

export function drawWall(g: Graphics, w: WallSeg): void {
  const b = wallBox(w);
  if (w.kind === "solid") {
    box(g, b.x0, b.y0, b.x1, b.y1, 0, WALL_H, { top: PAL.wallTop, left: PAL.wall, right: PAL.wallDark });
    return;
  }
  box(g, b.x0, b.y0, b.x1, b.y1, 0, 3, { top: PAL.glassFrame, left: PAL.glassFrame, right: shade(PAL.glassFrame, -0.2) });
  box(g, b.x0, b.y0, b.x1, b.y1, 3, WALL_H - 6, { top: PAL.glass, left: PAL.glass, right: PAL.glassDark }, 0.38);
  if (w.axis === "x") {
    faceX(g, b.y1, b.x0 + 0.2, b.x0 + 0.32, 6, WALL_H - 5, PAL.white, 0.45);
    faceX(g, b.y1, b.x1 - 0.04, b.x1, 3, WALL_H - 3, PAL.glassFrame);
  } else {
    faceY(g, b.x1, b.y0 + 0.2, b.y0 + 0.32, 6, WALL_H - 5, PAL.white, 0.45);
    faceY(g, b.x1, b.y1 - 0.04, b.y1, 3, WALL_H - 3, PAL.glassFrame);
  }
  box(g, b.x0, b.y0, b.x1, b.y1, WALL_H - 3, 3, { top: PAL.wallTopHi, left: PAL.glassFrame, right: shade(PAL.glassFrame, -0.2) });
}
