import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_STEPS, type ProspectAudit } from "../../shared/audits";
import { draftAnalysis } from "../../server/src/growth/audit/analysis";
import { publicView } from "../../server/src/growth/audit/benchmark";
import { ApifyClient } from "../../server/src/growth/audit/apify";
import { ATTACHMENT_FILE_FIELD, CRM_NOT_CONNECTED, TwentyCrm } from "../../server/src/growth/audit/crm";
import { NotionAuditSink, auditsIdsPath, setupProspectAudits } from "../../server/src/growth/audit/notion";
import { ChromeRenderer } from "../../server/src/growth/audit/chrome";
import { scoreAudit } from "../../server/src/growth/audit/score";
import { summarizeWebsite } from "../../server/src/growth/audit/collect/website";
import { GROWTH_LOGO, brandLogo, renderReport } from "../../server/src/growth/audit/template/render";
import { NotionClient } from "../../server/src/notion/client";
import { PARENT_PAGE_ID } from "../../server/src/notion/boardRoom";
import { LEAD_ID, PNG, page, tempRoot } from "./auditFakes";
import { json, mockFetch } from "./helpers";

const TOKEN = "apify_api_SECRETSECRETSECRETSECRET1234";
const noSleep = async () => undefined;
const run = (status: string, extra: Record<string, unknown> = {}) => ({ data: { id: "r1", status, defaultDatasetId: "d1", ...extra } });

