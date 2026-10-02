import { Container, Graphics, Text } from "pixi.js";
import { toScreen } from "../iso";
import { SEAT_KINDS, itemBox } from "../plan/boxes";
import type { Dir, Item } from "../plan";
import { FONT_FAMILY } from "./pills";
import { box, contactShadow, faceX, faceY, foliage, prism, shade, top } from "./iso3d";

const C = {
  oak: 0xb68a5e,
  walnut: 0x6e4a32,
  legs: 0x2a2c30,
  black: 0x25272b,
  blackHi: 0x3b3e43,
  leather: 0x8a6748,
  fabric: 0x8e8a84,
  marbleDark: 0x16171a,
  marbleVein: 0xb8a58c,
  white: 0xeeebe6,
  steel: 0x9aa0a8,
  screen: 0x1c1e22,
  glow: 0x9fdcff,
  pot: 0x3a3c40,
  book: [0x7d3b30, 0x2f5a7d, 0xc49a3c, 0x3f6b4a, 0x6b4f7d, 0xd8d2c6],
};

function legs(g: Graphics, x0: number, y0: number, x1: number, y1: number, h: number, inset = 0.08, t = 0.05): void {
  for (const [lx, ly] of [[x0 + inset, y0 + inset], [x1 - inset - t, y0 + inset], [x0 + inset, y1 - inset - t], [x1 - inset - t, y1 - inset - t]] as const) {
    box(g, lx, ly, lx + t, ly + t, 0, h, C.legs, { gradient: false });
  }
}

/** A monitor whose screen faces `dir`; we mostly see its back with a soft glow spilling over the top. */
function monitor(g: Graphics, cx: number, cy: number, z: number, dir: Dir): void {
  const along = dir === "-y" || dir === "+y";
  const w = 0.26;
  const t = 0.04;
  box(g, cx - 0.04, cy - 0.04, cx + 0.04, cy + 0.04, z, 0.12, C.legs, { gradient: false });
  const [x0, y0, x1, y1] = along ? [cx - w, cy - t, cx + w, cy + t] : [cx - t, cy - w, cx + t, cy + w];
  const s = toScreen(cx, cy, z + 0.42);
  g.ellipse(s.x, s.y, 16, 7).fill({ color: C.glow, alpha: 0.16 });
  box(g, x0, y0, x1, y1, z + 0.1, 0.32, C.screen, { gradient: false, top: C.blackHi });
  if (dir === "+y") faceY(g, y1, x0 + 0.02, x1 - 0.02, z + 0.13, z + 0.39, 0x6fb7e0, 0.9);
  if (dir === "+x") faceX(g, x1, y0 + 0.02, y1 - 0.02, z + 0.13, z + 0.39, 0x6fb7e0, 0.9);
}

function deskTop(g: Graphics, it: Item, wood: number): void {
  const { x, y, w, d } = it;
  const h = 0.5;
  legs(g, x, y, x + w, y + d, h - 0.05);
  const panel = shade(wood, -0.28);
  if (it.kind === "execDesk" || it.facing === "-y") box(g, x + 0.05, y + d - 0.1, x + w - 0.05, y + d - 0.05, 0.1, h - 0.15, panel, { gradient: false });
  if (it.facing === "-x") box(g, x + w - 0.1, y + 0.05, x + w - 0.05, y + d - 0.05, 0.1, h - 0.15, panel, { gradient: false });
  box(g, x, y, x + w, y + d, h - 0.05, 0.05, wood, { rim: true, gradient: false });
}

function desk(g: Graphics, it: Item): void {
  const wood = it.color ?? C.oak;
  deskTop(g, it, wood);
  const { x, y, w, d } = it;
  const dir = it.facing;
  const cx = x + w / 2;
  const cy = y + d / 2;
  const mx = dir === "-x" ? x + w - 0.25 : dir === "+x" ? x + 0.25 : cx;
  const my = dir === "-y" ? y + d - 0.25 : dir === "+y" ? y + 0.25 : cy;
  monitor(g, mx, my, 0.5, dir);
  const kx = dir === "-x" ? x + 0.3 : cx;
  const ky = dir === "-y" ? y + 0.3 : cy;
  top(g, kx - 0.14, ky - 0.06, kx + 0.14, ky + 0.06, 0.51, 0x3a3c40);
}

function execDesk(g: Graphics, it: Item): void {
  const wood = it.color ?? C.walnut;
  deskTop(g, it, wood);
  monitor(g, it.x + it.w * 0.62, it.y + it.d - 0.28, 0.5, "-y");
  top(g, it.x + 0.2, it.y + 0.3, it.x + 0.55, it.y + 0.55, 0.51, C.white);
  box(g, it.x + 0.15, it.y + 0.62, it.x + 0.3, it.y + 0.77, 0.5, 0.05, 0xc8a24a, { gradient: false });
}

