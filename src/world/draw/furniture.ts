import type { Graphics } from "pixi.js";
import { toScreen, type Box } from "../iso";
import type { Facing, Furniture, FurnitureKind } from "../layouts/types";
import { PAL, shade } from "../palette";
import { blob, box, boxColors, diamond, faceX, faceY, rect } from "./primitives";

const DESK_TOP = boxColors(0xe9e4da, 0.05);
const DESK_BODY = boxColors(0xb9b3a8);
const METAL = boxColors(PAL.metal);
const DARK = boxColors(0x2b2f36, 0.2);
const WOOD = boxColors(PAL.wood);
const WHITE = boxColors(0xe8eaee, 0.04);

export const FURNITURE_HEIGHT: Record<FurnitureKind, number> = {
  desk: 26, execDesk: 26, chair: 16, meetingTable: 14, sofa: 16, armchair: 16, coffeeTable: 8, plant: 26,
  bigPlant: 40, waterCooler: 26, whiteboard: 28, bookcase: 30, counter: 22, fridge: 30, vending: 32, printer: 14,
  filing: 18, receptionDesk: 16, gameTable: 14, safe: 16, tv: 28, rug: 0, bistroTable: 12,
};

export function sortBox(f: Pick<Furniture, "x" | "y" | "w" | "d" | "kind">): Box {
  const i = 0.15;
  return { x0: f.x + i, y0: f.y + i, x1: f.x + f.w - i, y1: f.y + f.d - i, h: FURNITURE_HEIGHT[f.kind] };
}

export interface MonitorGeom {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
  visible: boolean;
  dir: Facing;
}

/** Monitor on desk tile (tx, ty) whose seat lies on side `dir`. */
export function monitorGeom(tx: number, ty: number, dir: Facing): MonitorGeom {
  const z0 = 15;
  const z1 = 25;
  switch (dir) {
    case "sw":
      return { x0: tx + 0.2, y0: ty + 0.2, x1: tx + 0.8, y1: ty + 0.3, z0, z1, visible: true, dir };
    case "ne":
      return { x0: tx + 0.2, y0: ty + 0.7, x1: tx + 0.8, y1: ty + 0.8, z0, z1, visible: false, dir };
    case "se":
      return { x0: tx + 0.2, y0: ty + 0.2, x1: tx + 0.3, y1: ty + 0.8, z0, z1, visible: true, dir };
    case "nw":
      return { x0: tx + 0.7, y0: ty + 0.2, x1: tx + 0.8, y1: ty + 0.8, z0, z1, visible: false, dir };
  }
}

export function drawScreen(g: Graphics, m: MonitorGeom, color: number, alpha = 1): void {
  if (m.dir === "sw") faceX(g, m.y1, m.x0 + 0.06, m.x1 - 0.06, m.z0 + 1, m.z1 - 1, color, alpha);
  else if (m.dir === "se") faceY(g, m.x1, m.y0 + 0.06, m.y1 - 0.06, m.z0 + 1, m.z1 - 1, color, alpha);
}

function monitor(g: Graphics, tx: number, ty: number, dir: Facing): void {
  const m = monitorGeom(tx, ty, dir);
  const cx = (m.x0 + m.x1) / 2;
  const cy = (m.y0 + m.y1) / 2;
  box(g, cx - 0.05, cy - 0.05, cx + 0.05, cy + 0.05, 13, 3, DARK);
  box(g, m.x0, m.y0, m.x1, m.y1, m.z0, m.z1 - m.z0, DARK);
  drawScreen(g, m, PAL.screenOff);
  const k = dir === "sw" ? { x0: tx + 0.3, y0: ty + 0.55, x1: tx + 0.7, y1: ty + 0.7 }
    : dir === "ne" ? { x0: tx + 0.3, y0: ty + 0.3, x1: tx + 0.7, y1: ty + 0.45 }
    : dir === "se" ? { x0: tx + 0.55, y0: ty + 0.3, x1: tx + 0.7, y1: ty + 0.7 }
    : { x0: tx + 0.3, y0: ty + 0.3, x1: tx + 0.45, y1: ty + 0.7 };
  diamond(g, k.x0, k.y0, k.x1, k.y1, 13, 0x4a505a);
}

