import type { Graphics } from "pixi.js";
import { toScreen } from "../iso";
import { CITY_SIZE, cityTileAt, type CityProp, type CityTile } from "../layouts/city";
import { PAL, shade } from "../palette";
import { blob, box, boxColors, diamond, faceX, faceY, rect } from "./primitives";

const ROAD_COLS = new Set([11, 12, 23, 24]);

function isRoadish(t: CityTile): boolean {
  return t === "road" || t === "junction" || t === "crosswalk";
}

function groundTile(g: Graphics, x: number, y: number): void {
  const t = cityTileAt(x, y);
  const alt = (x + y) % 2 === 0;
  switch (t) {
    case "road":
    case "junction":
    case "crosswalk": {
      diamond(g, x, y, x + 1, y + 1, 0, PAL.road);
      const alongY = ROAD_COLS.has(x) && !ROAD_COLS.has(y);
      if (t === "road") {
        if (alongY && (x === 12 || x === 24) && y % 2 === 0) diamond(g, x - 0.03, y + 0.2, x + 0.03, y + 0.8, 0, PAL.roadLine);
        if (!alongY && (y === 12 || y === 24) && x % 2 === 0) diamond(g, x + 0.2, y - 0.03, x + 0.8, y + 0.03, 0, PAL.roadLine);
      }
      if (t === "crosswalk") {
        for (let k = 0; k < 4; k++) {
          const a = 0.06 + k * 0.25;
          if (alongY) diamond(g, x + a, y + 0.12, x + a + 0.13, y + 0.88, 0, PAL.roadLine);
          else diamond(g, x + 0.12, y + a, x + 0.88, y + a + 0.13, 0, PAL.roadLine);
        }
      }
      return;
    }
    case "sidewalk": {
      diamond(g, x, y, x + 1, y + 1, 0, alt ? PAL.sidewalk : PAL.sidewalkB);
      const n = [cityTileAt(x + 1, y), cityTileAt(x, y + 1), cityTileAt(x - 1, y), cityTileAt(x, y - 1)];
      if (isRoadish(n[0]!)) diamond(g, x + 0.88, y, x + 1, y + 1, 0, PAL.curb);
      if (isRoadish(n[1]!)) diamond(g, x, y + 0.88, x + 1, y + 1, 0, PAL.curb);
      if (isRoadish(n[2]!)) diamond(g, x, y, x + 0.12, y + 1, 0, PAL.curb);
      if (isRoadish(n[3]!)) diamond(g, x, y, x + 1, y + 0.12, 0, PAL.curb);
      return;
    }
    case "plaza":
      diamond(g, x, y, x + 1, y + 1, 0, alt ? PAL.plaza : PAL.plazaB);
      if ((x * 3 + y) % 4 === 0) diamond(g, x + 0.4, y + 0.4, x + 0.6, y + 0.6, 0, 0xc1c6cc);
      return;
    case "grass":
      diamond(g, x, y, x + 1, y + 1, 0, alt ? PAL.grassA : PAL.grassB);
      if ((x * 7 + y * 13) % 5 === 0) diamond(g, x + 0.3, y + 0.5, x + 0.42, y + 0.62, 0, 0x4b8d3c);
      return;
    case "sand":
      diamond(g, x, y, x + 1, y + 1, 0, alt ? PAL.sand : shade(PAL.sand, -0.05));
      return;
    case "water":
    case "dock":
      diamond(g, x, y, x + 1, y + 1, -3, alt ? PAL.water : shade(PAL.water, 0.05));
      if ((x * 5 + y * 3) % 4 === 0) diamond(g, x + 0.2, y + 0.45, x + 0.7, y + 0.52, -3, PAL.waterLight);
      if (t === "dock") {
        box(g, x, y + 0.05, x + 1, y + 0.95, -3, 5, boxColors(PAL.woodLight, 0.1));
        for (const k of [0.33, 0.66]) diamond(g, x, y + k - 0.02, x + 1, y + k + 0.02, 2, PAL.woodDark);
      }
      return;
  }
}

export function drawCityGround(g: Graphics): void {
  const n = CITY_SIZE;
  faceX(g, n, 0, n, -16, 0, 0x5b4632);
  faceY(g, n, 0, n, -16, 0, 0x45351f);
  faceX(g, n, 28, n, -16, -3, 0x1f5f95);
  faceY(g, n, 28, n, -16, -3, 0x184c78);
  faceX(g, n, 0, n, -16, -12, 0x3a2c1e);
  faceY(g, n, 0, n, -16, -12, 0x2c2116);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) groundTile(g, x, y);
}