/** Chair with its backrest away from `facing`. Pulled-out seat chairs sit on the back half of their tile. */
function chair(g: Graphics, it: Item): void {
  const seat = SEAT_KINDS.has(it.kind);
  const exec = it.kind === "execChair";
  const col = it.color ?? (exec ? 0x2a2420 : C.black);
  const b = itemBox(it);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const r = seat ? 0.2 : 0.22;
  contactShadow(g, cx - r, cy - r, cx + r, cy + r, 0.7);
  box(g, cx - 0.03, cy - 0.03, cx + 0.03, cy + 0.03, 0.03, 0.22, C.legs, { gradient: false });
  box(g, cx - r * 0.9, cy - r * 0.9, cx + r * 0.9, cy + r * 0.9, 0, 0.04, C.legs, { gradient: false });
  box(g, cx - r, cy - r, cx + r, cy + r, 0.25, 0.08, col, { top: shade(col, 0.15) });
  top(g, cx - r + 0.04, cy - r + 0.04, cx + r - 0.04, cy + r - 0.04, 0.331, shade(col, 0.24));
  const along = it.facing === "+y" || it.facing === "-y";
  const armA = along ? [cx - r, cy - r * 0.7, cx - r + 0.05, cy + r * 0.7] : [cx - r * 0.7, cy - r, cx + r * 0.7, cy - r + 0.05];
  const armB = along ? [cx + r - 0.05, cy - r * 0.7, cx + r, cy + r * 0.7] : [cx - r * 0.7, cy + r - 0.05, cx + r * 0.7, cy + r];
  if (exec || seat) {
    box(g, armA[0]!, armA[1]!, armA[2]!, armA[3]!, 0.33, 0.12, shade(col, -0.1), { gradient: false });
    box(g, armB[0]!, armB[1]!, armB[2]!, armB[3]!, 0.33, 0.12, shade(col, -0.1), { gradient: false });
  }
  const back = exec ? 0.42 : 0.32;
  const t = 0.07;
  switch (it.facing) {
    case "+y":
      box(g, cx - r, cy - r, cx + r, cy - r + t, 0.3, back, col, { top: shade(col, 0.2) });
      break;
    case "-y":
      box(g, cx - r, cy + r - t, cx + r, cy + r, 0.3, back, col, { top: shade(col, 0.2) });
      break;
    case "+x":
      box(g, cx - r, cy - r, cx - r + t, cy + r, 0.3, back, col, { top: shade(col, 0.2) });
      break;
    case "-x":
      box(g, cx + r - t, cy - r, cx + r, cy + r, 0.3, back, col, { top: shade(col, 0.2) });
      break;
  }
}

function table(g: Graphics, it: Item): void {
  const { x, y, w, d } = it;
  const board = it.kind === "boardTable";
  const col = it.color ?? (board ? C.marbleDark : C.oak);
  const h = 0.48;
  contactShadow(g, x + 0.1, y + 0.1, x + w - 0.1, y + d - 0.1);
  if (board) {
    const along = w >= d;
    for (const t of [0.22, 0.78]) {
      const px = along ? x + w * t : x + w / 2;
      const py = along ? y + d / 2 : y + d * t;
      box(g, px - 0.22, py - 0.22, px + 0.22, py + 0.22, 0, 0.04, 0x1a1b1e, { gradient: false });
      box(g, px - 0.12, py - 0.12, px + 0.12, py + 0.12, 0.04, h - 0.14, 0x232427);
    }
  } else {
    legs(g, x, y, x + w, y + d, h - 0.06, 0.12);
  }
  const thick = board ? 0.1 : 0.06;
  box(g, x, y, x + w, y + d, h - thick, thick, col, {
    rim: true,
    gradient: false,
    top: board ? 0x1d1e22 : undefined,
    left: shade(col, board ? 0.22 : -0.12),
    right: shade(col, board ? 0.1 : -0.3),
  });
  if (board) {
    const veins: [number, number, number, number][] = [
      [0.1, 0.25, 0.45, 0.35],
      [0.3, 0.55, 0.7, 0.5],
      [0.55, 0.2, 0.85, 0.3],
      [0.65, 0.7, 0.95, 0.78],
    ];
    for (const [a0, b0, a1, b1] of veins) {
      const px0 = x + a0 * w;
      const px1 = x + a1 * w;
      const py0 = y + b0 * d;
      top(g, px0, py0, px1, py0 + 0.04, h + 0.001, C.marbleVein, 0.45);
      top(g, px1 - 0.02, py0, px1 + 0.02, y + b1 * d + 0.04, h + 0.001, C.marbleVein, 0.35);
    }
    top(g, x + 0.05, y + 0.05, x + w - 0.05, y + 0.12, h + 0.002, 0xffffff, 0.06);
  } else if (it.kind === "meetingTable" && w * d >= 4) {
    box(g, x + w / 2 - 0.5, y + d / 2 - 0.12, x + w / 2 + 0.5, y + d / 2 + 0.12, h, 0.1, 0x3a3c40, { gradient: false });
    foliage(g, x + w / 2, y + d / 2, h + 0.15, 5);
  }
}

