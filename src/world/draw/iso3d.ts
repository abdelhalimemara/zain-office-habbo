import type { Graphics } from "pixi.js";
import { toScreen, type Pt } from "../iso";

export { TILE_H, TILE_W, Z_UNIT, toScreen } from "../iso";

/**
 * Shared lighting: light comes from the upper left, so tops are lifted, faces on the plane y = const (lower-left) are
 * mid-tone and faces on the plane x = const (lower-right) are darkest. Values are shade() factors.
 */
export const LIGHT = { top: 0.08, left: -0.12, right: -0.3 } as const;

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function shade(color: number, f: number): number {
  return f >= 0 ? mix(color, 0xffffff, f) : mix(color, 0x000000, -f);
}

export function poly(g: Graphics, pts: readonly Pt[], color: number, alpha = 1): void {
  g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color, alpha });
}

/** Horizontal quad at height z over [x0,x1]×[y0,y1]. */
export function top(g: Graphics, x0: number, y0: number, x1: number, y1: number, z: number, color: number, alpha = 1): void {
  poly(g, [toScreen(x0, y0, z), toScreen(x1, y0, z), toScreen(x1, y1, z), toScreen(x0, y1, z)], color, alpha);
}

/** Vertical quad on the plane y = const (faces the viewer's lower-left). */
export function faceY(g: Graphics, y: number, x0: number, x1: number, z0: number, z1: number, color: number, alpha = 1): void {
  poly(g, [toScreen(x0, y, z0), toScreen(x1, y, z0), toScreen(x1, y, z1), toScreen(x0, y, z1)], color, alpha);
}

/** Vertical quad on the plane x = const (faces the viewer's lower-right). */
export function faceX(g: Graphics, x: number, y0: number, y1: number, z0: number, z1: number, color: number, alpha = 1): void {
  poly(g, [toScreen(x, y0, z0), toScreen(x, y1, z0), toScreen(x, y1, z1), toScreen(x, y0, z1)], color, alpha);
}

export interface BoxStyle {
  top?: number;
  left?: number;
  right?: number;
  alpha?: number;
  /** Darken the lower part of the side faces for a soft vertical gradient. */
  gradient?: boolean;
  /** Light rim along the top front edges. */
  rim?: boolean;
}

/** A shaded box: lighter top, mid left face, darker right face (light comes from the upper left). */
export function box(g: Graphics, x0: number, y0: number, x1: number, y1: number, z0: number, h: number, color: number, s: BoxStyle = {}): void {
  const a = s.alpha ?? 1;
  const z1 = z0 + h;
  const left = s.left ?? shade(color, LIGHT.left);
  const right = s.right ?? shade(color, LIGHT.right);
  faceY(g, y1, x0, x1, z0, z1, left, a);
  faceX(g, x1, y0, y1, z0, z1, right, a);
  if (s.gradient !== false && h > 0.08) {
    const zg = z0 + h * 0.45;
    faceY(g, y1, x0, x1, z0, zg, 0x000000, a * 0.07);
    faceX(g, x1, y0, y1, z0, zg, 0x000000, a * 0.07);
  }
  top(g, x0, y0, x1, y1, z1, s.top ?? shade(color, LIGHT.top), a);
  if (s.rim) {
    const e = Math.min(0.04, (x1 - x0) / 4, (y1 - y0) / 4);
    top(g, x0, y1 - e, x1, y1, z1, 0xffffff, a * 0.18);
    top(g, x1 - e, y0, x1, y1, z1, 0xffffff, a * 0.1);
  }
}

/** Soft contact shadow on the floor around a footprint. */
export function contactShadow(g: Graphics, x0: number, y0: number, x1: number, y1: number, strength = 1): void {
  for (const [grow, alpha] of [
    [0.18, 0.05],
    [0.1, 0.07],
    [0.03, 0.1],
  ] as const) {
    top(g, x0 - grow * 0.5, y0 - grow * 0.5, x1 + grow, y1 + grow, 0, 0x1a140e, alpha * strength);
  }
}

/** Octagonal prism standing at (cx, cy): reads as a round table, pot or stool. */
export function prism(g: Graphics, cx: number, cy: number, r: number, z0: number, h: number, color: number, alpha = 1): void {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  for (let i = 0; i < 8; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % 8]!;
    const mx = (p.x + q.x) / 2 - cx;
    const my = (p.y + q.y) / 2 - cy;
    if (mx + my <= 0) continue;
    const light = mx > my ? -0.3 : -0.12;
    poly(g, [toScreen(p.x, p.y, z0), toScreen(q.x, q.y, z0), toScreen(q.x, q.y, z0 + h), toScreen(p.x, p.y, z0 + h)], shade(color, light), alpha);
  }
  poly(g, pts.map((p) => toScreen(p.x, p.y, z0 + h)), shade(color, 0.08), alpha);
}

/** Leafy foliage: overlapping round clumps in three greens, centred above tile point (cx, cy) at height z. */
export function foliage(g: Graphics, cx: number, cy: number, z: number, size: number): void {
  const c = toScreen(cx, cy, z);
  const clumps: [number, number, number, number][] = [
    [0, 0, 1, 0x35552e],
    [-0.55, 0.15, 0.7, 0x3f6b35],
    [0.55, 0.1, 0.72, 0x3a5f32],
    [-0.25, -0.45, 0.68, 0x4f7f43],
    [0.3, -0.5, 0.6, 0x5c8a4a],
    [0, -0.85, 0.5, 0x6f9c56],
    [-0.15, -0.2, 0.42, 0x7aa65a],
  ];
  for (const [dx, dy, r, col] of clumps) g.circle(c.x + dx * size, c.y + dy * size, r * size).fill(col);
}
