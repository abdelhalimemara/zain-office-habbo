import { findAgent } from "../../shared/roster";
import { setup, type Handler } from "./helpers";

const defaultProfile = { name: "default", is_default: true, model: "m", provider: "x", description: "", skill_count: 90 };

function routes(profile: string): Record<string, Handler> {
  return {
    "GET /api/profiles": () => ({ profiles: [defaultProfile] }),
    "POST /api/profiles": () => ({ ok: true }),
    [`PUT /api/profiles/${profile}/soul`]: () => ({ ok: true }),
    [`PUT /api/profiles/${profile}/description`]: () => ({ ok: true }),
    "POST /api/skills": () => ({ success: true }),
  };
}

/** The body the vacant agent card's Hire button sends: the roster fields, without name or unit. */
function cardRequest(profile: string) {
  const a = findAgent(profile)!;
  return { profile, title: a.title, division: a.division, rank: a.rank, reportsTo: a.reportsTo, skills: a.skills };
}

describe("hiring a new marketing seat from its agent card", () => {
  it.each([
    ["zain-growth-audit", "Rami Saleh", "Growth unit of Zain Growth"],
    ["zain-growth-outbound", "Hadi Nasser", "Growth unit of Zain Growth"],
    ["zain-studio-social", "Dana Al-Shammari", "Organic unit of Zain Studio"],
    ["zain-studio-content", "Karim Mansour", "Organic unit of Zain Studio"],
  ])("%s keeps the roster persona (%s, %s) and installs the marketing skills", async (profile, name, unit) => {
    const { send, hermesFetch } = setup(routes(profile));
    const res = await send("POST", "/api/hire", cardRequest(profile));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const soul = (hermesFetch.called(`PUT /api/profiles/${profile}/soul`)[0]!.body as { content: string }).content;
    expect(soul).toContain(`You are ${name}, the ${findAgent(profile)!.title}`);
    expect(soul).toContain(unit);
    expect(soul).toContain("Zain's product marketing context is at `~/ZainGroup/product-marketing.md`; read it before marketing work.");
    const description = (hermesFetch.called(`PUT /api/profiles/${profile}/description`)[0]!.body as { description: string }).description;
    expect(description).toContain(name);

    const skills = hermesFetch.called("POST /api/skills").map((c) => c.body as { name: string; category: string });
    expect(skills.map((s) => s.name)).toEqual(findAgent(profile)!.skills.map((id) => `mk-${id.slice(3)}`));
    expect(new Set(skills.map((s) => s.category))).toEqual(new Set(["zain-marketing"]));
  });

  it("tells Hadi that Ahmad sends every client email", async () => {
    const { send, hermesFetch } = setup(routes("zain-growth-outbound"));
    await send("POST", "/api/hire", cardRequest("zain-growth-outbound"));
    const soul = (hermesFetch.called("PUT /api/profiles/zain-growth-outbound/soul")[0]!.body as { content: string }).content;
    expect(soul).toContain("## Your focus");
    expect(soul).toContain("Ahmad (zain-hq-accounts) sends every client and prospect email; you never contact anyone outside Zain yourself.");
    expect(soul).not.toContain("## Client communication");
  });

  it("lists the VP's team with their units", async () => {
    const { send, hermesFetch } = setup({ ...routes("zain-growth-vp") });
    await send("POST", "/api/hire", cardRequest("zain-growth-vp"));
    const soul = (hermesFetch.called("PUT /api/profiles/zain-growth-vp/soul")[0]!.body as { content: string }).content;
    expect(soul).toContain("- `zain-growth-paid` — Paid Ads Manager (Performance)");
    expect(soul).toContain("- `zain-growth-audit` — Prospect Audit Lead (Growth)");
    expect(soul).toContain("## Your units");
    expect(soul).toContain("You are Omar Khalid, the VP Growth");
  });
});