function sofa(g: Graphics, it: Item, armchair: boolean): void {
  const { x, y, w, d } = it;
  const col = it.color ?? (armchair ? C.leather : C.fabric);
  contactShadow(g, x + 0.05, y + 0.05, x + w - 0.05, y + d - 0.05);
  const i = armchair ? 0.12 : 0.06;
  const [x0, y0, x1, y1] = [x + i, y + i, x + w - i, y + d - i];
  box(g, x0, y0, x1, y1, 0, 0.25, col);
  const t = 0.18;
  const armH = 0.38;
  const backH = 0.55;
  const hi = shade(col, 0.1);
  switch (it.facing) {
    case "+y":
      box(g, x0, y0, x1, y0 + t, 0, backH, col, { top: hi });
      box(g, x0, y0, x0 + 0.14, y1, 0, armH, col, { top: hi });
      box(g, x1 - 0.14, y0, x1, y1, 0, armH, col, { top: hi });
      break;
    case "-y":
      box(g, x0, y0, x0 + 0.14, y1, 0, armH, col, { top: hi });
      box(g, x1 - 0.14, y0, x1, y1, 0, armH, col, { top: hi });
      box(g, x0, y1 - t, x1, y1, 0, backH, col, { top: hi });
      break;
    case "+x":
      box(g, x0, y0, x0 + t, y1, 0, backH, col, { top: hi });
      box(g, x0, y0, x1, y0 + 0.14, 0, armH, col, { top: hi });
      box(g, x0, y1 - 0.14, x1, y1, 0, armH, col, { top: hi });
      break;
    case "-x":
      box(g, x0, y0, x1, y0 + 0.14, 0, armH, col, { top: hi });
      box(g, x0, y1 - 0.14, x1, y1, 0, armH, col, { top: hi });
      box(g, x1 - t, y0, x1, y1, 0, backH, col, { top: hi });
      break;
  }
}

function plant(g: Graphics, it: Item, big: boolean): void {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.d / 2;
  if (big) {
    contactShadow(g, it.x + 0.05, it.y + 0.05, it.x + it.w - 0.05, it.y + it.d - 0.05);
    box(g, it.x + 0.08, it.y + 0.08, it.x + it.w - 0.08, it.y + it.d - 0.08, 0, 0.4, C.pot, { rim: true });
    const n = Math.max(1, Math.round(Math.max(it.w, it.d)));
    for (let k = 0; k < n; k++) {
      const fx = it.w >= it.d ? it.x + (k + 0.5) * (it.w / n) : cx;
      const fy = it.w >= it.d ? cy : it.y + (k + 0.5) * (it.d / n);
      foliage(g, fx, fy, 0.65, 11);
    }
    return;
  }
  contactShadow(g, cx - 0.25, cy - 0.25, cx + 0.25, cy + 0.25);
  prism(g, cx, cy, 0.22, 0, 0.38, 0xd8d3cb);
  foliage(g, cx, cy, 0.95, 13);
}

function bookcase(g: Graphics, it: Item, tall: number, col: number): void {
  const { x, y, w, d } = it;
  box(g, x + 0.04, y + 0.04, x + w - 0.04, y + d - 0.04, 0, tall, col, { rim: true });
  const alongX = w >= d;
  const shelves = Math.max(2, Math.floor(tall / 0.45));
  for (let s = 0; s < shelves; s++) {
    const z = 0.12 + s * (tall - 0.2) / shelves;
    const n = Math.round((alongX ? w : d) * 7);
    for (let k = 0; k < n; k++) {
      const a = 0.08 + (k / n) * ((alongX ? w : d) - 0.16);
      const bw = ((alongX ? w : d) - 0.16) / n - 0.015;
      const color = C.book[(k * 7 + s * 3 + x + y) % C.book.length]!;
      const hgt = 0.22 + ((k + s) % 3) * 0.04;
      if (alongX) faceY(g, y + d - 0.04, x + a, x + a + bw, z, z + hgt, color);
      else faceX(g, x + w - 0.04, y + a, y + a + bw, z, z + hgt, color);
    }
  }
}

