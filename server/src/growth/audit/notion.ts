import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuditStatus, ProspectAudit } from "../../../../shared/audits";
import { PARENT_PAGE_ID } from "../../notion/boardRoom";
import { NotionClient, RICH_TEXT_MAX, bullet, heading, paragraph, paragraphs, richText } from "../../notion/client";

export const AUDITS_DATABASE_TITLE = "Prospect Audits";

export interface AuditsNotionIds {
  databaseId: string;
  dataSourceId: string;
}

const STATUS: Record<AuditStatus, string> = { queued: "Queued", running: "Running", done: "Done", failed: "Failed", cancelled: "Cancelled" };
const select = (names: readonly string[]) => ({ select: { options: names.map((name) => ({ name })) } });
const SECTION_PROPS = { website: "Website score", search: "Search score", social: "Social score", ads: "Ads score", tracking: "Tracking score" } as const;

/** The Prospect Audits schema; re-sending it is harmless (Notion merges properties). */
export function auditsDatabaseProperties(): Record<string, unknown> {
  return {
    Prospect: { title: {} },
    Website: { url: {} },
    Score: { number: { format: "number" } },
    Grade: select(["A", "B", "C", "D", "E"]),
    ...Object.fromEntries(Object.values(SECTION_PROPS).map((p) => [p, { number: { format: "number" } }])),
    Status: select(Object.values(STATUS)),
    "Audit date": { date: {} },
    CRM: { url: {} },
    PDF: { files: {} },
    "Top opportunities": { rich_text: {} },
    Category: { rich_text: {} },
    City: { rich_text: {} },
    "Zain HQ ID": { rich_text: {} },
  };
}

export const auditsIdsPath = (root: string) => join(root, ".zain", "notion-audits.json");

export async function readAuditsIds(root: string): Promise<AuditsNotionIds | null> {
  try {
    const data = JSON.parse(await readFile(auditsIdsPath(root), "utf8")) as Partial<AuditsNotionIds>;
    return data.databaseId && data.dataSourceId ? (data as AuditsNotionIds) : null;
  } catch {
    return null;
  }
}

type Block = Record<string, unknown> & { id: string; type: string };
const childTitle = (b: Block) => ((b[b.type] as { title?: string } | undefined)?.title ?? "").trim();

/**
 * Finds or creates the "Prospect Audits" database on Zain Studio OS (the Board Room page's parent),
 * matching by title so re-runs change nothing but the schema. Dry run unless `apply`.
 */
