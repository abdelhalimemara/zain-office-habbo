import { REST_RIG } from "./model";
import type { Emote, Pose, Rig } from "./types";

export interface Clip {
  frames: number;
  frameMs: number;
  /** Timed emotes return to "none" after this many ms; undefined loops while set. */
  durationMs?: number;
  /** Frame held when motion is reduced. */
  still: number;
}

export const POSE_CLIPS: Readonly<Record<Pose, Clip>> = {
  stand: { frames: 1, frameMs: 1000, still: 0 },
  walk: { frames: 6, frameMs: 110, still: 0 },
  sit: { frames: 1, frameMs: 1000, still: 0 },
  type: { frames: 4, frameMs: 130, still: 0 },
};

export const EMOTE_CLIPS: Readonly<Record<Emote, Clip>> = {
  none: { frames: 1, frameMs: 1000, still: 0 },
  wave: { frames: 4, frameMs: 150, durationMs: 1800, still: 1 },
  thumbsUp: { frames: 1, frameMs: 1000, durationMs: 1600, still: 0 },
  frustrated: { frames: 4, frameMs: 110, still: 0 },
  thinking: { frames: 1, frameMs: 1000, durationMs: 2600, still: 0 },
  celebrate: { frames: 4, frameMs: 150, durationMs: 1800, still: 1 },
  sleepy: { frames: 4, frameMs: 380, still: 2 },
};

/** Vertical hop (voxels) per celebrate frame; applied as a sprite offset, not geometry. */
export const HOP = [0, 2, 3, 1] as const;

const WALK_SWING = 22;

/** Joint angles for one frame of a pose with an emote layered over the upper body. */
export function rigFor(pose: Pose, poseFrame: number, emote: Emote, emoteFrame: number, legLen: number, thighLen: number): Rig {
  const r: Rig = {
    ...REST_RIG,
    shoulderR: { ...REST_RIG.shoulderR },
    shoulderL: { ...REST_RIG.shoulderL },
  };
  const seated = pose === "sit" || pose === "type";
  if (pose === "walk") {
    const s = Math.sin((poseFrame / POSE_CLIPS.walk.frames) * Math.PI * 2);
    r.hipR = WALK_SWING * s;
    r.hipL = -WALK_SWING * s;
    r.kneeR = s < 0 ? -s * 22 : 0;
    r.kneeL = s > 0 ? s * 22 : 0;
    r.shoulderR.pitch = -24 * s;
    r.shoulderL.pitch = 24 * s;
    r.elbowR = r.elbowL = 10;
    r.drop = Math.round(legLen * (1 - Math.cos((WALK_SWING * Math.abs(s) * Math.PI) / 180)));
  } else if (seated) {
    r.hipR = r.hipL = 90;
    r.kneeR = r.kneeL = 90;
    r.drop = thighLen;
    if (pose === "type") {
      const wiggle = [8, 0, -8, 0][poseFrame % 4]!;
      r.shoulderR.pitch = r.shoulderL.pitch = 24;
      r.elbowR = 62 + wiggle;
      r.elbowL = 62 - wiggle;
    } else {
      r.shoulderR.pitch = r.shoulderL.pitch = 12;
      r.elbowR = r.elbowL = 40;
    }
  }
  switch (emote) {
    case "wave":
      r.shoulderL = { pitch: 0, roll: [140, 160, 172, 158][emoteFrame % 4]!, yaw: 0 };
      r.elbowL = 0;
      break;
    case "thumbsUp":
      r.shoulderL = { pitch: 20, roll: 6, yaw: 0 };
      r.elbowL = 70;
      r.thumbL = true;
      break;
    case "frustrated":
      r.headYaw = [0, 14, 0, -14][emoteFrame % 4]!;
      r.shoulderR = { pitch: -6, roll: 14, yaw: 0 };
      r.shoulderL = { pitch: -6, roll: 14, yaw: 0 };
      r.elbowR = r.elbowL = 0;
      break;
    case "thinking":
      r.shoulderR = { pitch: 15, roll: -18, yaw: -25 };
      r.elbowR = 140;
      r.headYaw = -6;
      r.headPitch = -4;
      break;
    case "celebrate": {
      const lift = [150, 165, 152, 168][emoteFrame % 4]!;
      r.shoulderR = { pitch: 0, roll: lift, yaw: 0 };
      r.shoulderL = { pitch: 0, roll: lift, yaw: 0 };
      r.elbowR = r.elbowL = 0;
      break;
    }
    case "sleepy":
      r.headPitch = [6, 14, 18, 10][emoteFrame % 4]!;
      if (!seated) r.shoulderR.pitch = r.shoulderL.pitch = 0;
      break;
    case "none":
      break;
  }
  return r;
}
