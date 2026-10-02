import { hash3 } from "./color";
import type { HairStyle } from "./types";

/** Half-open box [x0, x1) × [y0, y1) × [z0, z1) in head-core coordinates, with the material it paints. */
type Box = readonly [number, number, number, number, number, number, number?];

/** 0 empty, 1 hair, 2 ghutra cloth, 3 agal, 4 cap fabric, 5 logo. */
export interface HairShape {
  at(x: number, y: number, z: number): number;
}

interface Shell {
  top: number;
  side: number;
  back: number;
  sideLow: number;
  sideFront: number;
  backLow: number;
  fringe: readonly [number, number];
  overhang: boolean;
  frame: number;
  wavy: boolean;
  add: readonly Box[];
  cut: readonly Box[];
}

const NONE = 99;

function shellFor(style: HairStyle, W: number, D: number, H: number): Shell | null {
  const T = H - 15;
  const base: Shell = {
    top: 2,
    side: 1,
    back: 1,
    sideLow: 9 + T,
    sideFront: 3,
    backLow: 3,
    fringe: [12 + T, 12 + T],
    overhang: true,
    frame: NONE,
    wavy: false,
    add: [],
    cut: [],
  };
  switch (style) {
    case "bald":
      return null;
    case "sidePart":
      return {
        ...base,
        top: 3,
        add: [
          [4, W + 1, 2, D + 1, H + 3, H + 4],
          [W, W + 2, 1, D - 2, 9 + T, H + 2],
          [-2, -1, 0, D - 4, 10 + T, H + 1],
        ],
        cut: [[3, 4, 3, D + 1, H + 2, H + 4]],
      };
    case "quiff":
      return {
        ...base,
        top: 3,
        add: [
          [2, W, 3, D + 1, H + 3, H + 5],
          [W, W + 2, 1, D - 2, 9 + T, H + 2],
        ],
        cut: [[1, 2, 4, D + 1, H + 2, H + 3]],
      };
    case "short":
      return { ...base, top: 2, sideLow: 7 + T, sideFront: 4, backLow: 3, fringe: [H - 1, H - 1], overhang: false, side: 1, add: [[2, W - 1, 3, D - 2, H + 2, H + 3]] };
    case "wavyWhite":
      return { ...base, top: 2, side: 3, back: 2, sideLow: 6 + T, sideFront: 4, backLow: 3, fringe: [H - 1, H - 1], overhang: false, wavy: true };
    case "bun":
      return { ...base, sideLow: 7 + T, backLow: 2, fringe: [10 + T, 12 + T], add: [[7, W + 1, -1, 6, H + 2, H + 6], [W, W + 2, 0, D - 3, 6 + T, H + 1]] };
    case "topKnot":
      return { ...base, sideLow: 7 + T, backLow: 2, fringe: [12 + T, 10 + T], add: [[W - 7, W, -2, 4, H + 2, H + 6], [W, W + 2, 0, D - 3, 7 + T, H + 1]] };
    case "lowBun":
      return { ...base, side: 2, sideLow: 3, backLow: 1, fringe: [10 + T, 12 + T], frame: 6 + T, add: [[W - 1, W + 4, -3, 6, 2, 12 + T]] };
    case "bob":
      return { ...base, side: 2, back: 2, sideLow: -1, backLow: -2, fringe: [10 + T, 12 + T], frame: 3, add: [[W + 1, W + 3, -2, 6, 4, 14 + T]] };
    case "wavyLong":
      return { ...base, side: 2, back: 2, sideLow: -3, backLow: -4, fringe: [11 + T, 12 + T], frame: 2, wavy: true, add: [[-3, -2, 0, D - 2, -2, 12 + T], [W + 2, W + 3, 0, D - 2, -2, 12 + T]] };
    case "cap":
      return {
        ...base,
        top: 0,
        side: 2,
        back: 2,
        sideLow: 3,
        sideFront: 8,
        backLow: 1,
        fringe: [NONE, NONE],
        overhang: false,
        wavy: true,
        add: [
          [-1, W + 1, -1, D + 1, H - 3, H + 4, 4],
          [-1, W + 1, D + 1, D + 5, H - 3, H - 2, 4],
          [W, W + 3, 0, 4, 2, 10 + T],
        ],
      };
    case "ghutra":
      return {
        ...base,
        top: 0,
        side: 0,
        back: 0,
        sideLow: NONE,
        backLow: NONE,
        fringe: [NONE, NONE],
        overhang: false,
        frame: 5 + T,
        add: [
          [0, W, 0, D, H - 1, H + 2, 2],
          [1, W - 1, 1, D - 1, H + 2, H + 3, 2],
          [3, W - 3, 3, D - 3, H + 3, H + 4, 2],
          [-2, 0, -2, D + 1, -9, H - 3, 2],
          [-1, 2, D, D + 2, -9, 0, 2],
          [W, W + 2, -2, D + 1, -10, H - 3, 2],
          [-2, W + 2, -3, 0, -10, H - 3, 2],
        ],
      };
  }
}