function shadowAt(g: Graphics, tx: number, ty: number, rx: number): void {
  const s = toScreen(tx, ty);
  g.ellipse(Math.round(s.x), Math.round(s.y), rx, Math.max(2, Math.round(rx / 2))).fill({ color: PAL.black, alpha: 0.2 });
}

export const PROP_HEIGHT: Record<CityProp["kind"], number> = {
  tree: 34, palm: 40, lamp: 26, fountain: 22, bench: 8, bush: 10, boat: 10,
};

export function drawProp(g: Graphics, p: CityProp): void {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.d / 2;
  const s = toScreen(cx, cy);
  switch (p.kind) {
    case "tree":
      shadowAt(g, cx, cy, 9);
      rect(g, s.x - 1, s.y - 12, 3, 12, PAL.trunk);
      blob(g, s.x + 1, s.y - 20, 9, 0x2f7a32);
      blob(g, s.x - 2, s.y - 23, 6, PAL.leafA);
      blob(g, s.x + 3, s.y - 26, 5, PAL.leafB);
      blob(g, s.x, s.y - 28, 3, PAL.leafC);
      return;
    case "palm": {
      shadowAt(g, cx, cy, 7);
      for (let i = 0; i < 9; i++) rect(g, s.x + Math.round(i * i * 0.05), s.y - 3 - i * 3, 3, 4, i % 2 ? 0x8a6a3e : 0x7a5a32);
      const top = { x: s.x + 5, y: s.y - 30 };
      const fronds: [number, number][] = [[-9, 3], [-6, -2], [0, -4], [6, -2], [9, 3], [3, 5], [-3, 5]];
      for (const [dx, dy] of fronds) {
        for (let k = 1; k <= 4; k++) rect(g, top.x + (dx * k) / 4, top.y + (dy * k) / 4 + (k > 2 ? k - 2 : 0), 3, 2, k > 2 ? PAL.leafB : PAL.leafA);
      }
      rect(g, top.x - 1, top.y - 1, 4, 3, 0x6b4a2a);
      return;
    }
    case "lamp":
      rect(g, s.x, s.y - 24, 1, 24, 0x2a2f38);
      rect(g, s.x - 1, s.y - 2, 3, 2, 0x2a2f38);
      rect(g, s.x - 2, s.y - 27, 5, 3, 0x2a2f38);
      rect(g, s.x - 1, s.y - 25, 3, 2, 0xffe9a0);
      g.ellipse(s.x, s.y - 24, 5, 3).fill({ color: 0xffe9a0, alpha: 0.18 });
      return;
    case "fountain": {
      const { x, y, w, d } = p;
      box(g, x + 0.1, y + 0.1, x + w - 0.1, y + d - 0.1, 0, 5, boxColors(0xd5d9df));
      diamond(g, x + 0.3, y + 0.3, x + w - 0.3, y + d - 0.3, 5, 0x5aa6e0);
      diamond(g, x + 0.5, y + 0.5, x + w - 0.5, y + d - 0.5, 5, 0x7fc0ee);
      box(g, cx - 0.15, cy - 0.15, cx + 0.15, cy + 0.15, 5, 10, boxColors(0xd5d9df));
      box(g, cx - 0.35, cy - 0.35, cx + 0.35, cy + 0.35, 15, 2, boxColors(0xc9ccd1));
      blob(g, s.x, s.y - 21, 3, 0xbfe6ff);
      rect(g, s.x - 1, s.y - 26, 2, 6, 0xdff3ff);
      return;
    }
    case "bench":
      box(g, p.x + 0.15, p.y + 0.35, p.x + 0.85, p.y + 0.65, 3, 2, boxColors(PAL.wood));
      box(g, p.x + 0.15, p.y + 0.3, p.x + 0.85, p.y + 0.38, 5, 4, boxColors(PAL.woodDark));
      return;
    case "bush":
      shadowAt(g, cx, cy, 6);
      blob(g, s.x, s.y - 4, 5, PAL.leafA);
      blob(g, s.x + 2, s.y - 6, 3, PAL.leafB);
      return;
    case "boat":
      box(g, p.x + 0.1, p.y - 0.4, p.x + 0.9, p.y + 1.4, -3, 5, boxColors(PAL.white));
      faceY(g, p.x + 0.9, p.y - 0.4, p.y + 1.4, -1, 1, PAL.red);
      box(g, p.x + 0.3, p.y + 0.2, p.x + 0.7, p.y + 0.8, 2, 5, boxColors(0x9fd3f0));
      return;
  }
}
