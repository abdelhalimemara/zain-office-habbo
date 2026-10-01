import type { DivisionId } from "../../shared/divisions";
import type { Rank } from "../../shared/roster";
import { hashString, pick } from "./hash";
import { HAIR_COLORS, PAL, PANTS_COLORS, SKIN_TONES, divisionColor, shade } from "./palette";

export const HAIR_STYLES = ["short", "spiky", "long", "bun", "bob", "buzz", "curly", "hijab"] as const;
/** Board advisors draw from a slightly older set of cuts (kept separate so other agents' looks don't shift). */
export const BOARD_HAIR_STYLES = ["short", "receding", "buzz", "receding"] as const;
const BOARD_HAIR_COLORS = [0xc9ccd2, 0x9a9ea5, 0x6f6b67, 0x2b2622] as const;
export type HairStyle = (typeof HAIR_STYLES)[number] | "receding";
export type Outfit = "casual" | "suit" | "ceo" | "board";

export interface Appearance {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  outfit: Outfit;
  shirt: number;
  shirtShade: number;
  pants: number;
  shoes: number;
  tie: number;
  lapel: number;
  glasses: boolean;
}

const SHOES = [0x2a1d14, 0x1b1b1f, 0x5a3a22, 0xe6e6e6] as const;

export function appearanceFor(profile: string, division: DivisionId, rank: Rank): Appearance {
  const h = hashString(profile);
  if (rank === "board") return boardAppearance(h);
  const accent = divisionColor(division);
  const hairStyle = pick(HAIR_STYLES, h >>> 3);
  const hairColor = hairStyle === "hijab" ? pick([0x2a2f45, 0x6b2f45, 0x31524a, 0x4a3a2a], h >>> 21) : pick(HAIR_COLORS, h >>> 9);
  const outfit: Outfit = rank === "ceo" ? "ceo" : rank === "vp" ? "suit" : "casual";
  const suit = outfit === "ceo" ? 0x23232b : 0x2e3a4e;
  const shirt = outfit === "casual" ? accent : suit;
  return {
    skin: pick(SKIN_TONES, h),
    hair: hairColor,
    hairStyle,
    outfit,
    shirt,
    shirtShade: shade(shirt, -0.28),
    pants: outfit === "casual" ? pick(PANTS_COLORS, h >>> 14) : shade(suit, -0.15),
    shoes: outfit === "casual" ? pick(SHOES, h >>> 18) : 0x15151a,
    tie: outfit === "ceo" ? PAL.gold : accent,
    lapel: outfit === "ceo" ? PAL.gold : shade(suit, 0.18),
    glasses: false,
  };
}

/** Charcoal three-piece look with a gold lapel pin, silver-leaning hair and optional glasses. */
function boardAppearance(h: number): Appearance {
  const suit = 0x34363b;
  return {
    skin: pick(SKIN_TONES, h),
    hair: pick(BOARD_HAIR_COLORS, h >>> 9),
    hairStyle: pick(BOARD_HAIR_STYLES, h >>> 3),
    outfit: "board",
    shirt: suit,
    shirtShade: shade(suit, -0.3),
    pants: shade(suit, -0.2),
    shoes: 0x15151a,
    tie: 0x6b2737,
    lapel: shade(suit, 0.22),
    glasses: ((h >>> 13) & 1) === 1,
  };
}

function desaturate(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const tint = [lum * 0.92 + 10, lum * 0.96 + 14, lum + 26];
  const mix = (c: number, t: number) => Math.max(0, Math.min(255, Math.round(c + (t - c) * amount)));
  return (mix(r, tint[0]!) << 16) | (mix(g, tint[1]!) << 8) | mix(b, tint[2]!);
}

/** Washed-out, blue-grey variant used for roster seats nobody has been hired into yet. */
export function vacantAppearance(a: Appearance, amount = 0.8): Appearance {
  return {
    ...a,
    skin: desaturate(a.skin, amount),
    hair: desaturate(a.hair, amount),
    shirt: desaturate(a.shirt, amount),
    shirtShade: desaturate(a.shirtShade, amount),
    pants: desaturate(a.pants, amount),
    shoes: desaturate(a.shoes, amount),
    tie: desaturate(a.tie, amount),
    lapel: desaturate(a.lapel, amount),
  };
}