function desk(g: Graphics, f: Furniture): void {
  box(g, f.x + 0.08, f.y + 0.08, f.x + f.w - 0.08, f.y + f.d - 0.08, 0, 11, DESK_BODY);
  box(g, f.x + 0.02, f.y + 0.02, f.x + f.w - 0.02, f.y + f.d - 0.02, 11, 2, DESK_TOP);
  monitor(g, f.x, f.y, f.dir);
}

function execDesk(g: Graphics, f: Furniture): void {
  const trim = f.color ?? PAL.woodDark;
  box(g, f.x + 0.06, f.y + 0.06, f.x + f.w - 0.06, f.y + f.d - 0.06, 0, 11, boxColors(PAL.woodDark));
  faceX(g, f.y + f.d - 0.06, f.x + 0.1, f.x + f.w - 0.1, 8, 10, trim);
  faceY(g, f.x + f.w - 0.06, f.y + 0.1, f.y + f.d - 0.1, 8, 10, shade(trim, -0.2));
  box(g, f.x, f.y, f.x + f.w, f.y + f.d, 11, 2, boxColors(PAL.woodLight, 0.12));
  monitor(g, f.x + f.w - 1, f.y + f.d - 1, f.dir);
  box(g, f.x + 0.25, f.y + 0.25, f.x + 0.6, f.y + 0.6, 13, 1, WHITE);
  box(g, f.x + 0.2, f.y + 0.65, f.x + 0.32, f.y + 0.77, 13, 7, boxColors(f.color ?? PAL.gold));
}

/** Office chair split in two sortable parts: the seat (always behind its sitter) and the backrest. */
export function chairSeat(g: Graphics, x: number, y: number, accent: number): void {
  box(g, x + 0.45, y + 0.45, x + 0.55, y + 0.55, 0, 5, DARK);
  box(g, x + 0.22, y + 0.22, x + 0.78, y + 0.78, 5, 3, boxColors(shade(accent, -0.35)));
}

export function chairBack(g: Graphics, x: number, y: number, facing: Facing, accent: number): void {
  const c = boxColors(shade(accent, -0.45));
  if (facing === "sw") box(g, x + 0.22, y + 0.15, x + 0.78, y + 0.27, 8, 9, c);
  else if (facing === "ne") box(g, x + 0.22, y + 0.73, x + 0.78, y + 0.85, 8, 9, c);
  else if (facing === "se") box(g, x + 0.15, y + 0.22, x + 0.27, y + 0.78, 8, 9, c);
  else box(g, x + 0.73, y + 0.22, x + 0.85, y + 0.78, 8, 9, c);
}

export function chairBackBox(x: number, y: number, facing: Facing): Box {
  const h = 18;
  if (facing === "sw") return { x0: x + 0.2, y0: y + 0.02, x1: x + 0.8, y1: y + 0.12, h };
  if (facing === "ne") return { x0: x + 0.2, y0: y + 0.88, x1: x + 0.8, y1: y + 0.98, h };
  if (facing === "se") return { x0: x + 0.02, y0: y + 0.2, x1: x + 0.12, y1: y + 0.8, h };
  return { x0: x + 0.88, y0: y + 0.2, x1: x + 0.98, y1: y + 0.8, h };
}

export function chairSeatBox(x: number, y: number, facing: Facing): Box {
  const h = 8;
  if (facing === "sw") return { x0: x + 0.2, y0: y + 0.13, x1: x + 0.8, y1: y + 0.17, h };
  if (facing === "ne") return { x0: x + 0.2, y0: y + 0.13, x1: x + 0.8, y1: y + 0.17, h };
  if (facing === "se") return { x0: x + 0.13, y0: y + 0.2, x1: x + 0.17, y1: y + 0.8, h };
  return { x0: x + 0.13, y0: y + 0.2, x1: x + 0.17, y1: y + 0.8, h };
}