describe("Apify client", () => {
  it("starts the run with limits, waits for it, and returns the dataset and its cost", async () => {
    const api = mockFetch({
      "POST /v2/acts/apify~playwright-scraper/runs": () => run("RUNNING"),
      "GET /v2/actor-runs/r1": (_c, n) => (n === 1 ? run("RUNNING") : run("SUCCEEDED", { usageTotalUsd: 0.07 })),
      "GET /v2/datasets/d1/items": () => [{ url: "https://a.sa/" }],
    });
    const client = new ApifyClient(async () => TOKEN, api.fetchImpl, noSleep);
    const out = await client.run("apify/playwright-scraper", { startUrls: [] }, { maxItems: 25, maxTotalChargeUsd: 0.3, timeoutSecs: 420, memoryMbytes: 2048 });
    expect(out).toEqual({ items: [{ url: "https://a.sa/" }], costUsd: 0.07 });
    const [start] = api.calls;
    expect(start!.auth).toBe(`Bearer ${TOKEN}`);
    expect(Object.fromEntries(start!.query)).toEqual({ waitForFinish: "60", timeout: "420", maxItems: "25", maxTotalChargeUsd: "0.30", memory: "2048" });
    expect(start!.body).toEqual({ startUrls: [] });
    expect(api.called("GET /v2/actor-runs/r1")).toHaveLength(2);
    expect(api.calls.at(-1)!.query.get("limit")).toBe("25");
  });

  it("retries reads through a transient Apify error, and reports a permission refusal plainly", async () => {
    const api = mockFetch({
      "POST /v2/acts/a~b/runs": () => run("SUCCEEDED", { usageTotalUsd: 0.01 }),
      "GET /v2/datasets/d1/items": (_c, n) => (n === 1 ? json({ error: { message: "busy" } }, 503) : [{ ok: 1 }]),
    });
    expect((await new ApifyClient(async () => TOKEN, api.fetchImpl, noSleep).run("a/b", {}, { maxItems: 1, maxTotalChargeUsd: 0.1, timeoutSecs: 10 })).items).toEqual([{ ok: 1 }]);
    const refused = mockFetch({ "POST /v2/acts/a~b/runs": () => json({ error: { type: "full-permission-actor-not-approved", message: "This Actor requires full access" } }, 403) });
    await expect(new ApifyClient(async () => TOKEN, refused.fetchImpl, noSleep).run("a/b", {}, { maxItems: 1, maxTotalChargeUsd: 0.1, timeoutSecs: 10 })).rejects.toThrow(
      "Apify refused the run: This Actor requires full access",
    );
  });

  it("says Apify is not connected without a token, and never calls out", async () => {
    const api = mockFetch({});
    await expect(new ApifyClient(async () => null, api.fetchImpl).run("a/b", {}, { maxItems: 1, maxTotalChargeUsd: 0.1, timeoutSecs: 10 })).rejects.toThrow("Apify is not connected");
    expect(api.calls).toHaveLength(0);
  });

  it("reports failed runs with their cost and keeps the token out of errors", async () => {
    const failed = mockFetch({ "POST /v2/acts/a~b/runs": () => run("FAILED", { usageTotalUsd: 0.02, statusMessage: "blocked" }) });
    await expect(new ApifyClient(async () => TOKEN, failed.fetchImpl, noSleep).run("a/b", {}, { maxItems: 1, maxTotalChargeUsd: 0.1, timeoutSecs: 10 })).rejects.toMatchObject({
      message: "a/b failed: blocked",
      costUsd: 0.02,
    });
    const rejected = mockFetch({ "POST /v2/acts/a~b/runs": () => json({ error: { message: `bad token ${TOKEN}` } }, 401) });
    const err = await new ApifyClient(async () => TOKEN, rejected.fetchImpl).run("a/b", {}, { maxItems: 1, maxTotalChargeUsd: 0.1, timeoutSecs: 10 }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Apify rejected the token");
  });
});

describe("Twenty CRM client", () => {
  const lead = {
    name: "THE STUDIO",
    websiteUrl: { primaryLinkUrl: "www.thestudio.sa" },
    city: "RIYADH",
    category: "BEAUTY",
    instagramHandle: "thestudio.sa",
    tiktokHandle: "",
    facebookPageUrl: "",
    hasPixel: false,
    hasGoogleTagManager: true,
    metaAdLibraryUrl: "https://www.facebook.com/ads/library/?q=x",
  };

  it("reads a lead into a prospect with its tracking flags", async () => {
    const api = mockFetch({ [`GET /rest/leads/${LEAD_ID}`]: () => ({ data: { lead } }) });
    const crm = new TwentyCrm(async () => "crm-key", api.fetchImpl, "https://crm.test");
    expect(await crm.prospect("lead", LEAD_ID)).toEqual({
      prospect: { name: "THE STUDIO", website: "https://www.thestudio.sa", leadId: LEAD_ID, city: "RIYADH", category: "BEAUTY", instagram: "thestudio.sa", tiktok: undefined, facebook: undefined },
      flags: { hasPixel: undefined, hasGoogleTagManager: true, metaAdLibraryUrl: "https://www.facebook.com/ads/library/?q=x" },
    });
    expect(api.calls[0]!.auth).toBe("Bearer crm-key");
  });

  it("uploads the PDF to the attachment file field, attaches it and adds a linked note", async () => {
    const api = mockFetch({
      "POST /metadata": () => ({ data: { uploadFilesFieldFileByUniversalIdentifier: { id: "file_9", path: "x.pdf" } } }),
      "POST /rest/attachments": () => ({ data: { createAttachment: { id: "att_9" } } }),
      "POST /rest/notes": () => ({ data: { createNote: { id: "note_9" } } }),
      "POST /rest/noteTargets": () => ({ data: { createNoteTarget: { id: "nt_9" } } }),
    });
    const bodies: unknown[] = [];
    const fetchImpl: typeof api.fetchImpl = async (input, init) => {
      bodies.push(init?.body);
      return api.fetchImpl(input, init);
    };
    const crm = new TwentyCrm(async () => "crm-key", fetchImpl, "https://crm.test");
    expect(await crm.uploadPdf("a.pdf", Buffer.from("%PDF"))).toBe("file_9");
    const form = bodies[0] as FormData;
    expect(String(form.get("operations"))).toContain(ATTACHMENT_FILE_FIELD);
    expect((form.get("0") as File).type).toBe("application/pdf");
    expect(await crm.attach("lead", LEAD_ID, "a.pdf", "file_9")).toBe("att_9");
    expect(api.called("POST /rest/attachments")[0]!.body).toEqual({ name: "a.pdf", file: [{ fileId: "file_9", label: "a.pdf" }], targetLeadId: LEAD_ID });
    expect(await crm.note("company", "c1", "Audit", "**x**")).toBe("note_9");
    expect(api.called("POST /rest/notes")[0]!.body).toEqual({ title: "Audit", bodyV2: { markdown: "**x**" } });
    expect(api.called("POST /rest/noteTargets")[0]!.body).toEqual({ noteId: "note_9", targetCompanyId: "c1" });
    expect(crm.recordUrl("lead", LEAD_ID)).toBe(`https://crm.test/object/lead/${LEAD_ID}`);
  });

  it("searches leads and companies by name, interleaved, at most ten", async () => {
    const leads = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, name: `Lead ${i}`, websiteUrl: { primaryLinkUrl: i === 0 ? "studio.sa" : "" }, instagramHandle: i === 0 ? "studio" : "", city: "RIYADH" }));
    const companies = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, name: `Company ${i}`, domainName: { primaryLinkUrl: "" }, address: { addressCity: "Jeddah" }, xLink: { primaryLinkUrl: "" } }));
    const api = mockFetch({ "GET /rest/leads": () => ({ data: { leads } }), "GET /rest/companies": () => ({ data: { companies } }) });
    const hits = await new TwentyCrm(async () => "k", api.fetchImpl, "https://crm.test").search('st"u%dio');
    expect(hits).toHaveLength(10);
    expect(hits.slice(0, 3)).toEqual([
      { id: "l0", kind: "lead", name: "Lead 0", website: "https://studio.sa", instagram: "studio", city: "RIYADH" },
      { id: "c0", kind: "company", name: "Company 0", city: "Jeddah" },
      { id: "l1", kind: "lead", name: "Lead 1", city: "RIYADH" },
    ]);
    const call = api.called("GET /rest/leads")[0]!;
    expect(call.query.get("filter")).toBe('name[ilike]:"%st u dio%"');
    expect(call.query.get("limit")).toBe("10");
    await new TwentyCrm(async () => "k", api.fetchImpl, "https://crm.test").search("");
    expect(api.called("GET /rest/companies")[1]!.query.get("filter")).toBeNull();
  });

  it("answers clean errors: no key, unknown record, bad id", async () => {
    const api = mockFetch({});
    await expect(new TwentyCrm(async () => null, api.fetchImpl).prospect("lead", LEAD_ID)).rejects.toMatchObject({ status: 502, message: CRM_NOT_CONNECTED });
    await expect(new TwentyCrm(async () => "k", api.fetchImpl).prospect("lead", LEAD_ID)).rejects.toMatchObject({ status: 404 });
    await expect(new TwentyCrm(async () => "k", api.fetchImpl).prospect("lead", "../etc")).rejects.toMatchObject({ status: 400 });
  });
});