/** Panel standing against the back edge of its tile (TVs, whiteboards, feature and slat walls). */
function panel(g: Graphics, it: Item, z0: number, z1: number, col: number, face: number, t = 0.1): { plane: "x" | "y"; at: number } {
  const { x, y, w, d } = it;
  if (it.facing === "+x") {
    box(g, x, y + 0.05, x + t, y + d - 0.05, z0, z1 - z0, col, { gradient: false });
    faceX(g, x + t, y + 0.12, y + d - 0.12, z0 + 0.06, z1 - 0.06, face);
    return { plane: "x", at: x + t };
  }
  box(g, x + 0.05, y, x + w - 0.05, y + t, z0, z1 - z0, col, { gradient: false });
  faceY(g, y + t, x + 0.12, x + w - 0.12, z0 + 0.06, z1 - 0.06, face);
  return { plane: "y", at: y + t };
}

/** Text lying on a front-left face (plane y = const), centred on the span [x0, x1] at height z. */
function faceText(c: Container, text: string, x0: number, x1: number, y: number, z: number, color: number, size: number): void {
  const t = new Text({ text, style: { fontFamily: FONT_FAMILY, fontSize: size, fontWeight: "600", fill: color, letterSpacing: 0.5 }, resolution: 3 });
  t.anchor.set(0.5);
  const p = toScreen((x0 + x1) / 2, y, z);
  t.position.set(p.x, p.y);
  t.skew.set(0, Math.atan(0.5));
  c.addChild(t);
}

