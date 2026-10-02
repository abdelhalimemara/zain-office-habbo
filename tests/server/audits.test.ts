import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AUDIT_AREAS, AUDIT_STEPS, type AuditAnalysis, type ProspectAudit } from "../../shared/audits";
import { AUDIT_AGENT, FALLBACK_AGENT, marker } from "../../server/src/growth/audit/analysis";
import { ACTORS } from "../../server/src/growth/audit/budget";
import { pdfFile, screenshotFile } from "../../server/src/growth/audit/steps";
import { LEAD_ID, auditRig } from "./auditFakes";

const answer = (draft: AuditAnalysis, patch: Partial<AuditAnalysis> = {}) => `Here it is.\n\n\`\`\`json\n${JSON.stringify({ ...draft, ...patch }, null, 2)}\n\`\`\``;
const statuses = (a: ProspectAudit) => Object.fromEntries(a.steps.map((s) => [s.id, s.status]));
/** The draft the agent was given, from its task body. */
const draftIn = (body: string): AuditAnalysis => JSON.parse(/Draft:\n```json\n([\s\S]*?)\n```/.exec(body)![1]!) as AuditAnalysis;

describe("audit pipeline", () => {
  it("runs a CRM lead end to end into the Digital Gap Audit, the CRM and Notion", async () => {
    const rig = await auditRig();
    const started = await rig.engine.start({ leadId: LEAD_ID }, "hq");
    expect(started).toMatchObject({ status: "queued", requestedBy: "hq", prospect: { name: "THE STUDIO", website: "https://www.thestudio.sa/", leadId: LEAD_ID } });
    expect(started.steps.map((s) => s.id)).toEqual([...AUDIT_STEPS]);

    await rig.drive();
    let audit = await rig.engine.get(started.id);
    expect(statuses(audit)).toMatchObject({ website: "done", search: "done", social: "done", ads: "done", score: "done", analysis: "running", pdf: "pending" });
    // The crawl first; competitors come from the category searches and go through the same measures.
    expect(rig.apify.actors()[0]).toBe("apify/playwright-scraper");
    expect(rig.chrome.captured).toEqual(["https://www.thestudio.sa/"]);
    expect(audit.screenshotPath).toBe(`/api/growth/audits/${started.id}/screenshot`);
    expect(await readFile(screenshotFile(rig.root, started.id))).toHaveLength(8);
    for (const c of rig.apify.calls) {
      const spec = Object.values(ACTORS).find((a) => a.id === c.actor && a.maxItems === c.options.maxItems)!;
      expect(c.options).toMatchObject({ maxItems: spec.maxItems, timeoutSecs: spec.timeoutSecs });
      expect(c.options.maxTotalChargeUsd).toBeLessThanOrEqual(spec.maxChargeUsd);
    }
    const ads = rig.apify.calls.find((c) => c.actor === "scrapesage/google-ads-transparency-scraper")!;
    expect(ads.input.domains).toEqual(["thestudio.sa", "rival.sa", "glow.sa", "glam.sa"]);

    expect(audit.tags?.find((t) => t.tag === "Google Ads conversion tag")).toEqual({ tag: "Google Ads conversion tag", found: true });
    expect(audit.searchRuns?.[0]).toMatchObject({ kind: "brand", prospectPresent: true });
    expect(audit.seo).toMatchObject({ authorityScore: 12, organicTraffic: 40, source: expect.stringContaining("Semrush via Apify") });
    expect(audit.social?.find((r) => r.channel === "instagram")).toMatchObject({ measured: true, followers: 12_000 });
    expect(audit.benchmark?.map((b) => b.name)).toEqual(["THE STUDIO", "Rival Beauty", "Glow Lounge", "Glam"]);
    expect(audit.benchmark?.[0]).toMatchObject({ isProspect: true, googleAds: { active: 2, formats: "image/text" }, metaAds: { active: 1 }, instagramFollowers: 12_000, authorityScore: 12 });
    expect(audit.benchmark?.[1]).toMatchObject({ instagramFollowers: 5_400, metaAds: "none", authorityScore: 25, traffic: { monthlyVisits: 10_628 } });
    expect(audit.score?.areas.map((a) => a.area)).toEqual([...AUDIT_AREAS]);
    expect(audit.score?.areas.find((a) => a.area === "conversion")?.status).toBe("not-measured");
    expect(audit.score?.areasMeasured).toBe(6);

    const [task] = [...rig.hermes.tasks.values()];
    expect(task).toMatchObject({ assignee: FALLBACK_AGENT, tenant: "zain-growth", title: "Prospect audit · THE STUDIO" });
    expect(task!.body).toContain(marker(started.id));
    const draft = draftIn(task!.body!);
    rig.hermes.complete(answer(draft, { headline: "Sharper headline from the agent." }));
    await rig.drive();
    audit = await rig.engine.get(started.id);
    expect(audit.status).toBe("done");
    expect(audit.steps.every((s) => s.status === "done")).toBe(true);
    expect(audit.analysis?.headline).toBe("Sharper headline from the agent.");
    expect(audit.pdfPath).toBe(`/api/growth/audits/${started.id}/pdf`);
    expect(await readFile(pdfFile(rig.root, started.id), "utf8")).toContain("%PDF");
    const html = rig.chrome.rendered[0]!;
    expect(html.match(/<section class="page/g)).toHaveLength(14);
    expect(html).toContain("Sharper headline from the agent.");
    expect(html).toContain("data:image/png;base64,");
    expect(rig.crm.calls).toEqual([
      `prospect lead ${LEAD_ID}`,
      "upload Zain Growth Digital Gap Audit - THE STUDIO.pdf",
      `attach lead ${LEAD_ID} file_1`,
      expect.stringMatching(new RegExp(`^note lead ${LEAD_ID} Digital Gap Audit: \\d+/100`)),
    ]);
    expect(audit).toMatchObject({ crmUrl: `https://crm.test/object/lead/${LEAD_ID}`, crmAttachmentId: "att_1", notionPageUrl: "https://notion.so/page_1" });
    expect(rig.notion.synced).toEqual([{ id: started.id, bytes: 13, url: `https://hq.test/api/growth/audits/${started.id}/pdf` }]);
    expect(audit.costUsd).toBeCloseTo(audit.steps.reduce((n, s) => n + (s.costUsd ?? 0), 0), 4);
  });

  it("gives the analysis to the Prospect Audit Lead once hired", async () => {
    const rig = await auditRig({ profiles: [AUDIT_AGENT] });
    await rig.engine.start({ website: "thestudio.sa" }, "agent");
    await rig.drive();
    expect([...rig.hermes.tasks.values()][0]!.assignee).toBe(AUDIT_AGENT);
  });

  it("falls back to the drafted analysis when the agent's answer is not JSON", async () => {
    const rig = await auditRig();
    const { id } = await rig.engine.start({ website: "https://thestudio.sa", name: "THE STUDIO" }, "hq");
    await rig.drive();
    rig.hermes.complete("Sorry, I could not finish this one.");
    await rig.drive();
    const audit = await rig.engine.get(id);
    expect(audit.status).toBe("done");
    expect(audit.steps.find((s) => s.id === "analysis")?.note).toMatch(/not valid JSON/);
    expect(audit.analysis?.coverLine).toContain("thestudio.sa");
    expect(audit.analysis?.fix.map((f) => f.name)).toEqual(["Foundation", "Demand Capture", "Demand Generation"]);
    expect(audit.steps.find((s) => s.id === "crm")).toMatchObject({ status: "skipped", note: expect.stringContaining("Not linked") });
  });

  it("fails cleanly at the website step when Apify is not connected", async () => {
    const rig = await auditRig({ apifyOpts: { connected: false } });
    const { id } = await rig.engine.start({ website: "thestudio.sa" }, "hq");
    await rig.drive();
    const audit = await rig.engine.get(id);
    expect(audit.status).toBe("failed");
    expect(audit.error).toBe("Apify is not connected");
    expect(audit.steps.find((s) => s.id === "website")).toMatchObject({ status: "failed", note: "Apify is not connected" });
    expect(statuses(audit)).toMatchObject({ search: "pending", social: "pending", ads: "pending", score: "pending" });
    expect(rig.hermes.tasks.size).toBe(0);
  });

  it("goes on without the mobile capture when Chrome cannot load the page", async () => {
    const rig = await auditRig({ captureFails: true });
    const { id } = await rig.engine.start({ website: "thestudio.sa" }, "hq");
    await rig.drive();
    const audit = await rig.engine.get(id);
    expect(audit.steps.find((s) => s.id === "website")).toMatchObject({ status: "done", note: expect.stringContaining("mobile capture failed") });
    expect(audit.screenshotPath).toBeUndefined();
  });

  it("keeps going when a source fails, marks it not measured, and retries just the unfinished steps", async () => {
    const fail: Record<string, string> = { "apify/google-search-scraper": "Google blocked the run", "pro100chok/semrush-scraper": "Semrush down" };
    const rig = await auditRig({ apifyOpts: { fail } });
    const { id } = await rig.engine.start({ leadId: LEAD_ID }, "hq");
    await rig.drive();
    let audit = await rig.engine.get(id);
    expect(audit.steps.find((s) => s.id === "search")).toMatchObject({ status: "failed", note: expect.stringContaining("Google blocked the run") });
    expect(audit.benchmark).toHaveLength(1); // no competitors without the searches
    expect(audit.score?.areas.find((a) => a.area === "search")).toMatchObject({ status: "not-measured", weight: 0 });
    expect(audit.score!.areas.reduce((n, a) => n + a.weight, 0)).toBeCloseTo(1, 2);
    rig.hermes.complete(answer(draftIn([...rig.hermes.tasks.values()][0]!.body!)));
    await rig.drive();
    expect((await rig.engine.get(id)).status).toBe("done");

    delete fail["apify/google-search-scraper"];
    delete fail["pro100chok/semrush-scraper"];
    const crawls = rig.apify.actors().filter((a) => a === "apify/playwright-scraper").length;
    const retried = await rig.engine.retry(id);
    expect(retried.status).toBe("queued");
    expect(statuses(retried)).toMatchObject({ website: "done", search: "pending", social: "done", ads: "done", score: "pending", analysis: "pending", crm: "pending" });
    await rig.drive();
    rig.hermes.complete(answer(draftIn([...rig.hermes.tasks.values()].at(-1)!.body!)));
    await rig.drive();
    audit = await rig.engine.get(id);
    expect(audit.status).toBe("done");
    expect(audit.steps.find((s) => s.id === "search")?.status).toBe("done");
    expect(rig.apify.actors().filter((a) => a === "apify/playwright-scraper").length).toBe(crawls); // the crawl is not repeated
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
    expect(audit.steps.some((s) => s.note?.includes("Cost cap reached ($0.5)") || s.note?.includes("cost cap reached ($0.5)"))).toBe(true);
    expect(rig.apify.calls.reduce((n, c) => n + c.options.maxTotalChargeUsd, 0)).toBeLessThanOrEqual(0.5 + 1e-9);
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
    expect((await rig.engine.cancel(id)).status).toBe("cancelled");
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
    expect(rig.apify.calls.filter((c) => c.actor === "apify/playwright-scraper" && c.input.maxCrawlingDepth === 2)).toHaveLength(1);
  });
});
