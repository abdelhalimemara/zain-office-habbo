import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AUDIT_MAX_COST_USD, AUDIT_STEPS, type AuditAnalysis } from "../../shared/audits";
import { AUDIT_AGENT, FALLBACK_AGENT, marker } from "../../server/src/growth/audit/analysis";
import { ACTORS } from "../../server/src/growth/audit/budget";
import { pdfFile } from "../../server/src/growth/audit/steps";
import { LEAD_ID, auditRig } from "./auditFakes";

const analysis: AuditAnalysis = {
  executiveSummary: "THE STUDIO has a solid Instagram base but is invisible on Google for its core searches.",
  findings: [{ section: "search", title: "Missing from Arabic searches", detail: "Not on page one for صالون تجميل الرياض.", severity: "high" }],
  opportunities: [{ title: "Win Arabic salon searches", service: "Zain Growth · SEO & AI Search", impact: "high", effort: "M" }],
  competitors: [{ name: "Rival", domain: "rival.sa", note: "Ranks first for both searches" }],
  pitchAngle: "Open with the Arabic search gap.",
};
const answer = (a: unknown = analysis) => `Here is the analysis.\n\n\`\`\`json\n${JSON.stringify(a, null, 2)}\n\`\`\``;
const statuses = (a: { steps: { id: string; status: string }[] }) => Object.fromEntries(a.steps.map((s) => [s.id, s.status]));

