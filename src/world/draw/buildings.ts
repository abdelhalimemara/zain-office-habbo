import type { Graphics } from "pixi.js";
import { toScreen, type Box } from "../iso";
import type { CityBuilding } from "../layouts/city";
import { measureText } from "../pixelFont";
import { PAL, shade } from "../palette";
import { blob, box, boxColors, diamond, faceX, faceY, pixelText, plate, rect } from "./primitives";

const FLOOR_H = 12;
export const SPIRE_H = 64;

export function buildingBox(b: CityBuilding): Box {
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.d, h: b.height + (b.division === "hq" ? SPIRE_H : 8) };
}

interface Facade {
  glass: number;
  frame: number;
  band: number;
}

function glassFace(
  g: Graphics,
  axis: "x" | "y",
  plane: number,
  a0: number,
  a1: number,
  z0: number,
  z1: number,
  f: Facade,
  dark: boolean,
  seed: number,
): void {
  const face = axis === "x" ? faceX : faceY;
  const glass = dark ? shade(f.glass, -0.22) : f.glass;
  face(g, plane, a0, a1, z0, z1, glass);
  const cols = Math.round((a1 - a0) * 2);
  const floors = Math.floor((z1 - z0) / FLOOR_H);
  for (let fl = 0; fl < floors; fl++) {
    const zb = z0 + fl * FLOOR_H;
    for (let c = 0; c < cols; c++) {
      const ca = a0 + c * 0.5;
      const k = (c * 7 + fl * 3 + seed) % 11;
      if (k === 0) face(g, plane, ca + 0.06, ca + 0.44, zb + 3, zb + FLOOR_H - 1, dark ? 0xc9b56a : 0xffe7a0, 0.85);
      else if (k < 3) face(g, plane, ca + 0.06, ca + 0.3, zb + 4, zb + FLOOR_H - 1, shade(glass, 0.28));
    }
    face(g, plane, a0, a1, zb, zb + 2, dark ? shade(f.band, -0.25) : f.band);
  }
  for (let c = 0; c <= cols; c++) {
    const ca = a0 + c * 0.5;
    face(g, plane, Math.max(a0, ca - 0.025), Math.min(a1, ca + 0.025), z0, z1, dark ? shade(f.frame, -0.25) : f.frame);
  }
}

function glassBox(g: Graphics, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, f: Facade, seed: number): void {
  glassFace(g, "x", y1, x0, x1, z0, z1, f, false, seed);
  glassFace(g, "y", x1, y0, y1, z0, z1, f, true, seed + 5);
}

function sign(g: Graphics, text: string, sx: number, sy: number, fill: number, ink: number, scale = 1): void {
  const w = measureText(text, scale) + 8 * scale;
  const h = 7 * scale + 4;
  const x = Math.round(sx - w / 2);
  const y = Math.round(sy - h / 2);
  plate(g, x, y, w, h, fill, PAL.outline);
  rect(g, x + 1, y + 1, w - 2, 1, shade(fill, 0.3));
  pixelText(g, text, x + 4 * scale, y + 2 + scale, ink, scale);
}

function rooftop(g: Graphics, x0: number, y0: number, z: number, accent: number): void {
  box(g, x0 + 0.8, y0 + 0.8, x0 + 1.8, y0 + 1.6, z, 7, boxColors(0x9aa2ad));
  box(g, x0 + 2.4, y0 + 0.7, x0 + 3.0, y0 + 1.3, z, 10, boxColors(0x7d858f));
  box(g, x0 + 2.45, y0 + 0.75, x0 + 2.95, y0 + 1.25, z + 10, 2, boxColors(accent));
}

export function drawDivisionBuilding(g: Graphics, b: CityBuilding, accent: number): void {
  const { x, y } = b;
  const x1 = x + b.w;
  const y1 = y + b.d;
  const H = b.height;
  const facade: Facade = { glass: 0x6fb2dc, frame: 0x2d4a66, band: 0xe3e7ec };
  box(g, x - 0.1, y - 0.1, x1 + 0.1, y1 + 0.1, 0, 4, boxColors(0x9aa0a8));
  box(g, x, y, x1, y1, 4, 16, boxColors(0x3b4350));
  faceX(g, y1, x + 0.4, x1 - 0.4, 6, 17, 0x9fd3f0);
  faceX(g, y1, x + 2, x + 3, 6, 15, 0x2d4a66);
  faceY(g, x1, y + 0.4, y1 - 0.4, 6, 17, 0x6f9fbf);
  box(g, x + 1.4, y1, x + 3.6, y1 + 0.45, 17, 2, boxColors(accent));
  glassBox(g, x, y, x1, y1, 20, H, facade, b.w * 3 + b.y);
  faceX(g, y1, x, x1, H - 6, H, accent);
  faceY(g, x1, y, y1, H - 6, H, shade(accent, -0.2));
  diamond(g, x, y, x1, y1, H, shade(accent, 0.15));
  diamond(g, x + 0.2, y + 0.2, x1 - 0.2, y1 - 0.2, H, 0x59606b);
  rooftop(g, x, y, H, accent);
  faceY(g, x1, y1 - 0.75, y1 - 0.3, 28, H - 14, accent);
  faceY(g, x1, y1 - 0.62, y1 - 0.43, 30, H - 16, shade(accent, 0.35));
  const s = toScreen(x + b.w / 2, y1, H - 18);
  sign(g, b.name, s.x, s.y, accent, PAL.white);
}

