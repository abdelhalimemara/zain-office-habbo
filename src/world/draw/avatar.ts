import type { Graphics } from "pixi.js";
import type { Appearance, HairStyle } from "../appearance";
import { PAL, shade } from "../palette";

export interface Pose {
  back: boolean;
  sitting: boolean;
  /** 0..3 walk cycle or typing frame. */
  frame: number;
  walking: boolean;
  typing: boolean;
}

type R = [number, number, number, number];

interface Part {
  rects: R[];
  color: number;
  outline: boolean;
}

const FRONT_HAIR: Record<HairStyle, R[]> = {
  short: [[-6, -32, 12, 4], [-6, -28, 2, 4], [4, -28, 2, 2]],
  spiky: [[-6, -32, 12, 3], [-5, -34, 2, 2], [-1, -35, 2, 3], [3, -34, 2, 2], [-6, -29, 2, 3]],
  long: [[-6, -32, 12, 4], [-7, -29, 3, 12], [4, -29, 3, 12]],
  bun: [[-6, -32, 12, 3], [-2, -36, 5, 4], [-6, -29, 2, 2]],
  bob: [[-7, -32, 14, 4], [-7, -28, 3, 8], [4, -28, 3, 8]],
  buzz: [[-6, -31, 12, 2]],
  curly: [[-7, -33, 14, 5], [-8, -30, 3, 5], [5, -30, 3, 5]],
  hijab: [[-7, -32, 14, 6], [-7, -26, 3, 9], [4, -26, 3, 9], [-4, -19, 9, 2]],
  receding: [[-6, -31, 3, 2], [3, -31, 3, 2], [-6, -29, 2, 5], [5, -29, 1, 3]],
};

const BACK_HAIR: Record<HairStyle, R[]> = {
  short: [[-6, -32, 12, 11]],
  spiky: [[-6, -32, 12, 11], [-5, -34, 2, 2], [-1, -35, 2, 3], [3, -34, 2, 2]],
  long: [[-7, -32, 14, 15]],
  bun: [[-6, -32, 12, 11], [-2, -36, 5, 4]],
  bob: [[-7, -32, 14, 12]],
  buzz: [[-6, -31, 12, 9]],
  curly: [[-7, -33, 14, 12], [-8, -30, 16, 5]],
  hijab: [[-7, -32, 14, 15]],
  receding: [[-6, -27, 12, 6], [-5, -29, 10, 2]],
};

function shift(rects: R[], dy: number): R[] {
  return rects.map(([x, y, w, h]) => [x, y + dy, w, h]);
}

export function drawAvatar(g: Graphics, a: Appearance, pose: Pose): void {
  const sit = pose.sitting ? 5 : 0;
  const bob = pose.typing && pose.frame % 2 === 1 ? -1 : 0;
  const up = sit + bob;
  const parts: Part[] = [];
  const add = (rects: R[], color: number, outline = true) => parts.push({ rects, color, outline });

  if (pose.sitting) {
    add([[-5, -6, 10, 4]], a.pants);
    add([[-4, -3, 3, 2], [1, -3, 3, 2]], a.shoes);
  } else {
    const step = pose.walking ? [0, 1, 0, -1][pose.frame % 4]! : 0;
    add([[-4, -9, 3, 7 - Math.max(0, step)], [1, -9, 3, 7 - Math.max(0, -step)]], a.pants);
    add([[-4, -2 - Math.max(0, step), 3, 2], [1, -2 - Math.max(0, -step), 3, 2]], a.shoes);
  }

  const swing = pose.walking ? [0, 1, 0, -1][pose.frame % 4]! : 0;
  const typeL = pose.typing ? (pose.frame % 2 === 0 ? -2 : -1) : 0;
  const typeR = pose.typing ? (pose.frame % 2 === 0 ? -1 : -2) : 0;
  add(shift([[-7, -17 + swing + typeL, 2, 7], [5, -17 - swing + typeR, 2, 7]], up), a.shirt);
  add(shift([[-5, -18, 10, 9]], up), a.shirt);
  add(shift([[-6, -30, 12, 11]], up), a.skin);
  add(shift(pose.back ? BACK_HAIR[a.hairStyle] : FRONT_HAIR[a.hairStyle], up), a.hair);

  g.ellipse(0, 0, 7, 3).fill({ color: PAL.black, alpha: 0.22 });
  for (const p of parts) if (p.outline) for (const [x, y, w, h] of p.rects) g.rect(x - 1, y - 1, w + 2, h + 2);
  g.fill(PAL.outline);
  for (const p of parts) {
    for (const [x, y, w, h] of p.rects) g.rect(x, y, w, h);
    g.fill(p.color);
  }

  const d = (rects: R[], color: number) => {
    for (const [x, y, w, h] of shift(rects, up)) g.rect(x, y, w, h);
    g.fill(color);
  };
  d([[3, -18, 2, 9]], a.shirtShade);
  d([[-7, -10 + swing + typeL, 2, 2], [5, -10 - swing + typeR, 2, 2]], a.skin);
  if (!pose.back) {
    if (a.hairStyle !== "hijab" && a.hairStyle !== "bob" && a.hairStyle !== "long" && a.hairStyle !== "curly") {
      d([[4, -28, 2, 9]], shade(a.skin, -0.12));
    }
    d([[-1, -25, 1, 2], [2, -25, 1, 2]], PAL.black);
    if (a.glasses) d([[-2, -26, 3, 1], [1, -26, 3, 1], [-2, -24, 1, 1], [3, -24, 1, 1]], 0x3a3530);
    d([[0, -21, 2, 1]], shade(a.skin, -0.3));
    if (a.outfit !== "casual") {
      d([[-1, -18, 3, 4]], PAL.white);
      d([[-2, -18, 1, 5], [2, -18, 1, 5]], a.lapel);
      d([[0, -17, 1, 5]], a.tie);
      if (a.outfit === "ceo") d([[-4, -16, 1, 1]], PAL.gold);
      if (a.outfit === "board") d([[-3, -17, 1, 1]], PAL.gold);
    } else {
      d([[-1, -18, 3, 1]], shade(a.shirt, 0.3));
    }
  } else if (a.outfit !== "casual") {
    d([[-1, -18, 3, 1]], PAL.white);
  }
}