function sofa(g: Graphics, f: Furniture, color: number): void {
  const c = boxColors(color);
  const back = boxColors(shade(color, -0.12));
  const { x, y, w, d } = f;
  const x1 = x + w;
  const y1 = y + d;
  const t = 0.28;
  if (f.dir === "sw" || f.dir === "ne") {
    const by = f.dir === "sw" ? y + 0.1 : y1 - 0.1 - t;
    if (f.dir === "sw") box(g, x + 0.05, by, x1 - 0.05, by + t, 0, 16, back);
    box(g, x + 0.05, y + 0.1, x + 0.25, y1 - 0.1, 0, 11, back);
    box(g, x + 0.25, y + 0.15, x1 - 0.25, y1 - 0.15, 0, 7, c);
    box(g, x1 - 0.25, y + 0.1, x1 - 0.05, y1 - 0.1, 0, 11, back);
    if (f.dir === "ne") box(g, x + 0.05, by, x1 - 0.05, by + t, 0, 16, back);
  } else {
    const bx = f.dir === "se" ? x + 0.1 : x1 - 0.1 - t;
    if (f.dir === "se") box(g, bx, y + 0.05, bx + t, y1 - 0.05, 0, 16, back);
    box(g, x + 0.1, y + 0.05, x1 - 0.1, y + 0.25, 0, 11, back);
    box(g, x + 0.15, y + 0.25, x1 - 0.15, y1 - 0.25, 0, 7, c);
    box(g, x + 0.1, y1 - 0.25, x1 - 0.1, y1 - 0.05, 0, 11, back);
    if (f.dir === "nw") box(g, bx, y + 0.05, bx + t, y1 - 0.05, 0, 16, back);
  }
}

function foliage(g: Graphics, sx: number, sy: number, size: number): void {
  blob(g, sx, sy, size, PAL.leafA);
  blob(g, sx - size * 0.45, sy - size * 0.25, size * 0.6, PAL.leafB);
  blob(g, sx + size * 0.4, sy - size * 0.45, size * 0.55, PAL.leafB);
  blob(g, sx - size * 0.1, sy - size * 0.75, size * 0.45, PAL.leafC);
}

function plant(g: Graphics, f: Furniture, big: boolean): void {
  const cx = f.x + 0.5;
  const cy = f.y + 0.5;
  const r = big ? 0.26 : 0.2;
  const potH = big ? 10 : 7;
  box(g, cx - r, cy - r, cx + r, cy + r, 0, potH, boxColors(big ? 0xe8eaee : PAL.pot, 0.1));
  const s = toScreen(cx, cy, potH);
  if (big) {
    rect(g, s.x, s.y - 12, 2, 12, PAL.trunk);
    foliage(g, s.x + 1, s.y - 20, 8);
  } else {
    foliage(g, s.x, s.y - 6, 5);
  }
}

function bookcase(g: Graphics, f: Furniture): void {
  const { x, y, w, d } = f;
  box(g, x + 0.05, y + 0.05, x + w - 0.05, y + d - 0.05, 0, 30, boxColors(PAL.woodDark));
  const colors = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22, 0xecf0f1];
  for (let shelf = 0; shelf < 3; shelf++) {
    const z = 3 + shelf * 9;
    const along = f.dir === "se" ? d : w;
    const n = Math.round(along * 6);
    for (let i = 0; i < n; i++) {
      const a = 0.12 + (i / n) * (along - 0.24);
      const b = a + (along - 0.24) / n - 0.03;
      const color = colors[(i * 3 + shelf * 5 + x + y) % colors.length]!;
      const top = z + 6 - ((i + shelf) % 3);
      if (f.dir === "se") faceY(g, x + w - 0.05, y + a, y + b, z, top, color);
      else faceX(g, y + d - 0.05, x + a, x + b, z, top, color);
    }
  }
}

