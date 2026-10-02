import { describe, expect, it } from "vitest";
import { LEADERSHIP_SEATS } from "../../shared/leadership";
import { CEO_PROFILE, displayName, findAgent } from "../../shared/roster";
import { SEATS, execName, leadershipName, leadershipSpeakers, leadershipTag } from "../../server/src/leadership/seats";
import { LEADERSHIP_ROOM, agentConfig } from "../../server/src/voice/liveAgent";
import { CEO_SPRITE, NAMED_SPRITE_BY_PROFILE, spriteFor } from "../../src/world/characters";

const EXECS = {
  default: { name: "Susu", tag: "Susu", gender: "female" },
  "zain-hq-coo": { name: "Faisal Al-Harbi", tag: "Faisal", gender: "male" },
  "zain-studio-vp": { name: "Lina Haddad", tag: "Lina", gender: "female" },
  "zain-growth-vp": { name: "Omar Khalid", tag: "Omar", gender: "male" },
  "zain-labs-vp": { name: "Noura Al-Qahtani", tag: "Noura", gender: "female" },
  "zain-tech-vp": { name: "Yousef Al-Mutairi", tag: "Yousef", gender: "male" },
} as const;

describe("exec names", () => {
  it("names the CEO agent, the COO and the four VPs in the roster", () => {
    for (const [profile, e] of Object.entries(EXECS)) expect(findAgent(profile)?.name).toBe(e.name);
    expect(displayName(findAgent("zain-growth-vp")!)).toBe("Omar Khalid · VP Growth");
    expect(displayName(findAgent(CEO_PROFILE)!)).toBe("Susu · CEO · Main Hermes");
  });

  it("tags each exec by first name, letters only, in seat order", () => {
    expect(LEADERSHIP_SEATS.map(leadershipTag)).toEqual(Object.values(EXECS).map((e) => e.tag));
    for (const seat of LEADERSHIP_SEATS) expect(SEATS[seat].tag).toMatch(/^[A-Za-z]+$/);
    expect(leadershipTag("zain-board-hormozi")).toBe("");
  });

  it("names execs fully, with their seat in transcripts, drafting and Notion", () => {
    expect(execName("zain-labs-vp")).toBe("Noura Al-Qahtani");
    expect(leadershipName("zain-labs-vp")).toBe("Noura Al-Qahtani · VP Labs");
    expect(leadershipName("default")).toBe("Susu · CEO");
    expect(leadershipName("founder")).toBe("Founder (Abdelhalim)");
    expect(leadershipSpeakers({ members: ["zain-tech-vp", "default"] })).toEqual([
      { tag: "Susu", profile: "default", name: "Susu" },
      { tag: "Yousef", profile: "zain-tech-vp", name: "Yousef Al-Mutairi" },
    ]);
  });

  it("gives every exec a one-line character", () => {
    expect(SEATS.default.character).toMatch(/organised/);
    expect(SEATS["zain-growth-vp"].character).toMatch(/CAC, ROAS/);
    for (const seat of LEADERSHIP_SEATS) expect(SEATS[seat].character.length).toBeGreaterThan(20);
  });

  it("labels the leadership agent's voices by first name", () => {
    const voices = LEADERSHIP_SEATS.map((profile, i) => ({ profile, voiceId: `voice${i}`, fallback: true }));
    const config = agentConfig(voices, LEADERSHIP_ROOM) as { conversation_config: { tts: { supported_voices: { label: string; description: string }[] } } };
    const supported = config.conversation_config.tts.supported_voices;
    expect(supported.map((v) => v.label)).toEqual(["Susu", "Faisal", "Lina", "Omar", "Noura", "Yousef"]);
    expect(supported[0]!.description).toBe("Susu: every line Susu says.");
  });
});

describe("exec sprites", () => {
  it("dresses each exec in a distinct sprite of their gender", () => {
    const sprites = Object.entries(EXECS).map(([profile, e]) => {
      const sprite = spriteFor(profile, findAgent(profile)!.rank);
      expect(sprite.startsWith(`people/${e.gender}-`), `${profile} wears ${sprite}`).toBe(true);
      expect(NAMED_SPRITE_BY_PROFILE[profile]).toBe(sprite);
      return sprite;
    });
    expect(new Set(sprites).size).toBe(sprites.length);
    expect(sprites).not.toContain(NAMED_SPRITE_BY_PROFILE["zain-hq-accounts"]);
  });

  it("makes Susu, Lina and Noura women", () => {
    expect(CEO_SPRITE).toMatch(/^people\/female-/);
    for (const p of ["default", "zain-studio-vp", "zain-labs-vp"]) expect(spriteFor(p, findAgent(p)!.rank)).toMatch(/^people\/female-/);
  });
});
