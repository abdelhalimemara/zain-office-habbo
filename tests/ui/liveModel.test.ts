import { describe, expect, it } from "vitest";
import type { LiveSpeaker } from "@shared/voice";
import { ApiRequestError } from "../../src/api/client";
import {
  addMessage,
  currentSpeaker,
  formatElapsed,
  joinError,
  latestAgentParts,
  MAX_CAPTIONS,
  messageCaptions,
  nextUserTalking,
  profileForTag,
  speakerAt,
  SPOKEN_CHARS_PER_SECOND,
} from "../../src/ui/liveModel";

const SPEAKERS: LiveSpeaker[] = [
  { tag: "Hormozi", profile: "zain-board-hormozi", name: "Alex Hormozi" },
  { tag: "Buffett", profile: "zain-board-buffett", name: "Warren Buffett" },
];

const agent = (event_id: number, message: string) => ({ role: "agent" as const, message, event_id });
const user = (event_id: number, message: string) => ({ role: "user" as const, message, event_id });

describe("live captions", () => {
  it("splits agent text into one caption per speaker; untagged text is the chair's", () => {
    const caps = messageCaptions(agent(3, "Order. <Hormozi>Raise it.</Hormozi> <Buffett>Careful.</Buffett>"), SPEAKERS);
    expect(caps.map((c) => [c.speaker, c.text])).toEqual([
      ["default", "Order."],
      ["zain-board-hormozi", "Raise it."],
      ["zain-board-buffett", "Careful."],
    ]);
    expect(new Set(caps.map((c) => c.key)).size).toBe(3);
    expect(profileForTag("Nobody", SPEAKERS)).toBe("default");
    expect(profileForTag(null, SPEAKERS)).toBe("default");
  });

  it("gives the founder's transcript to You and drops empty ones", () => {
    expect(messageCaptions(user(1, "  Let's go.  "), SPEAKERS)).toEqual([{ key: "u-1", event: "u-1", speaker: "founder", text: "Let's go." }]);
    expect(messageCaptions(user(2, "   "), SPEAKERS)).toEqual([]);
  });

  it("appends in order, replaces a resent event in place, and keeps a bounded tail", () => {
    let caps = addMessage([], agent(1, "<Hormozi>One</Hormozi>"), SPEAKERS);
    caps = addMessage(caps, user(2, "Two"), SPEAKERS);
    caps = addMessage(caps, agent(1, "<Hormozi>One, fixed</Hormozi><Buffett>Also</Buffett>"), SPEAKERS);
    expect(caps.map((c) => c.text)).toEqual(["One, fixed", "Also", "Two"]);
    for (let i = 10; i < 10 + MAX_CAPTIONS; i++) caps = addMessage(caps, user(i, `m${i}`), SPEAKERS);
    expect(caps).toHaveLength(MAX_CAPTIONS);
    expect(caps.at(-1)!.text).toBe(`m${9 + MAX_CAPTIONS}`);
  });

  it("finds the board's latest message among the captions", () => {
    let caps = addMessage([], agent(1, "<Hormozi>A</Hormozi>"), SPEAKERS);
    caps = addMessage(caps, agent(2, "<Buffett>B</Buffett><Hormozi>C</Hormozi>"), SPEAKERS);
    caps = addMessage(caps, user(3, "Me"), SPEAKERS);
    expect(latestAgentParts(caps).map((c) => c.text)).toEqual(["B", "C"]);
    expect(latestAgentParts(addMessage([], user(1, "x"), SPEAKERS))).toEqual([]);
  });
});

describe("live speaker", () => {
  const parts = [
    { speaker: "a", text: "x".repeat(SPOKEN_CHARS_PER_SECOND * 2) },
    { speaker: "b", text: "y".repeat(SPOKEN_CHARS_PER_SECOND) },
  ];

  it("follows a multi-speaker message by each part's share of the text", () => {
    expect(speakerAt(parts, 0)).toBe("a");
    expect(speakerAt(parts, 1900)).toBe("a");
    expect(speakerAt(parts, 2100)).toBe("b");
    expect(speakerAt(parts, 60_000)).toBe("b");
    expect(speakerAt([], 0)).toBeNull();
  });

  it("lights the founder while they talk, the member while the board speaks, else nobody", () => {
    const caps = addMessage([], agent(1, "<Hormozi>Go</Hormozi>"), SPEAKERS);
    const parts = latestAgentParts(caps);
    expect(currentSpeaker({ mode: "speaking", userTalking: false, parts, elapsedMs: 0 })).toBe("zain-board-hormozi");
    expect(currentSpeaker({ mode: "listening", userTalking: false, parts, elapsedMs: 0 })).toBeNull();
    expect(currentSpeaker({ mode: "speaking", userTalking: true, parts, elapsedMs: 0 })).toBe("founder");
  });

  it("switches You on and off with hysteresis", () => {
    expect(nextUserTalking(false, 0.5)).toBe(false);
    expect(nextUserTalking(false, 0.7)).toBe(true);
    expect(nextUserTalking(true, 0.4)).toBe(true);
    expect(nextUserTalking(true, 0.1)).toBe(false);
  });
});

describe("live errors and timer", () => {
  it("explains mic, configuration and session failures", () => {
    expect(joinError(new DOMException("denied", "NotAllowedError")).kind).toBe("mic");
    expect(joinError(new DOMException("none", "NotFoundError")).kind).toBe("no-mic");
    expect(joinError(new ApiRequestError("ElevenLabs is not configured", 503))).toMatchObject({ kind: "not-configured", message: expect.stringContaining("ELEVENLABS_API_KEY") });
    expect(joinError(new ApiRequestError("not live", 409)).kind).toBe("not-live");
    expect(joinError(new ApiRequestError("busy", 429)).message).toMatch(/busy or out of quota/);
    expect(joinError(new ApiRequestError("slow", 504)).message).toMatch(/took too long/);
    expect(joinError(new ApiRequestError("boom", 500))).toEqual({ kind: "session", message: "Couldn't open the room: boom" });
    expect(joinError(new Error("socket closed"))).toEqual({ kind: "session", message: "Couldn't connect to the room: socket closed" });
    expect(joinError("??").message).toBe("Couldn't connect to the room.");
  });

  it("formats the call timer", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65.4)).toBe("1:05");
    expect(formatElapsed(3725)).toBe("1:02:05");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});