export function drawItem(it: Item): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const { x, y, w, d } = it;
  switch (it.kind) {
    case "desk":
      contactShadow(g, x, y, x + w, y + d, 0.8);
      desk(g, it);
      break;
    case "execDesk":
      contactShadow(g, x, y, x + w, y + d);
      execDesk(g, it);
      break;
    case "officeChair":
    case "execChair":
    case "chair":
      chair(g, it);
      break;
    case "meetingTable":
    case "boardTable":
      table(g, it);
      break;
    case "roundTable":
      contactShadow(g, x + 0.2, y + 0.2, x + 0.8, y + 0.8);
      box(g, x + 0.46, y + 0.46, x + 0.54, y + 0.54, 0, 0.44, C.legs, { gradient: false });
      prism(g, x + 0.5, y + 0.5, 0.4, 0.44, 0.05, it.color ?? 0x7a5a40);
      prism(g, x + 0.5, y + 0.5, 0.08, 0.49, 0.12, 0xe8e2d8);
      break;
    case "coffeeTable":
      contactShadow(g, x + 0.1, y + 0.1, x + w - 0.1, y + d - 0.1);
      box(g, x + 0.15, y + 0.15, x + w - 0.15, y + d - 0.15, 0, 0.22, it.color ?? 0x3d3f43, { rim: true });
      break;
    case "stool":
      prism(g, x + 0.5, y + 0.5, 0.05, 0, 0.36, C.legs);
      prism(g, x + 0.5, y + 0.5, 0.2, 0.36, 0.06, it.color ?? 0x8a6a4c);
      break;
    case "sofa":
      sofa(g, it, false);
      break;
    case "armchair":
      sofa(g, it, true);
      break;
    case "bookcase":
      contactShadow(g, x, y, x + w, y + d, 0.6);
      bookcase(g, it, 1.85, C.walnut);
      break;
    case "shelf":
      bookcase(g, it, 1.55, 0x2e3034);
      for (let k = 0; k < Math.max(w, d); k++) foliage(g, x + (w > d ? k + 0.5 : 0.5), y + (w > d ? 0.5 : k + 0.5), 0.9, 7);
      break;
    case "credenza":
      contactShadow(g, x, y, x + w, y + d, 0.6);
      box(g, x + 0.05, y + 0.08, x + w - 0.05, y + d - 0.05, 0, 0.58, it.color ?? C.walnut, { rim: true });
      break;
    case "planter":
    case "plant":
      plant(g, it, it.kind === "planter");
      break;
    case "tv":
      panel(g, it, 0.55, 1.35, 0x1a1c20, 0x2c3c4e, 0.07);
      break;
    case "whiteboard":
      box(g, x + 0.2, y + 0.45, x + 0.28, y + 0.55, 0, 0.5, C.steel, { gradient: false });
      box(g, x + w - 0.28, y + 0.45, x + w - 0.2, y + 0.55, 0, 0.5, C.steel, { gradient: false });
      box(g, x + 0.1, y + 0.45, x + w - 0.1, y + 0.53, 0.5, 0.75, C.steel, { gradient: false });
      faceY(g, y + 0.53, x + 0.16, x + w - 0.16, 0.55, 1.2, 0xf8f8f6);
      break;
    case "featureWall":
    case "slatWall": {
      const slat = it.kind === "slatWall";
      const col = it.color ?? (slat ? 0x6b4a32 : 0xd8d2c8);
      const hgt = slat ? 1.9 : 1.7;
      const p = panel(g, it, 0, hgt, slat ? 0x2a2c30 : 0x2e3136, col, 0.3);
      if (slat && p.plane === "y") for (let k = 0.2; k < w - 0.1; k += 0.14) faceY(g, p.at, x + k, x + k + 0.05, 0.1, hgt - 0.1, 0x4a3322, 0.8);
      if (it.label && p.plane === "y") faceText(c, it.label, x, x + w, p.at, hgt * 0.62, it.color === 0x2b2e33 || slat ? 0xf4f1ec : 0x2a2b2e, 15);
      break;
    }
    case "reception": {
      contactShadow(g, x, y, x + w, y + d);
      box(g, x, y + 0.05, x + w, y + d, 0, 0.56, 0x2a2b2e, { top: 0x3a3b3f });
      for (let k = 0.15; k < w - 0.1; k += 0.12) faceY(g, y + d, x + k, x + k + 0.05, 0.05, 0.5, 0x6b4a32, 0.85);
      box(g, x - 0.04, y, x + w + 0.04, y + d + 0.04, 0.56, 0.06, 0x3d3e43, { rim: true, gradient: false });
      faceY(g, y + d + 0.04, x, x + w, 0.0, 0.03, 0xffe7b0, 0.8);
      if (it.label) faceText(c, it.label, x, x + w, y + d + 0.02, 0.3, 0xf4f1ec, 14);
      break;
    }
    case "counter":
      contactShadow(g, x, y, x + w, y + d, 0.6);
      box(g, x + 0.03, y + 0.03, x + w - 0.03, y + d - 0.03, 0, 0.56, it.color ?? 0x5a3e2a);
      box(g, x, y, x + w, y + d, 0.56, 0.05, 0xe4ded5, { rim: true, gradient: false });
      break;
    case "fridge":
      contactShadow(g, x, y, x + 1, y + 1, 0.6);
      box(g, x + 0.08, y + 0.08, x + 0.92, y + 0.92, 0, 1.6, 0x2f3236, { rim: true });
      break;
    case "printer":
      contactShadow(g, x, y, x + 1, y + 1, 0.6);
      box(g, x + 0.12, y + 0.12, x + 0.88, y + 0.88, 0, 0.6, 0xdedbd5, { rim: true });
      top(g, x + 0.25, y + 0.25, x + 0.75, y + 0.6, 0.601, 0x55585e);
      break;
    case "rack":
      box(g, x + 0.05, y + 0.05, x + w - 0.05, y + d - 0.05, 0, 2.0, 0x1b1d21);
      for (let k = 0; k < 12; k++) faceY(g, y + d - 0.05, x + 0.15, x + w - 0.15, 0.15 + k * 0.15, 0.17 + k * 0.15, k % 3 ? 0x3a7bd5 : 0x4cd97b, 0.8);
      break;
    case "foosball":
      contactShadow(g, x, y, x + w, y + d);
      legs(g, x + 0.1, y, x + w - 0.1, y + d, 0.38);
      box(g, x + 0.1, y, x + w - 0.1, y + d, 0.38, 0.14, 0x6b4a32);
      top(g, x + 0.16, y + 0.06, x + w - 0.16, y + d - 0.06, 0.521, 0x3f7a45);
      break;
    case "stairs":
      for (let k = 0; k < 6; k++) box(g, x, y + k * (d / 6), x + w, y + d, 0, 1.6 - k * 0.26, 0x8f8b85, { gradient: false });
      break;
    case "rug":
      break;
  }
  return c;
}

/** Rugs lie flat in the cached floor layer. */
export function drawRug(g: Graphics, it: Item): void {
  const col = it.color ?? 0x8a857d;
  top(g, it.x + 0.1, it.y + 0.1, it.x + it.w - 0.1, it.y + it.d - 0.1, 0.005, shade(col, -0.1));
  top(g, it.x + 0.18, it.y + 0.18, it.x + it.w - 0.18, it.y + it.d - 0.18, 0.006, col);
}
