import { describe, expect, it } from "vitest";
import { AvatarAnimator } from "../../src/world/avatars/animator";
import { EMOTE_CLIPS, POSE_CLIPS } from "../../src/world/avatars/rig";
import { EMOTES, type Emote } from "../../src/world/avatars/types";

function run(a: AvatarAnimator, ms: number, step = 16): void {
  for (let t = 0; t < ms; t += step) a.update(step);
}

describe("avatar animator", () => {
  it("cycles the walk through every frame", () => {
    const a = new AvatarAnimator();
    a.setPose("walk");
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      a.update(20);
      seen.add(a.poseFrame);
    }
    expect(seen.size).toBe(POSE_CLIPS.walk.frames);
  });

  it("returns timed emotes to none after their duration", () => {
    for (const e of ["wave", "thumbsUp", "thinking", "celebrate"] as Emote[]) {
      const a = new AvatarAnimator();
      a.setEmote(e);
      const ms = EMOTE_CLIPS[e].durationMs!;
      run(a, ms - 40);
      expect(a.emote).toBe(e);
      run(a, 80);
      expect(a.emote).toBe("none");
      expect(a.emoteFrame).toBe(0);
    }
  });

  it("keeps looping emotes while they are set", () => {
    for (const e of ["frustrated", "sleepy"] as Emote[]) {
      const a = new AvatarAnimator();
      a.setEmote(e);
      const frames = new Set<number>();
      for (let i = 0; i < 400; i++) {
        a.update(25);
        frames.add(a.emoteFrame);
      }
      expect(a.emote).toBe(e);
      expect(frames.size).toBe(EMOTE_CLIPS[e].frames);
    }
  });

  it("restarts an emote when it is set again", () => {
    const a = new AvatarAnimator();
    a.setEmote("wave");
    run(a, 1500);
    a.setEmote("wave");
    run(a, 1000);
    expect(a.emote).toBe("wave");
  });

  it("reports frame changes only when the frame moves", () => {
    const a = new AvatarAnimator();
    a.setPose("walk");
    expect(a.update(10)).toBe(false);
    expect(a.update(POSE_CLIPS.walk.frameMs)).toBe(true);
  });

  it("hops only while celebrating on foot", () => {
    const a = new AvatarAnimator();
    a.setEmote("celebrate");
    let hopped = false;
    for (let i = 0; i < 40; i++) {
      a.update(30);
      if (a.hop > 0) hopped = true;
    }
    expect(hopped).toBe(true);
    a.setPose("sit");
    a.setEmote("celebrate");
    for (let i = 0; i < 40; i++) {
      a.update(30);
      expect(a.hop).toBe(0);
    }
  });
});

describe("reduced motion", () => {
  it("holds still poses and the key frame of every emote", () => {
    const a = new AvatarAnimator(true);
    a.setPose("walk");
    run(a, 2000);
    expect(a.poseFrame).toBe(POSE_CLIPS.walk.still);
    for (const e of EMOTES) {
      a.setEmote(e);
      for (let i = 0; i < 10; i++) {
        a.update(37);
        expect(a.emoteFrame).toBe(EMOTE_CLIPS[e].still);
        expect(a.hop).toBe(0);
      }
    }
  });

  it("still expires timed emotes", () => {
    const a = new AvatarAnimator(true);
    a.setEmote("thumbsUp");
    run(a, EMOTE_CLIPS.thumbsUp.durationMs! + 50);
    expect(a.emote).toBe("none");
  });

  it("can be switched off again", () => {
    const a = new AvatarAnimator(true);
    a.setPose("type");
    a.setReducedMotion(false);
    const frames = new Set<number>();
    for (let i = 0; i < 40; i++) {
      a.update(30);
      frames.add(a.poseFrame);
    }
    expect(frames.size).toBe(POSE_CLIPS.type.frames);
  });
});