export function drawHqTower(g: Graphics, b: CityBuilding): void {
  const { x, y } = b;
  const x1 = x + b.w;
  const y1 = y + b.d;
  const H = b.height;
  const P = 26;
  const facade: Facade = { glass: 0x4f95c9, frame: 0x24384f, band: 0xb9c6d4 };
  box(g, x - 0.2, y - 0.2, x1 + 0.2, y1 + 0.2, 0, 4, boxColors(0xb0b5bc));
  box(g, x, y, x1, y1, 4, P - 4, boxColors(0xe1e4e8, 0.06));
  faceX(g, y1, x + 0.3, x1 - 0.3, 7, P - 6, 0x2f5f8a);
  faceY(g, x1, y + 0.3, y1 - 0.3, 7, P - 6, 0x244c70);
  for (let i = 0; i < 9; i++) faceX(g, y1, x + 0.55 + i * 0.5, x + 0.6 + i * 0.5, 7, P - 6, 0xe1e4e8);
  box(g, x + 1.3, y1, x + 3.7, y1 + 0.6, P - 6, 3, boxColors(PAL.gold, 0.2));
  faceX(g, y1, x + 2.1, x + 2.9, 7, P - 7, 0x16283c);
  const i = 0.55;
  glassBox(g, x + i, y + i, x1 - i, y1 - i, P, H, facade, 4);
  for (const [cx0, cy0] of [[x1 - i - 0.06, y1 - i - 0.06], [x + i, y1 - i - 0.06], [x1 - i - 0.06, y + i]] as const) {
    box(g, cx0, cy0, cx0 + 0.12, cy0 + 0.12, P, H - P, boxColors(PAL.gold, 0.2));
  }
  faceX(g, y1 - i, x + i, x1 - i, H - 5, H, PAL.gold);
  faceY(g, x1 - i, y + i, y1 - i, H - 5, H, PAL.goldDark);
  diamond(g, x + i, y + i, x1 - i, y1 - i, H, 0x4a525e);
  const c = 1.3;
  glassBox(g, x + c, y + c, x1 - c, y1 - c, H, H + 20, { glass: 0x8cc6ea, frame: 0x24384f, band: PAL.gold }, 1);
  faceX(g, y1 - c, x + c, x1 - c, H + 17, H + 20, PAL.gold);
  faceY(g, x1 - c, y + c, y1 - c, H + 17, H + 20, PAL.goldDark);
  diamond(g, x + c, y + c, x1 - c, y1 - c, H + 20, PAL.goldLight);
  const mx = x + b.w / 2;
  const my = y + b.d / 2;
  box(g, mx - 0.3, my - 0.3, mx + 0.3, my + 0.3, H + 20, 8, boxColors(0x9aa2ad));
  box(g, mx - 0.08, my - 0.08, mx + 0.08, my + 0.08, H + 28, SPIRE_H - 34, boxColors(0xc9ced6));
  const tip = toScreen(mx, my, H + SPIRE_H - 6);
  rect(g, tip.x - 1, tip.y - 3, 3, 3, 0xff4d4d);
  g.ellipse(tip.x, tip.y - 2, 4, 3).fill({ color: 0xff4d4d, alpha: 0.25 });

  const e = toScreen(mx, y1 - i, H - 30);
  blob(g, e.x, e.y, 12, PAL.outline);
  blob(g, e.x, e.y, 11, PAL.gold);
  blob(g, e.x - 2, e.y - 3, 5, PAL.goldLight);
  pixelText(g, "Z", e.x - 3, e.y - 5, 0x2a2108, 2);
  const s = toScreen(mx, y1 + 0.3, P + 6);
  sign(g, b.name, s.x, s.y, PAL.gold, 0x2a2108);
}
