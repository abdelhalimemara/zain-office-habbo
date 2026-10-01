import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEF_PRECEDENCE, boardSoul } from "../../server/src/org/boardPersona";
import { memoryHireStore } from "../../server/src/org/hireStore";
import { fileBriefs } from "../../server/src/org/privateBriefs";
import { refreshPersonas } from "../../server/src/org/refreshPersonas";
import { findBoardMember } from "../../shared/board";
import { ROSTER, findAgent } from "../../shared/roster";
import { KANBAN, NO_BRIEFS, TELEGRAM_HOME, setup, type Handler } from "./helpers";

const ALWALEED = "zain-board-alwaleed";
const member = findBoardMember(ALWALEED)!;
const MARKER = "FIXTURE-PRIVATE-7f3a9c";
const FIXTURE = `## Fixture identity\n\nFixture identity ${MARKER}.\n\n## Fixture format\n\nFixture format: verdict, then numbers.\n\n## Fixture guardrails\n\nFixture guardrail.\n`;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zain-briefs-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function withBrief(): Promise<ReturnType<typeof fileBriefs>> {
  await mkdir(join(root, ".zain", "board"), { recursive: true });
  await writeFile(join(root, ".zain", "board", `${ALWALEED}.md`), FIXTURE, { mode: 0o600 });
  return fileBriefs(root);
}

const hireRoutes = (): Record<string, Handler> => ({
  "GET /api/profiles": () => ({ profiles: [{ name: "default" }] }),
  "POST /api/profiles": () => ({ ok: true }),
  [`PUT /api/profiles/${ALWALEED}/soul`]: () => ({ ok: true }),
  [`PUT /api/profiles/${ALWALEED}/description`]: () => ({ ok: true }),
  "POST /api/skills": () => ({ success: true }),
  "GET /api/status": () => ({ gateway_platforms: { telegram: { state: "connected" } } }),
  [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [TELEGRAM_HOME] }),
});
const request = { profile: ALWALEED, title: member.title, division: "hq", rank: "board", reportsTo: null, skills: member.skills };

describe("the Alwaleed seat", () => {
  it("is on the roster as a board advisor with a short title and verified headcount skills", () => {
    const agent = findAgent(ALWALEED)!;
    expect(agent).toMatchObject({ title: "Board · HRH Alwaleed bin Talal", rank: "board", division: "hq", reportsTo: null });
    expect(agent.title.length).toBeLessThanOrEqual(60);
    expect(agent.skills).toEqual([
      "executive:ceo-advisor",
      "corporate-strategy:portfolio-strategy",
      "corporate-strategy:mergers-and-acquisitions",
      "corporate-strategy:market-entry",
      "corporate-strategy:strategic-alliances",
      "finance:capital-allocation",
      "finance:capital-structure-and-covenants",
      "finance:financial-statement-analysis",
      "revenue:deal-negotiation",
    ]);
    expect(member).toMatchObject({ name: "HRH Prince Alwaleed bin Talal", seat: "Contrarian value investing, brands, capital and control", privateBrief: true });
    expect(ROSTER.filter((a) => a.rank === "board").map((a) => a.profile)).toEqual(["zain-board-hormozi", ALWALEED]);
  });
});

describe("boardSoul with a private brief", () => {
  it("embeds the brief verbatim right after the identity, with its precedence line, keeping the charter", () => {
    const soul = boardSoul(member, FIXTURE);
    expect(soul).toContain(FIXTURE.trim());
    const identity = soul.indexOf("You are HRH Prince Alwaleed bin Talal on the Zain Group board of advisors");
    const brief = soul.indexOf("## Your brief");
    expect(identity).toBeGreaterThan(-1);
    expect(brief).toBeGreaterThan(identity);
    expect(soul.indexOf(BRIEF_PRECEDENCE)).toBeGreaterThan(brief);
    expect(soul.indexOf(MARKER)).toBeLessThan(soul.indexOf("## Zain Group"));
    expect(soul).toContain("## How to answer (your result) — unless your brief sets its own format");
    expect(soul).toContain('"Board consultation: …"');
    expect(soul).toContain("`kanban_complete`");
    expect(soul).toContain("Never `kanban_create` or assign work, and never approve or reject mandates.");
    expect(soul).toContain("Never contact anyone outside Zain, and never handle credentials.");
    expect(soul).toContain("never claim to be the real HRH Prince Alwaleed bin Talal");
  });

  it("refuses to build the SOUL without the brief", () => {
    expect(() => boardSoul(member)).toThrow(/needs its private brief/);
  });
});

