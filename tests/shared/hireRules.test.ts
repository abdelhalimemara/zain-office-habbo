import { MAX_SKILLS, PROFILE_PATTERN, TITLE_MAX, hireFieldErrors } from "../../shared/hireRules";
import { ROSTER } from "../../shared/roster";

const ok = { profile: "zain-tech-data", title: "Data Engineer", skills: ["technology:api-design"] };

describe("hire rules", () => {
  it("accepts every canonical roster agent but the CEO", () => {
    for (const a of ROSTER.filter((x) => x.rank !== "ceo" && !x.external)) {
      expect(hireFieldErrors(a)).toEqual({});
      expect(a.profile).toMatch(PROFILE_PATTERN);
    }
  });

  it("refuses an external agent's lane as a profile", () => {
    expect(hireFieldErrors({ profile: "zain-claude", title: "Creative Designer", skills: ["marketing:visual-content"] }).profile).toMatch(/external/);
  });

  it.each([
    [{ profile: "data" }, "profile"],
    [{ profile: `zain-${"a".repeat(41)}` }, "profile"],
    [{ title: "  " }, "title"],
    [{ title: "x".repeat(TITLE_MAX + 1) }, "title"],
    [{ skills: [] }, "skills"],
    [{ skills: Array.from({ length: MAX_SKILLS + 1 }, (_, i) => `a:s${i}`) }, "skills"],
    [{ skills: ["brand-voice"] }, "skills"],
    [{ skills: ["Marketing:Brand"] }, "skills"],
  ])("flags %j", (patch, field) => {
    expect(Object.keys(hireFieldErrors({ ...ok, ...patch }))).toEqual([field]);
  });

  it("allows a title of exactly the limit after trimming", () => {
    expect(hireFieldErrors({ ...ok, title: ` ${"x".repeat(TITLE_MAX)} ` })).toEqual({});
  });
});
