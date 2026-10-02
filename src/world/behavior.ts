import type { Emote, Facing, Pose } from "./avatars";
import type { Dir } from "./plan";
import type { WorldAgent } from "./types";

/** Plan direction (tile space) → avatar facing. +x is screen down-right, +y screen down-left. */
export function dirFacing(dir: Dir): Facing {
  switch (dir) {
    case "+x":
      return "SE";
    case "+y":
      return "SW";
    case "-x":
      return "NW";
    case "-y":
      return "NE";
  }
}

/** Facing for a walk segment of (dx, dy) tiles, by its screen direction; `prev` breaks exact ties. */
export function segmentFacing(dx: number, dy: number, prev: Facing): Facing {
  const sx = dx - dy;
  const sy = dx + dy;
  if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) return prev;
  if (Math.abs(sx) < 1e-6) return sy > 0 ? (prev === "SE" ? "SE" : "SW") : prev === "NE" ? "NE" : "NW";
  if (Math.abs(sy) < 1e-6) return sx > 0 ? (prev === "NE" ? "NE" : "SE") : prev === "NW" ? "NW" : "SW";
  if (sy > 0) return sx > 0 ? "SE" : "SW";
  return sx > 0 ? "NE" : "NW";
}

/** Pose at a desk seat: typing while working, sitting otherwise. */
export function seatPose(agent: Pick<WorldAgent, "activity" | "hired">): Pose {
  return agent.hired && agent.activity === "working" ? "type" : "sit";
}

/** Looping or periodic emote that belongs to an activity. */
export function stateEmote(activity: WorldAgent["activity"]): Emote {
  if (activity === "blocked") return "frustrated";
  if (activity === "awaiting-approval") return "thinking";
  return "none";
}

/** One-off emote when an agent finishes its work (working → idle); deterministic per agent. */
export function finishEmote(seed: number): Emote {
  return seed % 2 === 0 ? "celebrate" : "thumbsUp";
}

const THINK_EVERY_MS = 7000;
const SLEEPY_AFTER_MS = 15000;

export interface EmoteInput {
  activity: WorldAgent["activity"];
  hired: boolean;
  selected: boolean;
  walking: boolean;
  /** Time resting without moving, for the occasional sleepy emote. */
  restingMs: number;
  /** The avatar's current emote (timed emotes fall back to "none" by themselves). */
  current: Emote;
}

/**
 * Decides when to start an emote. Pure and deterministic apart from the clock it is fed; returns the emote to set,
 * or null to leave the avatar alone.
 */
export class EmoteDirector {
  private prev: EmoteInput | null = null;
  private sinceThink = 0;

  constructor(private readonly seed: number) {}

  next(input: EmoteInput, dtMs: number): Emote | null {
    const prev = this.prev;
    this.prev = input;
    if (!input.hired) return input.current === "none" ? null : "none";
    if (input.selected && !prev?.selected) return "wave";
    if (prev && prev.activity === "working" && input.activity === "idle") return finishEmote(this.seed);
    const state = stateEmote(input.activity);
    if (state === "frustrated") return input.current === "frustrated" ? null : "frustrated";
    if (input.current === "frustrated") return "none";
    if (state === "thinking") {
      if (prev?.activity !== "awaiting-approval") {
        this.sinceThink = 0;
        return "thinking";
      }
      this.sinceThink += dtMs;
      if (input.current === "none" && this.sinceThink >= THINK_EVERY_MS) {
        this.sinceThink = 0;
        return "thinking";
      }
      return null;
    }
    if (input.current === "sleepy" && (input.walking || input.activity !== "idle")) return "none";
    if (input.activity === "idle" && !input.walking && input.current === "none" && input.restingMs >= SLEEPY_AFTER_MS) return "sleepy";
    return null;
  }
}