describe("fileBriefs", () => {
  it("reads the brief from <root>/.zain/board/<profile>.md", async () => {
    expect(await (await withBrief())(ALWALEED)).toBe(FIXTURE);
  });

  it("fails clearly when the brief is missing, naming only the path", async () => {
    await expect(fileBriefs(root)(ALWALEED)).rejects.toThrow("missing private brief .zain/board/zain-board-alwaleed.md");
    await expect(fileBriefs(root)("../../etc/passwd")).rejects.toThrow(/invalid board profile/);
  });
});

describe("hiring and refreshing the Alwaleed seat", () => {
  it("writes the brief into the SOUL but never returns it from the API", async () => {
    const briefs = await withBrief();
    const { send, hermesFetch } = setup(hireRoutes(), { briefs });
    const hire = await send("POST", "/api/hire", request);
    const hireText = await hire.text();
    expect(JSON.parse(hireText).ok).toBe(true);
    const soul = (hermesFetch.called(`PUT /api/profiles/${ALWALEED}/soul`)[0]!.body as { content: string }).content;
    expect(soul).toContain(MARKER);
    const description = hermesFetch.called(`PUT /api/profiles/${ALWALEED}/description`)[0]!.body as { description: string };
    expect(description.description).not.toContain(MARKER);
    const responses = [hireText];
    for (const path of ["/api/roster", "/api/headcount/catalog", "/api/health", `/api/board`]) {
      responses.push(await (await send("GET", path)).text());
    }
    for (const text of responses) expect(text).not.toContain(MARKER);
  });

  it("fails write-soul with a clear error and writes no SOUL when the brief is missing", async () => {
    const { send, hermesFetch } = setup(hireRoutes(), { briefs: fileBriefs(root) });
    const body = await (await send("POST", "/api/hire", request)).json();
    expect(body.ok).toBe(false);
    expect(body.steps.find((s: { step: string }) => s.step === "write-soul")).toEqual({
      step: "write-soul",
      target: ALWALEED,
      ok: false,
      error: "missing private brief .zain/board/zain-board-alwaleed.md",
    });
    expect(hermesFetch.called(`PUT /api/profiles/${ALWALEED}/soul`)).toEqual([]);
  });

  it("refreshPersonas embeds the brief, and fails that profile without writing when it is missing", async () => {
    const routes = {
      "GET /api/profiles": () => ({ profiles: [{ name: ALWALEED }] }),
      [`PUT /api/profiles/${ALWALEED}/soul`]: () => ({ ok: true }),
      [`PUT /api/profiles/${ALWALEED}/description`]: () => ({ ok: true }),
    };
    const ok = setup(routes);
    expect(await refreshPersonas({ hermes: ok.hermes, hires: memoryHireStore(), briefs: await withBrief(), apply: true, log: () => undefined })).toBe(0);
    expect((ok.hermesFetch.called(`PUT /api/profiles/${ALWALEED}/soul`)[0]!.body as { content: string }).content).toContain(MARKER);

    const lines: string[] = [];
    const missing = setup(routes);
    expect(await refreshPersonas({ hermes: missing.hermes, hires: memoryHireStore(), briefs: NO_BRIEFS, apply: true, log: (l) => lines.push(l) })).toBe(1);
    expect(lines.filter((l) => !l.startsWith("skip "))).toEqual([`FAILED ${ALWALEED}: missing private brief .zain/board/zain-board-alwaleed.md`]);
    expect(missing.hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