export function hairShape(style: HairStyle, W: number, D: number, H: number): HairShape {
  const s = shellFor(style, W, D, H);
  if (!s) return { at: () => 0 };
  const inBox = (b: Box, x: number, y: number, z: number) => x >= b[0] && x < b[1] && y >= b[2] && y < b[3] && z >= b[4] && z < b[5];
  const fringeAt = (x: number) => Math.round(s.fringe[0] + ((s.fringe[1] - s.fringe[0]) * x) / Math.max(1, W - 1));
  return {
    at(x, y, z) {
      for (const b of s.cut) if (inBox(b, x, y, z)) return 0;
      if (style === "ghutra" && z >= H - 3 && z < H) {
        const inRing = x >= -2 && x < W + 2 && y >= -2 && y < D + 2;
        if (inRing && (x < 0 || x >= W || y < 0 || y >= D)) return 3;
      }
      if (style === "cap" && y === D && Math.abs(x - (W - 1) / 2) < 3 && logo(x - (W - 1) / 2, H + 2 - z)) return 5;
      for (const b of s.add) if (inBox(b, x, y, z)) return b[6] ?? 1;
      const inX = x >= 0 && x < W;
      const inY = y >= 0 && y < D;
      const sideX = (x < 0 && x >= -s.side) || (x >= W && x < W + s.side);
      const wave = s.wavy ? Math.floor(hash3(Math.floor(x / 3), Math.floor(y / 3), 1) * 2.2) : 0;
      if (z >= H && z < H + s.top + (z === H + s.top ? wave : 0) + (s.wavy ? 1 : 0)) {
        if (x < -s.side || x >= W + s.side || y < -s.back || y >= D) return 0;
        const outer = (x < 0 || x >= W ? 1 : 0) + (y < 0 ? 1 : 0);
        if (z >= H + s.top - 1 && outer >= 1 && z > H) return s.wavy && hash3(Math.floor(x / 3), z, Math.floor(y / 3)) > 0.5 ? 1 : 0;
        return 1;
      }
      if (z >= H) return 0;
      const lowSide = s.sideLow - (s.wavy ? Math.floor(hash3(Math.floor(y / 3), Math.floor(z / 3), 2) * 2.5) : 0);
      if (sideX && y >= -s.back && y < D - s.sideFront && z >= lowSide) return 1;
      if (y < 0 && y >= -s.back && x >= -s.side && x < W + s.side && z >= s.backLow) return 1;
      if (s.overhang && y === D && inX && z >= fringeAt(x) + 1 && z < H) return 1;
      if (!inX || !inY || z < 0) return 0;
      if (y === D - 1 && z >= fringeAt(x)) return 1;
      if (y === D - 1 && (x === 0 || x === W - 1) && z >= s.frame) return 1;
      if ((x === 0 || x === W - 1) && y < D - s.sideFront && z >= s.sideLow) return 1;
      if (y === 0 && z >= s.backLow) return 1;
      if (z === H - 1 && s.top > 0) return 1;
      return 0;
    },
  };
}

function logo(x: number, row: number): boolean {
  const ax = Math.abs(x);
  if (row === 0) return ax < 0.6;
  if (row === 1) return ax < 1.6 && ax > 0.4;
  if (row === 2) return ax < 2.6;
  return false;
}
