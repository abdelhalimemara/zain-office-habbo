import { HEADCOUNT_REF, HeadcountSource, parseTree, rosterFallback, sourceDepartments } from "../../server/src/headcount/catalog";
import { hermesSkillName, toHermesSkill } from "../../server/src/headcount/skillFile";
import { ROSTER } from "../../shared/roster";
import { SKILL_SOURCES, sourceSkillIds } from "../../shared/skillSources";
import { githubFetch, json, mockFetch, setup } from "./helpers";

describe("headcount catalog", () => {
  it("parses departments and skills from the GitHub tree", () => {
    expect(
      parseTree([
        { path: "plugins/security/skills/threat-modeling/SKILL.md", type: "blob" },
        { path: "plugins/security/skills/code-audit/SKILL.md", type: "blob" },
        { path: "plugins/security/skills/code-audit/references/x.md", type: "blob" },
        { path: "plugins/finance/skills/tax/SKILL.md", type: "blob" },
        { path: "plugins/finance/skills/tax", type: "tree" },
        { path: "README.md", type: "blob" },
      ]),
    ).toEqual([
      { id: "finance", skills: ["tax"] },
      { id: "security", skills: ["code-audit", "threat-modeling"] },
    ]);
  });

  it("serves the catalog and caches it for an hour", async () => {
    let now = 0;
    const gh = githubFetch();
    const source = new HeadcountSource({ fetchImpl: gh.fetchImpl, now: () => now });
    const first = await source.catalog();
    expect(first.departments.find((d) => d.id === "security")!.skills).toContain("incident-response");
    now = 59 * 60 * 1000;
    await source.catalog();
    expect(gh.calls).toHaveLength(1);
    now = 61 * 60 * 1000;
    await source.catalog();
    expect(gh.calls).toHaveLength(2);
  });

  it("falls back to the skills referenced in ROSTER when GitHub is unreachable", async () => {
    const { send } = setup({}, { githubDown: true });
    const { departments } = await (await send("GET", "/api/headcount/catalog")).json();
    expect(departments).toEqual([...rosterFallback(), ...sourceDepartments()]);
    const all = departments.flatMap((d: { id: string; skills: string[] }) => d.skills.map((s) => `${d.id}:${s}`));
    const sourceIds = SKILL_SOURCES.flatMap(sourceSkillIds);
    expect(new Set(all)).toEqual(new Set([...ROSTER.flatMap((a) => a.skills), ...sourceIds]));
    expect(rosterFallback().some((d) => d.id === "hormozi")).toBe(false);
  });

  it("pins the tree and SKILL.md to the reviewed commit, overridable per source", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return url.includes("api.github.com") ? json({ tree: [{ path: "plugins/x/skills/y/SKILL.md", type: "blob" }] }) : new Response("md");
    };
    await new HeadcountSource({ fetchImpl }).catalog();
    await new HeadcountSource({ fetchImpl }).skillMarkdown("x:y");
    await new HeadcountSource({ fetchImpl, ref: "v2" }).skillMarkdown("x:y");
    expect(urls).toEqual([
      `https://api.github.com/repos/cbrock84/headcount/git/trees/${HEADCOUNT_REF}?recursive=1`,
      `https://raw.githubusercontent.com/cbrock84/headcount/${HEADCOUNT_REF}/plugins/x/skills/y/SKILL.md`,
      "https://raw.githubusercontent.com/cbrock84/headcount/v2/plugins/x/skills/y/SKILL.md",
    ]);
    expect(HEADCOUNT_REF).toBe("98d1c17d480f606060102a781f9a8601690685f7");
  });

  it("does not cache the fallback", async () => {
    const m = mockFetch({
      [`GET /repos/cbrock84/headcount/git/trees/${HEADCOUNT_REF}`]: (_c, n) =>
        n === 1 ? json({}, 500) : { tree: [{ path: "plugins/x/skills/y/SKILL.md", type: "blob" }] },
    });
    const source = new HeadcountSource({ fetchImpl: m.fetchImpl });
    await source.catalog();
    expect(await source.catalog()).toEqual({ departments: [{ id: "x", skills: ["y"] }, ...sourceDepartments()] });
  });
});

describe("headcount SKILL.md conversion", () => {
  const upstream = `---\nname: brand-voice\ndescription: Captures how a brand writes. Use this before drafting any content for a new brand or client.\n---\n\n# Brand voice\n\nBody text.\n`;

  it("names skills hc-<department>-<skill> within Hermes limits", () => {
    expect(hermesSkillName("marketing:brand-voice")).toBe("hc-marketing-brand-voice");
    for (const id of ROSTER.flatMap((a) => a.skills)) {
      expect(hermesSkillName(id)).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
    }
  });

  it("rewrites frontmatter to a ≤60-char description and keeps the upstream guidance in the body", () => {
    const { name, content } = toHermesSkill("marketing:brand-voice", upstream);
    expect(name).toBe("hc-marketing-brand-voice");
    const [, fm, body] = content.split(/^---$/m);
    expect(fm).toBe('\nname: hc-marketing-brand-voice\ndescription: "Brand voice (marketing)."\n');
    expect(body).toContain("**When to use:** Captures how a brand writes.");
    expect(body).toContain("# Brand voice\n\nBody text.");
    expect(body).toContain("`marketing:brand-voice`");
  });

  it("shortens long skill names to fit the description budget", () => {
    const { content } = toHermesSkill("customer-experience:customer-onboarding-and-implementation", upstream);
    const desc = JSON.parse(/^description: (.*)$/m.exec(content)![1]!) as string;
    expect(desc.length).toBeLessThanOrEqual(60);
    expect(desc).toBe("Customer onboarding and implementation.");
  });

  it("rejects an empty upstream skill", () => {
    expect(() => toHermesSkill("marketing:brand-voice", "---\nname: x\ndescription: y\n---\n\n")).toThrow(/empty/);
  });
});
