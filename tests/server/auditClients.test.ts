import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_STEPS, type ProspectAudit } from "../../shared/audits";
import { fallbackAnalysis } from "../../server/src/growth/audit/analysis";
import { ApifyClient } from "../../server/src/growth/audit/apify";
import { ATTACHMENT_FILE_FIELD, CRM_NOT_CONNECTED, TwentyCrm } from "../../server/src/growth/audit/crm";
import { NotionAuditSink, auditsIdsPath, setupProspectAudits } from "../../server/src/growth/audit/notion";
import { ChromePdfRenderer } from "../../server/src/growth/audit/pdf";
import { scoreAudit } from "../../server/src/growth/audit/score";
import { summarizeWebsite } from "../../server/src/growth/audit/collect/website";
import { renderReport } from "../../server/src/growth/audit/template/render";
import { NotionClient } from "../../server/src/notion/client";
import { PARENT_PAGE_ID } from "../../server/src/notion/boardRoom";
import { LEAD_ID, sampleItems, tempRoot } from "./auditFakes";
import { json, mockFetch } from "./helpers";

const TOKEN = "apify_api_SECRETSECRETSECRETSECRET1234";
const noSleep = async () => undefined;
const run = (status: string, extra: Record<string, unknown> = {}) => ({ data: { id: "r1", status, defaultDatasetId: "d1", ...extra } });

describe("Apify client", () => {
  it("starts the run with limits, waits for it, and returns the dataset and its cost", async () => {
    const api = mockFetch({
      "POST /v2/acts/apify~web-scraper/runs": () => run("RUNNING"),
      "GET /v2/actor-runs/r1": (_c, n) => (n === 1 ? run("RUNNING") : run("SUCCEEDED", { usageTotalUsd: 0.07 })),
      "GET /v2/datasets/d1/items": () => [{ url: "https://a.sa/" }],
    });
    const client = new ApifyClient(async () => TOKEN, api.fetchImpl, noSleep);
    const out = await client.run("apify/web-scraper", { startUrls: [] }, { maxItems: 25, maxTotalChargeUsd: 0.3, timeoutSecs: 420, memoryMbytes: 2048 });
    expect(out).toEqual({ items: [{ url: "https://a.sa/" }], costUsd: 0.07 });
    const [start] = api.calls;
    expect(start!.auth).toBe(`Bearer ${TOKEN}`);
    expect(Object.fromEntries(start!.query)).toEqual({ waitForFinish: "60", timeout: "420", maxItems: "25", maxTotalChargeUsd: "0.30", memory: "2048" });
    expect(start!.body).toEqual({ startUrls: [] });
    expect(api.called("GET /v2/actor-runs/r1")).toHaveLength(2);
    expect(api.calls.at(-1)!.query.get("limit")).toBe("25");
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

  it("answers clean errors: no key, unknown record, bad id", async () => {
    const api = mockFetch({});
    await expect(new TwentyCrm(async () => null, api.fetchImpl).prospect("lead", LEAD_ID)).rejects.toMatchObject({ status: 502, message: CRM_NOT_CONNECTED });
    await expect(new TwentyCrm(async () => "k", api.fetchImpl).prospect("lead", LEAD_ID)).rejects.toMatchObject({ status: 404 });
    await expect(new TwentyCrm(async () => "k", api.fetchImpl).prospect("lead", "../etc")).rejects.toMatchObject({ status: 400 });
  });
});

function sampleAudit(): { audit: ProspectAudit; data: Parameters<typeof renderReport>[1] } {
  const data = { website: summarizeWebsite("https://www.thestudio.sa/", sampleItems()["apify/web-scraper"]!) };
  const score = scoreAudit(data, "BEAUTY");
  const audit: ProspectAudit = {
    id: "aud_0001",
    prospect: { name: "استوديو <script>alert(1)</script>", website: "https://www.thestudio.sa/", city: "RIYADH", category: "BEAUTY" },
    status: "running",
    steps: AUDIT_STEPS.map((id) => ({ id, status: "done" })),
    score,
    requestedBy: "hq",
    createdAt: 1_790_000_000,
    updatedAt: 1_790_000_000,
    crmUrl: "https://crm.test/object/lead/1",
  };
  audit.analysis = fallbackAnalysis(audit, score, data);
  return { audit, data };
}

describe("audit report template", () => {
  it("renders the ten branded pages, escaped, with Arabic-capable fonts and Ahmad's contact", () => {
    const { audit, data } = sampleAudit();
    const html = renderReport(audit, data, new Date("2026-10-01T00:00:00Z"));
    expect(html.match(/<section class="page/g)).toHaveLength(10);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("IBM+Plex+Sans+Arabic");
    expect(html).toContain("--brand: #3dbe7a");
    expect(html).toContain("ahmad@zain-studio.com");
    expect(html).toContain(`Overall score ${audit.score!.overall} of 100`);
    for (const title of ["Executive summary", "Scorecard", "Website &amp; SEO", "Search visibility", "Social media", "Paid ads", "Tracking", "Top opportunities", "Next steps"]) {
      expect(html).toContain(title);
    }
  });

  it("refuses to render without Chrome", async () => {
    await expect(new ChromePdfRenderer(() => null).render("<p>x</p>", "/nonexistent/x.pdf")).rejects.toThrow("Chrome is not installed");
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
      expect.arrayContaining(["Prospect", "Website", "Score", "Grade", "Website score", "Tracking score", "Status", "Audit date", "CRM", "PDF", "Top opportunities", "Category", "City"]),
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
    const page = api.called("POST /v1/pages")[0]!.body as { parent: unknown; properties: Record<string, Record<string, unknown>> };
    expect(page.parent).toEqual({ type: "data_source_id", data_source_id: "ds1" });
    expect(page.properties.PDF).toEqual({ files: [{ type: "file_upload", file_upload: { id: "fu1" }, name: "aud_0001.pdf" }] });
    expect(page.properties.Score).toEqual({ number: audit.score!.overall });
    expect(page.properties.CRM).toEqual({ url: "https://crm.test/object/lead/1" });
    expect(page.properties["Search score"]).toEqual({ number: null }); // not measured
    const blocks = JSON.stringify(api.called("PATCH /v1/blocks/p1/children")[0]!.body);
    expect(blocks).toContain("https://hq.test/api/growth/audits/aud_0001/pdf");
  });
});
