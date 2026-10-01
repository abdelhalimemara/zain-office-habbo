import { sortBox } from "./draw/furniture";
import { WALL_H } from "./draw/floor";
import { screenBounds, tileCenter, type Box, type Pt, type Rect } from "./iso";
import { roomAt } from "./layouts";
import { NON_BLOCKING, type FloorLayout, type Room } from "./layouts/types";
import { measureText } from "./pixelFont";

export const LABEL_H = 10;
const SEATED_H = 34;
const WALL_T = 0.1;

export function labelWidth(text: string): number {
  return measureText(text) + 8;
}

/** Screen rect of a room label centred on tile (tx, ty). */
export function labelRect(tx: number, ty: number, width: number): Rect {
  const c = tileCenter(tx, ty);
  return { x: Math.round(c.x) - Math.floor(width / 2), y: Math.round(c.y) + 5 - LABEL_H, w: width, h: LABEL_H };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Bounding rects of a box cut into one-tile columns, which hugs diagonal walls and long tables far better. */
function tileRects(b: Box): Rect[] {
  const out: Rect[] = [];
  for (let x = Math.floor(b.x0); x < b.x1; x++) {
    for (let y = Math.floor(b.y0); y < b.y1; y++) {
      const x0 = Math.max(b.x0, x);
      const y0 = Math.max(b.y0, y);
      const x1 = Math.min(b.x1, x + 1);
      const y1 = Math.min(b.y1, y + 1);
      if (x1 > x0 && y1 > y0) out.push(screenBounds({ x0, y0, x1, y1, h: b.h }));
    }
  }
  return out;
}

/** Screen rects of everything a label must not cover: furniture, solid walls and seated agents (glass stays readable). */
export function labelObstacles(layout: FloorLayout): Rect[] {
  const out: Rect[] = [];
  for (const f of layout.furniture) if (!NON_BLOCKING.has(f.kind)) out.push(...tileRects(sortBox(f)));
  for (const w of layout.walls) {
    if (w.kind === "glass") continue;
    const box =
      w.axis === "x"
        ? { x0: w.from, y0: w.at - WALL_T, x1: w.to, y1: w.at + WALL_T, h: WALL_H }
        : { x0: w.at - WALL_T, y0: w.from, x1: w.at + WALL_T, y1: w.to, h: WALL_H };
    out.push(...tileRects(box));
  }
  for (const s of layout.seats) out.push(screenBounds({ x0: s.x + 0.1, y0: s.y + 0.1, x1: s.x + 0.9, y1: s.y + 0.9, h: SEATED_H }));
  return out.map((r) => ({ x: r.x + 1, y: r.y + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - 2) }));
}

function isCorridor(layout: FloorLayout, x: number, y: number): boolean {
  for (const tx of [Math.floor(x), Math.ceil(x)]) {
    for (const ty of [Math.floor(y), Math.ceil(y)]) {
      const r = roomAt(layout, tx, ty);
      if (!r || r.name) return false;
    }
  }
  return true;
}

/** How far in front of a room (toward the viewer) a label may sit when the room itself is full. */
export const LABEL_REACH = 2;

/**
 * Tile on which to centre the room's label: inside the room or just in front of it (a door plate on the corridor),
 * overlapping as little as possible and as close to the room centre as possible.
 */
export function placeRoomLabel(room: Room, width: number, obstacles: readonly Rect[], layout?: FloorLayout): Pt {
  const cols = layout?.cols ?? Number.POSITIVE_INFINITY;
  const rows = layout?.rows ?? Number.POSITIVE_INFINITY;
  const cx = room.x + (room.w - 1) / 2;
  const cy = room.y + (room.h - 1) / 2;
  let best: { p: Pt; cost: number } | null = null;
  const maxY = Math.min(rows, room.y + room.h + LABEL_REACH);
  const maxX = Math.min(cols, room.x + room.w + LABEL_REACH);
  for (let y = room.y; y <= maxY - 1; y += 0.5) {
    for (let x = room.x; x <= maxX - 1; x += 0.5) {
      const inside = x <= room.x + room.w - 1 && y <= room.y + room.h - 1;
      if (!inside && x > room.x + room.w - 1 && y > room.y + room.h - 1) continue;
      if (!inside && layout && !isCorridor(layout, x, y)) continue;
      const r = labelRect(x, y, width);
      let overlap = 0;
      for (const o of obstacles) overlap += overlapArea(r, o);
      const cost = overlap * 100 + Math.abs(x - cx) + Math.abs(y - cy) + (inside ? 0 : 2);
      if (!best || cost < best.cost) best = { p: { x, y }, cost };
    }
  }
  return best?.p ?? { x: room.x, y: room.y };
}

export interface PlacedLabel {
  room: Room;
  text: string;
  at: Pt;
  rect: Rect;
}

const placedCache = new WeakMap<FloorLayout, PlacedLabel[]>();

/** Places every named room's label, treating already placed labels as obstacles. */
export function placeRoomLabels(layout: FloorLayout): PlacedLabel[] {
  const cached = placedCache.get(layout);
  if (cached) return cached;
  const obstacles = labelObstacles(layout);
  const out: PlacedLabel[] = [];
  for (const room of layout.rooms) {
    if (!room.name) continue;
    const text = room.name.toUpperCase();
    const width = labelWidth(text);
    const at = placeRoomLabel(room, width, obstacles, layout);
    const rect = labelRect(at.x, at.y, width);
    obstacles.push(rect);
    out.push({ room, text, at, rect });
  }
  placedCache.set(layout, out);
  return out;
}

/** Tiles where a standing avatar would sit under a room label; idle agents do not rest there. */
export function tilesUnderLabels(layout: FloorLayout): Set<string> {
  const labels = placeRoomLabels(layout).map((l) => l.rect);
  const out = new Set<string>();
  for (let y = 0; y < layout.rows; y++) {
    for (let x = 0; x < layout.cols; x++) {
      const a = screenBounds({ x0: x + 0.2, y0: y + 0.2, x1: x + 0.8, y1: y + 0.8, h: 40 });
      if (labels.some((r) => overlapArea(a, r) > 0)) out.add(`${x},${y}`);
    }
  }
  return out;
}
