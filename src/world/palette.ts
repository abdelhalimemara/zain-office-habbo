import { DIVISIONS, type DivisionId } from "../../shared/divisions";

/** Warm-white page colour behind every world view (the city and floor renders are transparent). */
export const PAGE_BACKGROUND = 0xf4f1ec;

export const PAL = {
  page: PAGE_BACKGROUND,
  gold: 0xf2c230,
  goldSoft: 0xe8c45a,
  ink: 0x17181a,
} as const;

export function hex(color: string): number {
  return Number.parseInt(color.replace("#", ""), 16);
}

export function divisionColor(id: DivisionId): number {
  return hex(DIVISIONS.find((d) => d.id === id)?.color ?? "#F2C230");
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0").toUpperCase()}`;
}