function wallPanel(g: Graphics, f: Furniture, z0: number, z1: number, frame: number, face: number): { a: number; b: number } {
  const { x, y, w, d } = f;
  if (f.dir === "se") {
    box(g, x + 0.05, y + 0.1, x + 0.15, y + d - 0.1, z0, z1 - z0, boxColors(frame));
    faceY(g, x + 0.15, y + 0.16, y + d - 0.16, z0 + 2, z1 - 2, face);
    return { a: y, b: y + d };
  }
  box(g, x + 0.1, y + 0.05, x + w - 0.1, y + 0.15, z0, z1 - z0, boxColors(frame));
  faceX(g, y + 0.15, x + 0.16, x + w - 0.16, z0 + 2, z1 - 2, face);
  return { a: x, b: x + w };
}

export function drawFurniture(g: Graphics, f: Furniture, accent: number): void {
  const { x, y, w, d } = f;
  const x1 = x + w;
  const y1 = y + d;
  switch (f.kind) {
    case "desk":
      return desk(g, f);
    case "execDesk":
      return execDesk(g, f);
    case "chair":
      chairSeat(g, x, y, accent);
      return chairBack(g, x, y, f.dir, accent);
    case "meetingTable":
      for (const [lx, ly] of [[x + 0.3, y + 0.3], [x1 - 0.4, y + 0.3], [x + 0.3, y1 - 0.4], [x1 - 0.4, y1 - 0.4]] as const) {
        box(g, lx, ly, lx + 0.1, ly + 0.1, 0, 10, DARK);
      }
      box(g, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1, 10, 3, WHITE);
      for (let i = 0; i < w - 1; i += 2) box(g, x + 0.6 + i, y + 0.45, x + 0.95 + i, y + 0.75, 13, 1, boxColors(0xcfd5dd));
      return;
    case "sofa":
    case "armchair":
      return sofa(g, f, f.color ?? shade(accent, -0.2));
    case "coffeeTable":
      box(g, x + 0.15, y + 0.15, x1 - 0.15, y1 - 0.15, 0, 6, WOOD);
      return box(g, x + 0.4, y + 0.4, x + 0.55, y + 0.55, 6, 3, WHITE);
    case "bistroTable":
      box(g, x + 0.45, y + 0.45, x + 0.55, y + 0.55, 0, 10, DARK);
      return box(g, x + 0.2, y + 0.2, x + 0.8, y + 0.8, 10, 2, WHITE);
    case "plant":
      return plant(g, f, false);
    case "bigPlant":
      return plant(g, f, true);
    case "waterCooler":
      box(g, x + 0.3, y + 0.3, x + 0.7, y + 0.7, 0, 14, WHITE);
      return box(g, x + 0.35, y + 0.35, x + 0.65, y + 0.65, 14, 10, boxColors(0x6fc3f0, 0.2), 0.9);
    case "whiteboard": {
      box(g, x + 0.2, y + 0.1, x + 0.3, y + 0.2, 0, 6, METAL);
      box(g, x1 - 0.3, y + 0.1, x1 - 0.2, y + 0.2, 0, 6, METAL);
      const p = wallPanel(g, f, 6, 28, PAL.metal, 0xf7f8fa);
      const marks = [0x2e86c1, 0xe24a4a, 0x27ae60];
      for (let i = 0; i < 4; i++) {
        const a = p.a + 0.3 + i * ((p.b - p.a - 0.6) / 4);
        faceX(g, y + 0.16, a, a + 0.35, 20 - (i % 2) * 6, 22 - (i % 2) * 6, marks[i % 3]!);
      }
      return;
    }
    case "tv": {
      box(g, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1 - (f.dir === "sw" ? d - 0.5 : 0), 0, 6, boxColors(PAL.woodDark));
      wallPanel(g, f, 9, 27, 0x1d2027, 0x23436b);
      const cx = f.dir === "se" ? x + 0.16 : y + 0.16;
      for (let i = 0; i < 3; i++) {
        const from = (f.dir === "se" ? y : x) + 0.35 + i * 0.3;
        if (f.dir === "se") faceY(g, cx, from, from + 0.18, 12, 14 + i * 3, accent);
        else faceX(g, cx, from, from + 0.18, 12, 14 + i * 3, accent);
      }
      return;
    }
    case "bookcase":
      return bookcase(g, f);
    case "counter":
      box(g, x + 0.05, y + 0.08, x1 - 0.05, y1 - 0.05, 0, 12, boxColors(0x8a6d4f));
      box(g, x, y, x1, y1, 12, 2, boxColors(0xdfe3e8, 0.05));
      diamond(g, x + 1.2, y + 0.25, x + 1.8, y + 0.75, 14, 0x9aa2ad);
      box(g, x + 0.2, y + 0.2, x + 0.6, y + 0.6, 14, 10, DARK);
      return box(g, x1 - 0.7, y + 0.25, x1 - 0.3, y + 0.6, 14, 6, boxColors(0xc0392b));
    case "fridge":
      box(g, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1, 0, 30, WHITE);
      return faceX(g, y1 - 0.1, x + 0.15, x1 - 0.15, 18, 19, 0xaab1bb);
    case "vending":
      box(g, x + 0.08, y + 0.15, x1 - 0.08, y1 - 0.08, 0, 32, boxColors(0xc0392b));
      faceX(g, y1 - 0.08, x + 0.15, x + 0.65, 10, 29, 0x223042);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        faceX(g, y1 - 0.08, x + 0.2 + c * 0.15, x + 0.3 + c * 0.15, 13 + r * 5, 16 + r * 5, [0xf1c40f, 0x27ae60, 0x3498db][(r + c) % 3]!);
      }
      return;
    case "printer":
      box(g, x + 0.15, y + 0.15, x1 - 0.15, y1 - 0.15, 0, 10, boxColors(0xd5d9df));
      return box(g, x + 0.3, y + 0.3, x1 - 0.3, y1 - 0.3, 10, 2, boxColors(0xf4f5f7));
    case "filing":
      box(g, x + 0.15, y + 0.15, x1 - 0.15, y1 - 0.15, 0, 18, METAL);
      for (const z of [5, 11]) {
        faceX(g, y1 - 0.15, x + 0.2, x1 - 0.2, z, z + 1, PAL.metalDark);
        faceY(g, x1 - 0.15, y + 0.2, y1 - 0.2, z, z + 1, PAL.metalDark);
      }
      return;
    case "receptionDesk":
      box(g, x + 0.05, y + 0.1, x1 - 0.05, y1 - 0.05, 0, 13, boxColors(0xf0f1f3, 0.03));
      faceX(g, y1 - 0.05, x + 0.1, x1 - 0.1, 4, 7, accent);
      box(g, x, y, x1, y + 0.45, 13, 2, WOOD);
      return monitor(g, x + 1, y, "ne");
    case "gameTable":
      for (const [lx, ly] of [[x + 0.3, y + 0.3], [x1 - 0.4, y1 - 0.4], [x + 0.3, y1 - 0.4], [x1 - 0.4, y + 0.3]] as const) {
        box(g, lx, ly, lx + 0.1, ly + 0.1, 0, 9, DARK);
      }
      box(g, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1, 9, 2, boxColors(0x2f8f5b));
      diamond(g, x + w / 2 - 0.03, y + 0.15, x + w / 2 + 0.03, y1 - 0.15, 11, PAL.white);
      return faceY(g, x + w / 2, y + 0.1, y1 - 0.1, 11, 15, 0xdfe3e8, 0.8);
    case "safe":
      box(g, x + 0.15, y + 0.15, x1 - 0.15, y1 - 0.15, 0, 15, boxColors(0x4a505a));
      return faceX(g, y1 - 0.15, x + 0.4, x + 0.6, 6, 10, PAL.gold);
    case "rug":
      diamond(g, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1, 0, shade(f.color ?? accent, -0.1));
      diamond(g, x + 0.3, y + 0.3, x1 - 0.3, y1 - 0.3, 0, shade(f.color ?? accent, 0.25));
      return diamond(g, x + 0.5, y + 0.5, x1 - 0.5, y1 - 0.5, 0, shade(f.color ?? accent, -0.05));
  }
}