function sampleAudit() {
  const data = { asOf: "2 Oct 2026", website: summarizeWebsite("https://www.thestudio.sa/", [page("https://www.thestudio.sa/")]) };
  const audit: ProspectAudit = {
    id: "aud_0001",
    prospect: { name: "استوديو <script>alert(1)</script>", website: "https://www.thestudio.sa/", city: "RIYADH", category: "BEAUTY" },
    status: "running",
    steps: AUDIT_STEPS.map((id) => ({ id, status: "done" })),
    requestedBy: "hq",
    createdAt: 1_790_000_000,
    updatedAt: 1_790_000_000,
    crmUrl: "https://crm.test/object/lead/1",
  };
  audit.score = scoreAudit(data, audit.prospect);
  Object.assign(audit, publicView(audit, data));
  audit.analysis = draftAnalysis(audit, audit.score, data);
  return { audit, data };
}

describe("audit report template", () => {
  it("renders the fourteen template pages, escaped, in IBM Plex with the logo and honest coverage", () => {
    const { audit, data } = sampleAudit();
    const html = renderReport(audit, data, audit.analysis!, { at: new Date("2026-10-01T09:00:00Z"), logo: "data:image/png;base64,TE9HTw==", screenshot: `data:image/png;base64,${PNG.toString("base64")}` });
    expect(html.match(/<section class="page/g)).toHaveLength(14);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("IBM+Plex+Sans+Arabic");
    expect(html).toContain("--mint: #21e6a2");
    expect(html).toContain("@page { size: 960pt 540pt");
    expect(html).toContain("CONFIDENTIAL &nbsp;|&nbsp; DIGITAL GAP AUDIT");
    expect(html).toContain('src="data:image/png;base64,TE9HTw=="');
    for (const title of [
      "Executive Summary",
      "The Seven Areas, At a Glance",
      "What a Visitor Sees",
      "Website and Technical",
      "Search: Brand vs Category",
      "Paid Media: Google and Meta",
      "Organic Social",
      "Traffic (Similarweb Estimates)",
      "Reputation and Local",
      "The Competitive Gap",
      "The Gaps",
      "The Fix: Foundation Before More Spend",
      "Thank you",
    ]) {
      expect(html).toContain(title);
    }
    expect(html).toContain("Not measured");
    expect(html).toContain("October 2026 | Confidential");
  });

  it("loads the Zain Growth logo from ZAIN_BRAND_DIR, and falls back to a text logo", async () => {
    const dir = await tempRoot();
    await mkdir(join(dir, "zain_growth", "01_logo_png"), { recursive: true });
    await writeFile(join(dir, GROWTH_LOGO), PNG);
    expect(brandLogo({ ZAIN_BRAND_DIR: dir })).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(brandLogo({ ZAIN_BRAND_DIR: join(tmpdir(), "no-such-brand-dir") })).toBeNull();
    const { audit, data } = sampleAudit();
    expect(renderReport(audit, data, audit.analysis!, { logo: null })).toContain('class="text-logo"');
  });

  it("refuses to render or capture without Chrome", async () => {
    await expect(new ChromeRenderer(() => null).render("<p>x</p>", "/nonexistent/x.pdf")).rejects.toThrow("Chrome is not installed");
    await expect(new ChromeRenderer(() => null).capture("https://a.sa/", "/nonexistent/x.png")).rejects.toThrow("Chrome is not installed");
  });
});

describe("Notion Prospect Audits", () => {
  it("creates the database on the Board Room's parent, idempotently", async () => {
    const root = await tempRoot();
    let exists = false;
    const api = mockFetch({
      [`GET /v1/blocks/${PARENT_PAGE_ID}/children`]: () => ({ results: exists ? [{ id: "db1", type: "child_database", child_database: { title: "Prospect Audits" } }] : [], has_more: false }),
      "POST /v1/databases": () => ((exists = true), { id: "db1", data_sources: [{ id: "ds1" }] }),
      "GET /v1/databases/db1": () => ({ data_sources: [{ id: "ds1" }] }),
      "PATCH /v1/data_sources/ds1": () => ({}),
    });
    const notion = new NotionClient(async () => "ntn", api.fetchImpl);
    expect(await setupProspectAudits({ notion, apply: false, root, log: () => undefined })).toBeNull();
    expect(api.called("POST /v1/databases")).toHaveLength(0);
    expect(await setupProspectAudits({ notion, apply: true, root, log: () => undefined })).toEqual({ databaseId: "db1", dataSourceId: "ds1" });
    const created = api.called("POST /v1/databases")[0]!.body as { parent: unknown; initial_data_source: { properties: Record<string, unknown> } };
    expect(created.parent).toEqual({ type: "page_id", page_id: PARENT_PAGE_ID });
    expect(Object.keys(created.initial_data_source.properties)).toEqual(
      expect.arrayContaining(["Prospect", "Website", "Score", "Grade", "Website score", "Brand score", "Performance score", "Reputation score", "Areas measured", "Status", "Audit date", "CRM", "PDF", "Top opportunities", "Category", "City"]),
    );
    await setupProspectAudits({ notion, apply: true, root, log: () => undefined });
    expect(api.called("POST /v1/databases")).toHaveLength(1);
    expect(api.called("PATCH /v1/data_sources/ds1")).toHaveLength(1);
  });

  it("files an audit as a row with the uploaded PDF, scores and links", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".zain"), { recursive: true });
    await writeFile(auditsIdsPath(root), JSON.stringify({ databaseId: "db1", dataSourceId: "ds1" }));
    const api = mockFetch({
      "POST /v1/file_uploads": () => ({ id: "fu1" }),
      "POST /v1/file_uploads/fu1/send": () => ({ id: "fu1", status: "uploaded" }),
      "POST /v1/data_sources/ds1/query": () => ({ results: [] }),
      "POST /v1/pages": () => ({ id: "p1", url: "https://notion.so/p1" }),
      "GET /v1/blocks/p1/children": () => ({ results: [], has_more: false }),
      "PATCH /v1/blocks/p1/children": () => ({}),
    });
    const { audit } = sampleAudit();
    const sink = new NotionAuditSink(new NotionClient(async () => "ntn", api.fetchImpl), root);
    expect(await sink.sync(audit, undefined, { bytes: new Uint8Array([37, 80]), url: "https://hq.test/api/growth/audits/aud_0001/pdf" })).toEqual({ pageId: "p1", url: "https://notion.so/p1" });
    const created = api.called("POST /v1/pages")[0]!.body as { parent: unknown; properties: Record<string, Record<string, unknown>> };
    expect(created.parent).toEqual({ type: "data_source_id", data_source_id: "ds1" });
    expect(created.properties.PDF).toEqual({ files: [{ type: "file_upload", file_upload: { id: "fu1" }, name: "aud_0001.pdf" }] });
    expect(created.properties.Score).toEqual({ number: audit.score!.overall });
    expect(created.properties.CRM).toEqual({ url: "https://crm.test/object/lead/1" });
    expect(created.properties["Search score"]).toEqual({ number: null }); // not measured
    expect(created.properties["Areas measured"]).toEqual({ number: audit.score!.areasMeasured });
    const blocks = JSON.stringify(api.called("PATCH /v1/blocks/p1/children")[0]!.body);
    expect(blocks).toContain("https://hq.test/api/growth/audits/aud_0001/pdf");
  });
});
