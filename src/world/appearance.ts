import type { DivisionId } from "../../shared/divisions";
import type { Rank } from "../../shared/roster";
import { hashString, pick } from "./hash";
import { HAIR_COLORS, PAL, PANTS_COLORS, SKIN_TONES, divisionColor, shade } from "./palette";

export const HAIR_STYLES = ["short", "spiky", "long", "bun", "bob", "buzz", "curly", "hijab"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Outfit = "casual" | "suit" | "ceo";

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
}

const SHOES = [0x2a1d14, 0x1b1b1f, 0x5a3a22, 0xe6e6e6] as const;

export function appearanceFor(profile: string, division: DivisionId, rank: Rank): Appearance {
  const h = hashString(profile);
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
  };
}