describe("audit pipeline", () => {
  it("runs a CRM lead end to end: scrapes, scores, analysis, PDF, CRM and Notion", async () => {
    const rig = await auditRig();
    const started = await rig.engine.start({ leadId: LEAD_ID }, "hq");
    expect(started).toMatchObject({ status: "queued", requestedBy: "hq", prospect: { name: "THE STUDIO", website: "https://www.thestudio.sa/", leadId: LEAD_ID } });
    expect(started.steps.map((s) => s.id)).toEqual([...AUDIT_STEPS]);

    await rig.drive();
    let audit = await rig.engine.get(started.id);
    expect(audit.status).toBe("running");
    expect(statuses(audit)).toMatchObject({ website: "done", search: "done", social: "done", ads: "done", score: "done", analysis: "running", pdf: "pending" });
    // Website and ads first (together), search and social once the crawl is in.
    expect(rig.apify.actors().slice(0, 2).sort()).toEqual(["apify/facebook-ads-scraper", "apify/web-scraper"]);
    expect(rig.apify.actors()).toContain("apify/google-search-scraper");
    expect(rig.apify.actors()).toContain("clockworks/tiktok-profile-scraper"); // handle found on the site
    for (const c of rig.apify.calls) {
      const spec = Object.values(ACTORS).find((a) => a.id === c.actor)!;
      expect(c.options).toMatchObject({ maxItems: spec.maxItems, maxTotalChargeUsd: spec.maxChargeUsd, timeoutSecs: spec.timeoutSecs });
    }

    const [task] = [...rig.hermes.tasks.values()];
    expect(task).toMatchObject({ assignee: FALLBACK_AGENT, tenant: "zain-growth", title: "Prospect audit · THE STUDIO" });
    expect(task!.body).toContain(marker(started.id));
    expect(task!.body).toContain('"overall"');

    rig.hermes.complete(answer());
    await rig.drive();
    audit = await rig.engine.get(started.id);
    expect(audit.status).toBe("done");
    expect(audit.steps.every((s) => s.status === "done")).toBe(true);
    expect(audit.analysis).toEqual(analysis);
    expect(audit.score?.grade).toMatch(/^[A-E]$/);
    expect(audit.score?.sections.tracking.drivers.join(" ")).toContain("Meta pixel");
    expect(audit.pdfPath).toBe(`/api/growth/audits/${started.id}/pdf`);
    expect(await readFile(pdfFile(rig.root, started.id), "utf8")).toContain("%PDF");
    expect(rig.pdf.rendered[0]).toContain("Win Arabic salon searches");
    expect(rig.crm.calls).toEqual([
      `prospect lead ${LEAD_ID}`,
      "upload Zain Growth audit - THE STUDIO.pdf",
      `attach lead ${LEAD_ID} file_1`,
      expect.stringMatching(new RegExp(`^note lead ${LEAD_ID} Prospect audit: \\d+/100`)),
    ]);
    expect(audit).toMatchObject({ crmUrl: `https://crm.test/object/lead/${LEAD_ID}`, crmAttachmentId: "att_1", notionPageUrl: "https://notion.so/page_1" });
    expect(rig.notion.synced).toEqual([{ id: started.id, bytes: 13, url: `https://hq.test/api/growth/audits/${started.id}/pdf` }]);
    expect(audit.costUsd).toBeGreaterThan(0);
    expect(audit.costUsd).toBeCloseTo(audit.steps.reduce((n, s) => n + (s.costUsd ?? 0), 0), 4);
  });

  it("gives the analysis to the Prospect Audit Lead once hired", async () => {
    const rig = await auditRig({ profiles: [AUDIT_AGENT] });
    await rig.engine.start({ website: "thestudio.sa" }, "agent");
    await rig.drive();
    expect([...rig.hermes.tasks.values()][0]!.assignee).toBe(AUDIT_AGENT);
  });

  it("falls back to an analysis from the scores when the agent's answer is not JSON", async () => {
    const rig = await auditRig();
    const { id } = await rig.engine.start({ website: "https://thestudio.sa", name: "THE STUDIO" }, "hq");
    await rig.drive();
    rig.hermes.complete("Sorry, I could not finish this one.");
    await rig.drive();
    const audit = await rig.engine.get(id);
    expect(audit.status).toBe("done");
    expect(audit.steps.find((s) => s.id === "analysis")?.note).toMatch(/not valid JSON/);
    expect(audit.analysis?.executiveSummary).toContain("THE STUDIO scores");
    expect(audit.analysis?.opportunities.length).toBeGreaterThan(0);
    expect(audit.steps.find((s) => s.id === "crm")).toMatchObject({ status: "skipped", note: expect.stringContaining("Not linked") });
    expect(audit.pdfPath).toBeDefined();
  });

  it("fails cleanly at the website step when Apify is not connected", async () => {
    const rig = await auditRig({ apifyOpts: { connected: false } });
    const { id } = await rig.engine.start({ website: "thestudio.sa" }, "hq");
    await rig.drive();
    const audit = await rig.engine.get(id);
    expect(audit.status).toBe("failed");
    expect(audit.error).toBe("Apify is not connected");
    expect(audit.steps.find((s) => s.id === "website")).toMatchObject({ status: "failed", note: "Apify is not connected" });
    expect(statuses(audit)).toMatchObject({ search: "pending", social: "pending", score: "pending" });
    expect(rig.hermes.tasks.size).toBe(0);
  });

  it("keeps going when one scrape fails and retries just the unfinished steps", async () => {
    const fail: Record<string, string> = { "apify/google-search-scraper": "Google blocked the run" };
    const rig = await auditRig({ apifyOpts: { fail } });
    const { id } = await rig.engine.start({ leadId: LEAD_ID }, "hq");
    await rig.drive();
    rig.hermes.complete(answer());
    await rig.drive();
    let audit = await rig.engine.get(id);
    expect(audit.status).toBe("done");
    expect(audit.steps.find((s) => s.id === "search")).toMatchObject({ status: "failed", note: "Google blocked the run" });
    expect(audit.score?.sections.search.weight).toBe(0);
    const weights = Object.values(audit.score!.sections).reduce((n, s) => n + s.weight, 0);
    expect(weights).toBeCloseTo(1, 2);

    delete fail["apify/google-search-scraper"];
    const websiteRuns = rig.apify.actors().filter((a) => a === "apify/web-scraper").length;
    const retried = await rig.engine.retry(id);
    expect(retried.status).toBe("queued");
    expect(statuses(retried)).toMatchObject({ website: "done", search: "pending", social: "done", ads: "done", score: "pending", analysis: "pending", crm: "pending" });
    await rig.drive();
    rig.hermes.complete(answer());
    await rig.drive();
    audit = await rig.engine.get(id);
    expect(audit.status).toBe("done");
    expect(audit.steps.find((s) => s.id === "search")?.status).toBe("done");
    expect(rig.apify.actors().filter((a) => a === "apify/web-scraper").length).toBe(websiteRuns);
    // The note and attachment are not duplicated on the CRM record.
    expect(rig.crm.calls.filter((c) => c.startsWith("note")).length).toBe(1);
    expect(rig.crm.calls.filter((c) => c.startsWith("attach")).length).toBe(1);
    await expect(rig.engine.retry(id)).rejects.toMatchObject({ status: 409 });
  });

  it("stops spending at the per-audit cost cap and skips what would go over", async () => {
    // Apify reports more than the charge limit; a run never counts more than it reserved.
    const rig = await auditRig({ apifyOpts: { costUsd: 5 }, maxCostUsd: 0.5 });
    const { id } = await rig.engine.start({ leadId: LEAD_ID }, "hq");
    await rig.drive();
    const audit = await rig.engine.get(id);
    expect(audit.costUsd).toBeLessThanOrEqual(0.5);
    expect(audit.costUsd).toBeGreaterThan(0.4);
    expect(audit.steps.find((s) => s.id === "search")).toMatchObject({ status: "skipped", note: "Cost cap reached ($0.5)" });
    expect(rig.apify.calls.reduce((n, c) => n + c.options.maxTotalChargeUsd, 0)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(audit.status).toBe("running"); // carries on to the analysis with what it has
    expect(AUDIT_MAX_COST_USD).toBe(3);
  });

  it("runs one audit per prospect and at most two at a time", async () => {
    const rig = await auditRig();
    const a = await rig.engine.start({ website: "one.sa" }, "hq");
    await expect(rig.engine.start({ website: "https://www.one.sa/about" }, "hq")).rejects.toMatchObject({ status: 409 });
    const b = await rig.engine.start({ website: "two.sa" }, "hq");
    const c = await rig.engine.start({ website: "three.sa" }, "hq");
    await rig.engine.tick();
    const byId = async (id: string) => (await rig.engine.get(id)).status;
    expect([await byId(a.id), await byId(b.id), await byId(c.id)]).toEqual(["running", "running", "queued"]);
    await rig.engine.cancel(a.id);
    await rig.engine.idle();
    await rig.engine.tick();
    expect(await byId(c.id)).toBe("running");
    await expect(rig.engine.cancel(a.id)).rejects.toMatchObject({ status: 409 });
    await rig.engine.idle();
  });

  it("cancels an audit waiting on its analysis and archives the agent's task", async () => {
    const rig = await auditRig();
    const { id } = await rig.engine.start({ website: "thestudio.sa" }, "hq");
    await rig.drive();
    const cancelled = await rig.engine.cancel(id);
    expect(cancelled.status).toBe("cancelled");
    expect([...rig.hermes.tasks.values()][0]!.status).toBe("archived");
    await rig.drive();
    expect((await rig.engine.get(id)).status).toBe("cancelled");
  });

  it("reruns a step left running by a server restart", async () => {
    const rig = await auditRig();
    const steps = AUDIT_STEPS.map((id) => ({ id, status: id === "website" ? ("running" as const) : ("pending" as const) }));
    const audit = { id: "aud_old", prospect: { name: "THE STUDIO", website: "https://thestudio.sa/" }, status: "running" as const, steps, requestedBy: "hq" as const, createdAt: 1, updatedAt: 1 };
    await rig.store.put({ id: audit.id, audit, data: {} });
    await rig.drive();
    expect((await rig.engine.get(audit.id)).steps.find((s) => s.id === "website")?.status).toBe("done");
    expect(rig.apify.actors().filter((a) => a === "apify/web-scraper")).toHaveLength(1);
  });
});
