import { DIVISIONS, type DivisionId } from "../../shared/divisions";

export const PAL = {
  sky: 0x13294b,
  skyDeep: 0x0d1d38,
  outline: 0x1a1c22,
  wall: 0x2b2f36,
  wallDark: 0x22252b,
  wallTop: 0x5a616d,
  wallTopHi: 0x737b88,
  tileA: 0xc9ccd1,
  tileB: 0xb7bbc1,
  tileEdge: 0x8d929a,
  slab: 0x3a4250,
  slabDark: 0x2a313c,
  wood: 0xa0693a,
  woodLight: 0xb57a46,
  woodDark: 0x7d4f2a,
  carpet: 0x5b6878,
  carpetLight: 0x66748a,
  gold: 0xf2c230,
  goldDark: 0xb98f17,
  goldLight: 0xffe07a,
  glass: 0x9fd3f0,
  glassDark: 0x5fa8d3,
  glassFrame: 0x3d5a78,
  leafA: 0x3f8f3a,
  leafB: 0x57ad45,
  leafC: 0x7cc95a,
  trunk: 0x6b4423,
  pot: 0xb5653a,
  white: 0xf4f5f7,
  offWhite: 0xdfe3e8,
  metal: 0x9aa2ad,
  metalDark: 0x5f6773,
  black: 0x15171c,
  screenOff: 0x2a3a4c,
  screenOn: 0x7fe3ff,
  red: 0xe24a4a,
  yellow: 0xf7d046,
  road: 0x3a3f47,
  roadLine: 0xe8e8e0,
  sidewalk: 0xc9ccd1,
  sidewalkB: 0xbcc0c6,
  curb: 0x8d929a,
  plaza: 0xd9dce0,
  plazaB: 0xcdd1d6,
  grassA: 0x5da34b,
  grassB: 0x67ae52,
  water: 0x2f7fc1,
  waterLight: 0x5aa6e0,
  sand: 0xe0c98f,
} as const;

export const SKIN_TONES = [0xf5d0b0, 0xe8b48a, 0xc98e62, 0xa86d45, 0x7a4a2c] as const;
export const HAIR_COLORS = [0x1d1a17, 0x3b2516, 0x6a3f1e, 0xb07a3c, 0x2a2a30, 0x8a8a8a, 0x5a2a20] as const;
export const PANTS_COLORS = [0x2f3a52, 0x3a3a40, 0x4a3b2c, 0x24324a, 0x50545c] as const;

export function hex(color: string): number {
  return Number.parseInt(color.replace("#", ""), 16);
}

export function divisionColor(id: DivisionId): number {
  return hex(DIVISIONS.find((d) => d.id === id)?.color ?? "#F2C230");
}

export function shade(color: number, factor: number): number {
  const ch = (shift: number) => {
    const v = (color >> shift) & 0xff;
    const out = factor >= 0 ? v + (255 - v) * factor : v * (1 + factor);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
