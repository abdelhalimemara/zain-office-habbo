import { memoryHireStore } from "../../server/src/org/hireStore";
import { refreshPersonas } from "../../server/src/org/refreshPersonas";
import { ROSTER } from "../../shared/roster";
import { NO_BRIEFS, json, setup } from "./helpers";

const profile = (name: string) => ({ name, is_default: name === "default", model: "m", provider: "p", description: "", skill_count: 1 });

function hermesWith(names: string[], failing?: string) {
  return setup({
    "GET /api/profiles": () => ({ profiles: names.map(profile) }),
    ...Object.fromEntries(
      names.flatMap((n) => [
        [`PUT /api/profiles/${n}/soul`, () => (n === failing ? json({ detail: "disk full" }, 500) : { ok: true })],
        [`PUT /api/profiles/${n}/description`, () => ({ ok: true })],
      ]),
    ),
  });
}

describe("refreshPersonas", () => {
  it("dry run only reads, one line per profile, never the CEO", async () => {
    const lines: string[] = [];
    const { hermes, hermesFetch } = hermesWith(["default", "zain-hq-coo", "zain-tech-qa"]);
    expect(await refreshPersonas({ hermes, hires: memoryHireStore(), briefs: NO_BRIEFS, apply: false, log: (l) => lines.push(l) })).toBe(0);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(lines).toHaveLength(ROSTER.length - 1);
    expect(lines).toContain("would refresh zain-hq-coo (COO): SOUL + description");
    expect(lines).toContain("skip zain-studio-vp (not hired)");
    expect(lines.some((l) => l.includes("default"))).toBe(false);
  });

  it("with apply rewrites only SOUL and description of existing roster agents from current persona code", async () => {
    const lines: string[] = [];
    const { hermes, hermesFetch } = hermesWith(["default", "zain-hq-coo", "zain-tech-qa", "zain-tech-extra"]);
    const hires = memoryHireStore([
      { profile: "zain-hq-analyst", title: "HQ Analyst", division: "hq", rank: "specialist", reportsTo: "zain-hq-coo", skills: [] },
    ]);
    expect(await refreshPersonas({ hermes, hires, briefs: NO_BRIEFS, apply: true, log: (l) => lines.push(l) })).toBe(0);
    const writes = hermesFetch.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    expect(writes).toEqual([
      "PUT /api/profiles/zain-hq-coo/soul",
      "PUT /api/profiles/zain-hq-coo/description",
      "PUT /api/profiles/zain-tech-qa/soul",
      "PUT /api/profiles/zain-tech-qa/description",
    ]);
    const soul = (hermesFetch.called("PUT /api/profiles/zain-hq-coo/soul")[0]!.body as { content: string }).content;
    expect(soul).toContain("Do NOT pass `parents`");
    expect(soul).toContain("`zain-hq-analyst`");
    expect(lines.filter((l) => l.startsWith("refreshed"))).toEqual(["refreshed zain-hq-coo", "refreshed zain-tech-qa"]);
  });

  it("reports a failed profile and keeps going", async () => {
    const lines: string[] = [];
    const { hermes, hermesFetch } = hermesWith(["zain-hq-coo", "zain-tech-qa"], "zain-hq-coo");
    expect(await refreshPersonas({ hermes, hires: memoryHireStore(), briefs: NO_BRIEFS, apply: true, log: (l) => lines.push(l) })).toBe(1);
    expect(lines).toContain("FAILED zain-hq-coo: disk full");
    expect(lines).toContain("refreshed zain-tech-qa");
    expect(hermesFetch.called("PUT /api/profiles/zain-hq-coo/description")).toHaveLength(0);
  });
});
