import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoicesResponse } from "@shared/voice";
import {
  audioFailure,
  formatDuration,
  loadMuted,
  loadPlayed,
  nextUnplayed,
  pickRecordingType,
  PLAYED_KEY_PREFIX,
  saveMuted,
  savePlayed,
  unplayedCount,
  uploadType,
  voicedIndices,
  voiceIdError,
  voiceStatus,
} from "../../src/ui/voiceModel";
import { memoryStorage } from "./helpers";

const turns = [{ speaker: "zain-board-hormozi" }, { speaker: "founder" }, { speaker: "zain-board-jobs" }, { speaker: "default" }];

describe("voice queue model", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("voices every turn but the founder's, in transcript order", () => {
    expect(voicedIndices(turns)).toEqual([0, 2, 3]);
    expect(voicedIndices([])).toEqual([]);
  });

  it("picks the first turn not yet heard and not failed this visit", () => {
    expect(nextUnplayed(turns, new Set(), new Set())).toBe(0);
    expect(nextUnplayed(turns, new Set([0]), new Set())).toBe(2);
    expect(nextUnplayed(turns, new Set([0]), new Set([2]))).toBe(3);
    expect(nextUnplayed(turns, new Set([0, 2, 3]), new Set())).toBeNull();
    expect(unplayedCount(turns, new Set([0]), new Set([3]))).toBe(1);
  });

  it("remembers played turns per meeting and survives bad or blocked storage", () => {
    savePlayed("m1", new Set([3, 0]));
    expect(localStorage.getItem(`${PLAYED_KEY_PREFIX}m1`)).toBe("[0,3]");
    expect([...loadPlayed("m1")]).toEqual([0, 3]);
    expect(loadPlayed("m2").size).toBe(0);
    localStorage.setItem(`${PLAYED_KEY_PREFIX}m3`, '{"not":"an array"}');
    expect(loadPlayed("m3").size).toBe(0);
    localStorage.setItem(`${PLAYED_KEY_PREFIX}m4`, '[1,"x",-2,2.5,4]');
    expect([...loadPlayed("m4")]).toEqual([1, 4]);
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { ...memoryStorage(), getItem: blocked, setItem: blocked });
    expect(loadPlayed("m1").size).toBe(0);
    expect(() => savePlayed("m1", new Set([1]))).not.toThrow();
    expect(loadMuted()).toBe(false);
    expect(() => saveMuted(true)).not.toThrow();
  });

  it("explains why a turn falls back to text", () => {
    expect(audioFailure(503)).toBe("Voice unavailable");
    expect(audioFailure(404)).toBe("No audio for this turn");
    expect(audioFailure(500)).toBe("Audio failed (500)");
    expect(audioFailure(0)).toBe("Couldn't play");
  });
});

describe("voice settings model", () => {
  const voices: VoicesResponse = {
    configured: true,
    voices: [
      { profile: "zain-board-hormozi", voiceId: "abcdefghij1234567890", fallback: false },
      { profile: "zain-board-jobs", voiceId: "stockvoice000000", fallback: true },
    ],
  };

  it("says own or stock voice", () => {
    expect(voiceStatus("zain-board-hormozi", voices)).toBe("own");
    expect(voiceStatus("zain-board-jobs", voices)).toBe("stock");
    expect(voiceStatus("zain-board-bezos", voices)).toBe("stock");
    expect(voiceStatus("zain-board-hormozi", undefined)).toBe("stock");
  });

  it("validates pasted voice ids with VOICE_ID_PATTERN", () => {
    expect(voiceIdError("  21m00Tcm4TlvDq8ikWAM  ")).toBeNull();
    expect(voiceIdError("")).toBe("Paste an ElevenLabs voice id.");
    expect(voiceIdError("   ")).toBe("Paste an ElevenLabs voice id.");
    expect(voiceIdError("short")).toMatch(/10–40 letters and digits/);
    expect(voiceIdError("has spaces in it 123")).toMatch(/10–40/);
    expect(voiceIdError("abc-def-ghi-jkl")).toMatch(/10–40/);
    expect(voiceIdError("a".repeat(41))).toMatch(/10–40/);
  });
});

describe("recording model", () => {
  it("prefers webm/opus, falls back to mp4 for Safari, and copes with a throwing probe", () => {
    expect(pickRecordingType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickRecordingType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecordingType(() => false)).toBeUndefined();
    expect(
      pickRecordingType(() => {
        throw new Error("nope");
      }),
    ).toBeUndefined();
  });

  it("uploads with the bare mime type", () => {
    expect(uploadType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(uploadType("audio/mp4")).toBe("audio/mp4");
    expect(uploadType("video/mp4")).toBe("audio/mp4");
    expect(uploadType("")).toBe("audio/webm");
  });

  it("formats the recording timer", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7.9)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(-3)).toBe("0:00");
  });
});
