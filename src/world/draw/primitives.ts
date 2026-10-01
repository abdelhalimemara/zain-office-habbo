import type { Graphics } from "pixi.js";
import { toScreen } from "../iso";
import { textRects } from "../pixelFont";
import { shade } from "../palette";

export interface BoxColors {
  top: number;
  left: number;
  right: number;
}

export function boxColors(base: number, topLift = 0.18): BoxColors {
  return { top: shade(base, topLift), left: base, right: shade(base, -0.22) };
}

function poly(g: Graphics, pts: { x: number; y: number }[], color: number, alpha = 1): void {
  g.poly(pts.flatMap((p) => [Math.round(p.x), Math.round(p.y)])).fill({ color, alpha });
}

export function diamond(g: Graphics, x0: number, y0: number, x1: number, y1: number, z: number, color: number, alpha = 1): void {
  poly(g, [toScreen(x0, y0, z), toScreen(x1, y0, z), toScreen(x1, y1, z), toScreen(x0, y1, z)], color, alpha);
}

/** Quad on the plane y = const spanning x ∈ [xa, xb] and height z ∈ [za, zb] (front-left facing). */
export function faceX(g: Graphics, y: number, xa: number, xb: number, za: number, zb: number, color: number, alpha = 1): void {
  poly(g, [toScreen(xa, y, za), toScreen(xb, y, za), toScreen(xb, y, zb), toScreen(xa, y, zb)], color, alpha);
}

/** Quad on the plane x = const spanning y ∈ [ya, yb] and height z ∈ [za, zb] (front-right facing). */
export function faceY(g: Graphics, x: number, ya: number, yb: number, za: number, zb: number, color: number, alpha = 1): void {
  poly(g, [toScreen(x, ya, za), toScreen(x, yb, za), toScreen(x, yb, zb), toScreen(x, ya, zb)], color, alpha);
}

export function box(
  g: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
  h: number,
  c: BoxColors,
  alpha = 1,
): void {
  faceX(g, y1, x0, x1, z, z + h, c.left, alpha);
  faceY(g, x1, y0, y1, z, z + h, c.right, alpha);
  diamond(g, x0, y0, x1, y1, z + h, c.top, alpha);
}

export function outlinedBox(g: Graphics, x0: number, y0: number, x1: number, y1: number, z: number, h: number, c: BoxColors, line: number): void {
  const e = 0.06;
  box(g, x0 - e, y0 - e, x1 + e, y1 + e, z - 1, h + 2, { top: line, left: line, right: line });
  box(g, x0, y0, x1, y1, z, h, c);
}

export function pixelText(g: Graphics, text: string, x: number, y: number, color: number, scale = 1): void {
  for (const [rx, ry, rw, rh] of textRects(text, scale)) g.rect(Math.round(x + rx), Math.round(y + ry), rw, rh);
  g.fill(color);
}

export function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  g.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).fill({ color, alpha });
}

/** Pixel-art rounded plate with a 1px outline. */
export function plate(g: Graphics, x: number, y: number, w: number, h: number, fill: number, line: number, alpha = 1): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  rect(g, X + 1, Y, w - 2, h, line, alpha);
  rect(g, X, Y + 1, w, h - 2, line, alpha);
  rect(g, X + 1, Y + 1, w - 2, h - 2, fill, alpha);
}

export function blob(g: Graphics, cx: number, cy: number, r: number, color: number): void {
  const R = Math.round(r);
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)) * 1.15);
    g.rect(Math.round(cx) - half, Math.round(cy) + dy, half * 2, 1);
  }
  g.fill(color);
}
