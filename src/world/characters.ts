import { CEO_PROFILE, type Rank } from "../../shared/roster";
import { hashString } from "./hash";

export const WORKER_SPRITES = [
  "female-1", "female-2", "female-3", "female-4", "female-5",
  "male-1", "male-2", "male-3", "male-4", "male-5", "male-6", "male-7", "male-8", "male-9",
] as const;

export const BOARD_SPRITES = ["hormozi", "alwaleed", "bezos", "buffett", "jobs"] as const;

export type WorkerSprite = (typeof WORKER_SPRITES)[number];
export type BoardSprite = (typeof BOARD_SPRITES)[number];
export type SpriteKey = `people/${WorkerSprite}` | `board/${BoardSprite}`;

export const BOARD_SPRITE_BY_PROFILE: Readonly<Record<string, BoardSprite>> = {
  "zain-board-hormozi": "hormozi",
  "zain-board-alwaleed": "alwaleed",
  "zain-board-bezos": "bezos",
  "zain-board-buffett": "buffett",
  "zain-board-jobs": "jobs",
};

/** The CEO always wears the sharp dark suit. */
export const CEO_SPRITE: SpriteKey = "people/male-1";

/** Named agents with a fixed look. */
export const NAMED_SPRITE_BY_PROFILE: Readonly<Record<string, SpriteKey>> = {
  "zain-hq-accounts": "people/male-2",
};

export function spriteFor(profile: string, rank: Rank): SpriteKey {
  const board = BOARD_SPRITE_BY_PROFILE[profile];
  if (board) return `board/${board}`;
  if (rank === "ceo" || profile === CEO_PROFILE) return CEO_SPRITE;
  const named = NAMED_SPRITE_BY_PROFILE[profile];
  if (named) return named;
  const h = hashString(profile);
  return `people/${WORKER_SPRITES[h % WORKER_SPRITES.length]!}`;
}

/** Deterministic left/right preference for people standing about, so a crowd doesn't all face one way. */
export function prefersMirror(profile: string): boolean {
  return ((hashString(profile) >>> 7) & 1) === 1;
}
