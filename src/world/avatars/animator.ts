import { EMOTE_CLIPS, HOP, POSE_CLIPS } from "./rig";
import type { Emote, Pose } from "./types";

/** Pure pose/emote state machine: advances time, picks frames, expires timed emotes. */
export class AvatarAnimator {
  pose: Pose = "stand";
  emote: Emote = "none";
  poseFrame = 0;
  emoteFrame = 0;
  emoteMs = 0;
  private poseMs = 0;

  constructor(public reducedMotion = false) {}

  setPose(p: Pose): void {
    if (p === this.pose) return;
    this.pose = p;
    this.poseMs = 0;
    this.resolve();
  }

  /** Setting an emote (even the same one) restarts it. */
  setEmote(e: Emote): void {
    this.emote = e;
    this.emoteMs = 0;
    this.resolve();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.resolve();
  }

  /** Advance by dt; true when the visible frame (or emote) changed. */
  update(dtMs: number): boolean {
    const before = this.poseFrame * 64 + this.emoteFrame;
    const emoteBefore = this.emote;
    this.poseMs += dtMs;
    this.emoteMs += dtMs;
    const clip = EMOTE_CLIPS[this.emote];
    if (clip.durationMs !== undefined && this.emoteMs >= clip.durationMs) {
      this.emote = "none";
      this.emoteMs = 0;
    }
    this.resolve();
    return before !== this.poseFrame * 64 + this.emoteFrame || emoteBefore !== this.emote;
  }

  /** Celebrate hop in voxels (0 with reduced motion). */
  get hop(): number {
    if (this.reducedMotion || this.emote !== "celebrate" || this.pose !== "stand") return 0;
    return HOP[this.emoteFrame % HOP.length]!;
  }

  private resolve(): void {
    const pc = POSE_CLIPS[this.pose];
    const ec = EMOTE_CLIPS[this.emote];
    if (this.reducedMotion) {
      this.poseFrame = pc.still;
      this.emoteFrame = ec.still;
      return;
    }
    this.poseFrame = Math.floor(this.poseMs / pc.frameMs) % pc.frames;
    this.emoteFrame = Math.floor(this.emoteMs / ec.frameMs) % ec.frames;
  }
}