export async function setupProspectAudits(opts: { notion: NotionClient; apply: boolean; root: string; log?: (line: string) => void }): Promise<AuditsNotionIds | null> {
  const { notion, apply, root, log = console.log } = opts;
  const parent = (await notion.children(PARENT_PAGE_ID)) as Block[];
  let databaseId = parent.find((b) => b.type === "child_database" && childTitle(b) === AUDITS_DATABASE_TITLE)?.id;
  log(databaseId ? `Found database "${AUDITS_DATABASE_TITLE}".` : `Database "${AUDITS_DATABASE_TITLE}" is missing.`);
  if (!apply) {
    log("Dry run. Re-run with --apply to create it and update its schema.");
    return null;
  }
  let dataSourceId: string;
  if (!databaseId) {
    const db = await notion.request<{ id: string; data_sources: { id: string }[] }>("POST", "/databases", {
      parent: { type: "page_id", page_id: PARENT_PAGE_ID },
      title: [{ type: "text", text: { content: AUDITS_DATABASE_TITLE } }],
      icon: { type: "emoji", emoji: "🔎" },
      is_inline: false,
      initial_data_source: { properties: auditsDatabaseProperties() },
    });
    databaseId = db.id;
    dataSourceId = db.data_sources[0]!.id;
    log(`Created database "${AUDITS_DATABASE_TITLE}".`);
  } else {
    const db = await notion.request<{ data_sources: { id: string }[] }>("GET", `/databases/${databaseId}`);
    dataSourceId = db.data_sources[0]!.id;
    await notion.request("PATCH", `/data_sources/${dataSourceId}`, { properties: auditsDatabaseProperties() });
    log(`Updated the "${AUDITS_DATABASE_TITLE}" schema.`);
  }
  const ids = { databaseId, dataSourceId };
  const path = auditsIdsPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(ids, null, 2)}\n`, "utf8");
  await rename(`${path}.tmp`, path);
  log(`Saved ids to ${path}.`);
  return ids;
}

const text = (value: string) => ({ rich_text: richText(value.slice(0, RICH_TEXT_MAX)) });
const url = (value: string | undefined) => ({ url: value ?? null });

export function auditProperties(a: ProspectAudit, pdf: { uploadId?: string; url?: string }): Record<string, unknown> {
  const s = a.score;
  const files = pdf.uploadId
    ? [{ type: "file_upload", file_upload: { id: pdf.uploadId }, name: `${a.id}.pdf` }]
    : pdf.url
      ? [{ type: "external", name: `${a.id}.pdf`, external: { url: pdf.url } }]
      : [];
  return {
    Prospect: { title: richText(a.prospect.name) },
    Website: url(a.prospect.website),
    Score: { number: s?.overall ?? null },
    Grade: { select: s ? { name: s.grade } : null },
    ...Object.fromEntries(
      (Object.keys(SECTION_PROPS) as (keyof typeof SECTION_PROPS)[]).map((k) => [SECTION_PROPS[k], { number: s && s.sections[k].weight > 0 ? s.sections[k].score : null }]),
    ),
    Status: { select: { name: STATUS[a.status] } },
    "Audit date": { date: { start: new Date(a.createdAt * 1000).toISOString() } },
    CRM: url(a.crmUrl),
    PDF: { files },
    "Top opportunities": text((a.analysis?.opportunities ?? []).slice(0, 3).map((o, i) => `${i + 1}. ${o.title} (${o.service})`).join("\n")),
    Category: text(a.prospect.category ?? ""),
    City: text(a.prospect.city ?? ""),
    "Zain HQ ID": text(a.id),
  };
}

export function auditBlocks(a: ProspectAudit, pdfUrl: string | undefined): Record<string, unknown>[] {
  const s = a.score;
  const an = a.analysis;
  const blocks: Record<string, unknown>[] = [heading("Summary"), ...paragraphs(an?.executiveSummary ?? "")];
  if (s) {
    blocks.push(heading("Scorecard"), paragraph(`Overall ${s.overall}/100 · grade ${s.grade}`));
    for (const [k, v] of Object.entries(s.sections)) {
      blocks.push(bullet(v.weight > 0 ? `${k}: ${v.score}/100 — ${v.drivers.join("; ")}` : `${k}: not measured`));
    }
  }
  if (an?.findings.length) blocks.push(heading("Findings"), ...an.findings.map((f) => bullet(`[${f.severity}] ${f.section} · ${f.title}: ${f.detail}`)));
  if (an?.opportunities.length) {
    blocks.push(heading("Opportunities"), ...an.opportunities.map((o) => bullet(`${o.title} — ${o.service} (impact ${o.impact}, effort ${o.effort})`)));
  }
  if (an?.competitors.length) blocks.push(heading("Competitors"), ...an.competitors.map((c) => bullet(`${c.name}${c.domain ? ` (${c.domain})` : ""}: ${c.note}`)));
  if (an?.pitchAngle) blocks.push(heading("Pitch angle"), ...paragraphs(an.pitchAngle));
  blocks.push(heading("Links"));
  if (pdfUrl) blocks.push(bullet(`PDF report: ${pdfUrl}`));
  if (a.crmUrl) blocks.push(bullet(`CRM record: ${a.crmUrl}`));
  blocks.push(bullet(`Website: ${a.prospect.website}`));
  return blocks;
}

/** Files an audit as one row of Prospect Audits (found again by its Zain HQ id); the body is rewritten each time. */
export interface AuditNotionSink {
  sync(a: ProspectAudit, pageId: string | undefined, pdf: { bytes?: Uint8Array; url: string }): Promise<{ pageId: string; url: string }>;
}

export class NotionAuditSink implements AuditNotionSink {
  private ids: AuditsNotionIds | null = null;

  constructor(
    private readonly notion: NotionClient,
    private readonly root: string,
    private readonly log: (line: string) => void = console.warn,
  ) {}

  async sync(a: ProspectAudit, knownPageId: string | undefined, pdf: { bytes?: Uint8Array; url: string }) {
    this.ids ??= await readAuditsIds(this.root);
    if (!this.ids) throw new Error("Notion Prospect Audits is not set up yet — run npx tsx server/src/scripts/growthNotion.ts --apply");
    let uploadId: string | undefined;
    if (pdf.bytes) {
      try {
        uploadId = await this.notion.uploadFile(`${a.prospect.name.replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 60) || a.id} audit.pdf`, "application/pdf", pdf.bytes);
      } catch (err) {
        this.log(`audits: Notion file upload failed, linking the PDF instead (${err instanceof Error ? err.message : "error"})`);
      }
    }
    const properties = auditProperties(a, { uploadId, url: pdf.url });
    let pageId = knownPageId;
    if (!pageId) {
      const found = await this.notion.request<{ results: { id: string }[] }>("POST", `/data_sources/${this.ids.dataSourceId}/query`, {
        filter: { property: "Zain HQ ID", rich_text: { equals: a.id } },
        page_size: 1,
      });
      pageId = found.results[0]?.id;
    }
    const page = pageId
      ? await this.notion.request<{ id: string; url: string }>("PATCH", `/pages/${pageId}`, { properties })
      : await this.notion.request<{ id: string; url: string }>("POST", "/pages", {
          parent: { type: "data_source_id", data_source_id: this.ids.dataSourceId },
          icon: { type: "emoji", emoji: "🔎" },
          properties,
        });
    for (const child of await this.notion.children(page.id)) await this.notion.request("DELETE", `/blocks/${String(child.id)}`);
    await this.notion.append(page.id, auditBlocks(a, pdf.url));
    return { pageId: page.id, url: page.url };
  }
}
