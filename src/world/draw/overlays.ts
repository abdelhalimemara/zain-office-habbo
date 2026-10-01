import type { Graphics } from "pixi.js";
import type { AgentActivity } from "../../../shared/flow";
import { measureText, truncate } from "../pixelFont";
import { PAL } from "../palette";
import { pixelText, plate, rect } from "./primitives";

export type BubbleKind = Exclude<AgentActivity, "working" | "idle">;

function bubbleFrame(g: Graphics, w: number, h: number, fill: number): { x: number; y: number } {
  const x = -Math.floor(w / 2);
  const y = -h - 3;
  plate(g, x, y, w, h, fill, PAL.outline);
  rect(g, -2, -4, 5, 1, PAL.outline);
  rect(g, -1, -4, 3, 1, fill);
  rect(g, -1, -3, 3, 1, PAL.outline);
  rect(g, 0, -3, 1, 1, fill);
  rect(g, 0, -2, 1, 1, PAL.outline);
  return { x, y };
}

export function drawBubble(g: Graphics, kind: BubbleKind): void {
  if (kind === "blocked") {
    const o = bubbleFrame(g, 13, 15, PAL.red);
    rect(g, o.x + 1, o.y + 1, 11, 2, 0xf27a7a);
    pixelText(g, "!", o.x + 5, o.y + 2, PAL.white, 2);
    return;
  }
  if (kind === "awaiting-approval") {
    const o = bubbleFrame(g, 17, 17, PAL.yellow);
    rect(g, o.x + 1, o.y + 1, 15, 2, 0xfbe58a);
    rect(g, o.x + 4, o.y + 3, 9, 12, 0x8a5a2b);
    rect(g, o.x + 5, o.y + 5, 7, 9, PAL.white);
    rect(g, o.x + 6, o.y + 2, 5, 3, PAL.metalDark);
    pixelText(g, "?", o.x + 7, o.y + 7, PAL.outline);
    return;
  }
  const o = bubbleFrame(g, 15, 9, PAL.white);
  pixelText(g, "…", o.x + 5, o.y + 2, PAL.outline);
}

export function drawZzz(g: Graphics): void {
  pixelText(g, "Z", 0, 0, PAL.white);
  pixelText(g, "Z", 4, -5, PAL.white);
}

export function drawNameTag(g: Graphics, title: string, sub?: string): void {
  const line1 = truncate(title, 120);
  const line2 = sub ? truncate(sub, 120) : "";
  const w = Math.max(measureText(line1), measureText(line2)) + 8;
  const h = line2 ? 17 : 10;
  const x = -Math.floor(w / 2);
  plate(g, x, -h, w, h, 0x101218, 0x101218, 0.85);
  pixelText(g, line1, x + 4, -h + 3, PAL.white);
  if (line2) pixelText(g, line2, x + 4, -h + 10, 0xa9b4c4);
}

export function drawSelectArrow(g: Graphics): void {
  const rows: [number, number][] = [[-4, 9], [-3, 7], [-2, 5], [-1, 3], [0, 1]];
  rect(g, -2, -7, 5, 4, PAL.outline);
  rect(g, -1, -6, 3, 3, PAL.yellow);
  rows.forEach(([x, w], i) => {
    rect(g, x - 1, -3 + i, w + 2, 1, PAL.outline);
    rect(g, x, -3 + i, w, 1, PAL.yellow);
  });
  rect(g, 0, 2, 1, 1, PAL.outline);
}

export function drawFootRing(g: Graphics, color: number): void {
  g.ellipse(0, 0, 10, 5).stroke({ color, width: 1, alpha: 0.9 });
}

export interface BadgeContent {
  working: number;
  awaiting: number;
}

/** Returns where the bouncing "!" should sit (relative), or null when nothing awaits approval. */
export function drawBadge(g: Graphics, c: BadgeContent): { x: number; y: number; w: number } | null {
  const workText = String(c.working);
  const waitText = c.awaiting > 0 ? String(c.awaiting) : "";
  const workW = 7 + measureText(workText);
  const waitW = waitText ? 9 + measureText(waitText) : 0;
  const w = 6 + workW + waitW;
  const h = 11;
  const x = -Math.floor(w / 2);
  plate(g, x, -h, w, h, 0x101826, PAL.white, 0.95);
  rect(g, x + 1, -h + 1, w - 2, h - 2, 0x172238);
  rect(g, x + 4, -h + 4, 3, 3, 0x3ddc84);
  pixelText(g, workText, x + 9, -h + 3, PAL.white);
  if (!waitText) return null;
  const bx = x + 4 + workW + 2;
  pixelText(g, waitText, bx + 5, -h + 3, PAL.yellow);
  return { x: bx, y: -h + 3, w: waitW };
}

export function drawBang(g: Graphics): void {
  rect(g, -1, -1, 4, 7, PAL.outline);
  rect(g, 0, 0, 2, 3, PAL.yellow);
  rect(g, 0, 4, 2, 1, PAL.yellow);
}

export function drawRoomLabel(g: Graphics, text: string, accent: number): void {
  const w = measureText(text) + 8;
  const x = -Math.floor(w / 2);
  plate(g, x, -10, w, 10, 0x1b1f27, 0x0d0f14, 0.88);
  rect(g, x + 1, -9, 2, 8, accent);
  pixelText(g, text, x + 5, -7, 0xe8ecf2);
}
