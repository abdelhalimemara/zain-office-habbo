import { describe, expect, it } from "vitest";
import type { VoicesResponse } from "@shared/voice";
import { voiceIdError, voiceStatus } from "../../src/ui/voiceModel";

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
