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

/** The CEO agent is Susu, the founder's chief of staff, in the sharp dark skirt suit. */
export const CEO_SPRITE: SpriteKey = "people/female-1";

/** Named agents with a fixed look: each a distinct sprite that matches their gender. */
export const NAMED_SPRITE_BY_PROFILE: Readonly<Record<string, SpriteKey>> = {
  [CEO_PROFILE]: CEO_SPRITE,
  "zain-hq-accounts": "people/male-2",
  "zain-hq-coo": "people/male-1",
  "zain-studio-vp": "people/female-3",
  "zain-growth-vp": "people/male-4",
  "zain-labs-vp": "people/female-5",
  "zain-tech-vp": "people/male-6",
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
