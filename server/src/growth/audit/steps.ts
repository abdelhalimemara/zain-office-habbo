import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUDITS_API, AUDIT_AREA_LABELS, type AuditStepId, type ProspectAudit } from "../../../../shared/audits";
import type { HermesClient } from "../../hermes/client";
import { ANALYSIS_TITLE_PREFIX, AUDIT_AGENT, FALLBACK_AGENT, analysisTaskBody, draftAnalysis, parseAnalysis } from "./analysis";
import { nameFromDomain, publicView } from "./benchmark";
import { shortDate } from "./dates";
import { CostCapReached, type Budget } from "./budget";
import type { PdfRenderer, Screenshotter } from "./chrome";
import { collectAds } from "./collect/ads";
import { collectSearch, pickCompetitors } from "./collect/search";
import { semrushAudit, semrushDomains } from "./collect/seo";
import { MAX_COMPETITORS, collectSocial } from "./collect/social";
import { collectWebsite, tagRead } from "./collect/website";
import type { AuditCrm, CrmRecordKind } from "./crm";
import type { AuditNotionSink } from "./notion";
import { scoreAudit } from "./score";
import { renderReport } from "./template/render";
import { validateWebsite, type Resolver } from "./url";
import type { StoredAudit } from "./types";

/** Hermes as the audit uses it (a narrow slice, so tests can fake it). */
export type AuditHermes = Pick<HermesClient, "createTask" | "task" | "listProfiles" | "updateTask" | "addComment">;

/** An agent that has not answered by then gets the analysis written from the scores. */
export const ANALYSIS_TIMEOUT_SECONDS = 45 * 60;
const GROWTH_TENANT = "zain-growth";

export interface StepContext {
  budget: Budget;
  hermes: AuditHermes;
  crm: AuditCrm;
  pdf: PdfRenderer;
  screenshots?: Screenshotter;
  notion?: AuditNotionSink;
  resolve?: Resolver;
  root: string;
  publicBase: string;
  now: () => number;
  log: (line: string) => void;
  /** Saves part of a step's progress right away (e.g. a CRM upload), so a retry does not repeat it. */
  save: (patch: (s: StoredAudit) => void) => Promise<StoredAudit>;
}

/** What a finished (or, for analysis, started) step leaves behind. */
export interface Outcome {
  status: "done" | "skipped" | "running" | "failed";
  note: string;
  costUsd?: number;
  patch?: (s: StoredAudit) => void;
}

export const pdfFile = (root: string, id: string) => join(root, ".zain", "audits", `${id}.pdf`);
export const screenshotFile = (root: string, id: string) => join(root, ".zain", "audits", `${id}-mobile.png`);
export const screenshotUrl = (id: string) => `${AUDITS_API.one(id)}/screenshot`;
export const publicPdfUrl = (base: string, id: string) => `${base.replace(/\/+$/, "")}${AUDITS_API.pdf(id)}`;
/** "2 Oct 2026": the date every source label carries. */
export const asOfLabel = (unixSeconds: number) => shortDate(unixSeconds * 1000);

async function capped(run: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof CostCapReached) return { status: "skipped", note: err.message, costUsd: (err as { costUsd?: number }).costUsd ?? 0 };
    throw err;
  }
}

/** Crawl and mobile capture together; a failed capture is noted, the crawl decides the step. */
async function websiteStep(s: StoredAudit, ctx: StepContext): Promise<Outcome> {
  const website = s.audit.prospect.website;
  const shot = (async () => {
    if (!ctx.screenshots) return false;
    try {
      // Re-checked here: Chrome on this machine fetches the page, so the host must still resolve publicly.
      await validateWebsite(website, ctx.resolve);
      await ctx.screenshots.capture(website, screenshotFile(ctx.root, s.id));
      return true;
    } catch (err) {
      ctx.log(`audits: ${s.id} mobile capture failed (${err instanceof Error ? err.message : "error"})`);
      return false;
    }
  })();
  const [r, captured] = await Promise.all([collectWebsite(s.id, website, ctx.budget, s.crmFlags), shot]);
  return {
    status: r.status,
    note: `${r.note}${captured ? "; mobile capture taken" : ctx.screenshots ? "; mobile capture failed" : ""}`,
    costUsd: r.costUsd,
    patch: (x) => {
      if (r.data) {
        x.data.website = r.data;
        x.audit.tags = tagRead(r.data.trackers);
      }
      if (captured) x.audit.screenshotPath = screenshotUrl(s.id);
    },
  };
}

/** The Semrush home-page audit, the brand and category searches, then competitors, then Semrush for all. */
async function searchStep(s: StoredAudit, ctx: StepContext): Promise<Outcome> {
  const p = s.audit.prospect;
  const asOf = s.data.asOf ?? asOfLabel(s.audit.createdAt);
  let costUsd = 0;
  const notes: string[] = [];
  // The Semrush home-page audit first: the keywords the site ranks for become the category searches.
  const [audit] = await Promise.allSettled([semrushAudit(s.id, p.website, ctx.budget)]);
  const auditItem = audit.status === "fulfilled" ? audit.value.item : undefined;
  const semrush = (auditItem?.semrush ?? {}) as { organic_competitors?: { domain?: string }[]; top_organic_keywords?: { keyword?: string; volume?: number }[] };
  const keywords = (semrush.top_organic_keywords ?? [])
    .filter((k) => typeof k.keyword === "string")
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .map((k) => k.keyword!);
  const [serp] = await Promise.allSettled([collectSearch(s.id, p, s.data.website, ctx.budget, p.category ? [] : keywords)]);
  for (const r of [serp, audit]) {
    if (r.status === "fulfilled") costUsd += r.value.costUsd;
    else costUsd += (r.reason as { costUsd?: number }).costUsd ?? 0;
  }
  const search = serp.status === "fulfilled" ? serp.value.data : undefined;
  if (serp.status === "fulfilled") notes.push(serp.value.note);
  else notes.push(`searches failed (${(serp.reason as Error).message.slice(0, 60)})`);
  const semrushCompetitors = (semrush.organic_competitors ?? []).map((c) => String(c.domain ?? ""));
  const domains = pickCompetitors(p, search, semrushCompetitors);
  let seo: Awaited<ReturnType<typeof semrushDomains>>["seo"] | undefined;
  try {
    const r = await semrushDomains(s.id, p.website, domains, auditItem, ctx.budget, asOf);
    seo = r.seo;
    costUsd += r.costUsd;
    notes.push(`Semrush authority ${seo.read.authorityScore ?? "—"}`);
  } catch (err) {
    costUsd += (err as { costUsd?: number }).costUsd ?? 0;
    notes.push(err instanceof CostCapReached ? err.message : `Semrush failed (${(err as Error).message.slice(0, 60)})`);
  }
  if (!search && !seo) throw Object.assign(new Error(notes.join("; ")), { costUsd });
  notes.push(`${domains.length} competitor candidates: ${domains.join(", ") || "none found"}`);
  return {
    status: "done",
    note: notes.join("; "),
    costUsd,
    patch: (x) => {
      if (search) {
        x.data.search = search;
        x.audit.searchRuns = search.runs;
      }
      if (seo) {
        x.data.seo = seo;
        x.audit.seo = seo.read;
      }
      x.data.competitors = domains.map((domain) => ({ domain, name: nameFromDomain(domain) }));
    },
  };
}

export async function runStep(step: AuditStepId, s: StoredAudit, ctx: StepContext): Promise<Outcome> {
  const { audit, data } = s;
  const p = audit.prospect;
  switch (step) {
    case "website":
      return capped(() => websiteStep(s, ctx));
    case "search":
      return capped(() => searchStep(s, ctx));
    case "social":
      return capped(async () => {
        const r = await collectSocial(s.id, p, data.website, data.competitors ?? [], ctx.budget);
        return {
          status: r.status,
          note: r.note,
          costUsd: r.costUsd,
          patch: (x) => {
            if (r.data) {
              x.data.social = r.data;
              x.audit.social = r.data.rows;
            }
            if (r.competitors) x.data.competitors = r.competitors;
          },
        };
      });
    case "ads":
      return capped(async () => {
        const r = await collectAds(s.id, p, (data.competitors ?? []).slice(0, MAX_COMPETITORS), ctx.budget, s.crmFlags);
        return { status: r.status, note: r.note, costUsd: r.costUsd, patch: (x) => r.data && (x.data.ads = r.data) };
      });
    case "score": {
      const score = scoreAudit(data, p, data.asOf ?? asOfLabel(audit.createdAt));
      const view = publicView(audit, data);
      return {
        status: "done",
        note: `Overall ${score.overall}/100, grade ${score.grade}, ${score.areasMeasured} of 7 areas measured`,
        patch: (x) => Object.assign(x.audit, view, { score }),
      };
    }
    case "analysis":
      return startAnalysis(s, ctx);
    case "pdf": {
      const shot = audit.screenshotPath ? await readFile(screenshotFile(ctx.root, s.id)).catch(() => null) : null;
      const analysis = audit.analysis ?? draftAnalysis(audit, audit.score!, data);
      const html = renderReport(audit, data, analysis, { screenshot: shot ? `data:image/png;base64,${shot.toString("base64")}` : null });
      await ctx.pdf.render(html, pdfFile(ctx.root, s.id));
      return { status: "done", note: "Branded Digital Gap Audit rendered (14 pages)", patch: (x) => (x.audit.pdfPath = AUDITS_API.pdf(s.id)) };
    }
    case "crm":
      return fileInCrm(s, ctx);
    case "notion": {
      if (!ctx.notion) return { status: "skipped", note: "Notion is not configured" };
      const bytes = await readFile(pdfFile(ctx.root, s.id)).catch(() => undefined);
      const page = await ctx.notion.sync(audit, s.notionPageId, { bytes, url: publicPdfUrl(ctx.publicBase, s.id) });
      return {
        status: "done",
        note: "Filed in Prospect Audits",
        patch: (x) => {
          x.notionPageId = page.pageId;
          x.audit.notionPageUrl = page.url;
        },
      };
    }
  }
}

async function startAnalysis(s: StoredAudit, ctx: StepContext): Promise<Outcome> {
  const score = s.audit.score!;
  let assignee = FALLBACK_AGENT;
  try {
    if ((await ctx.hermes.listProfiles()).some((p) => p.name === AUDIT_AGENT)) assignee = AUDIT_AGENT;
  } catch {
    // Hermes down: createTask below reports it.
  }
  try {
    const task = await ctx.hermes.createTask({
      title: `${ANALYSIS_TITLE_PREFIX}${s.audit.prospect.name}`,
      body: analysisTaskBody(s.audit, s.data, score),
      assignee,
      tenant: GROWTH_TENANT,
      triage: false,
    });
    return {
      status: "running",
      note: `Waiting for ${assignee} (task ${task.id})`,
      patch: (x) => (x.analysisTask = { taskId: task.id, assignee, startedAt: ctx.now() }),
    };
  } catch (err) {
    ctx.log(`audits: ${s.id} analysis task could not be created (${err instanceof Error ? err.message : "error"})`);
    const analysis = draftAnalysis(s.audit, score, s.data);
    return { status: "done", note: "Hermes was unavailable; analysis written from the scores", patch: (x) => (x.audit.analysis = analysis) };
  }
}

/** Picks up the agent's answer once its task is done; null while it is still working. */
export async function checkAnalysis(s: StoredAudit, ctx: StepContext): Promise<Outcome | null> {
  const t = s.analysisTask;
  if (!t?.taskId) return null;
  const draft = draftAnalysis(s.audit, s.audit.score!, s.data);
  const fallback = (note: string): Outcome => ({ status: "done", note, patch: (x) => (x.audit.analysis = draft) });
  const { task } = await ctx.hermes.task(t.taskId);
  if (task.status === "done") {
    const parsed = parseAnalysis(task.result ?? task.latest_summary ?? "", draft);
    if (parsed) return { status: "done", note: `Written by ${t.assignee}`, patch: (x) => (x.audit.analysis = parsed) };
    return fallback(`${t.assignee}'s answer was not valid JSON; analysis written from the scores`);
  }
  if (task.status === "archived") return fallback("The analysis task was archived; analysis written from the scores");
  if (ctx.now() - t.startedAt > ANALYSIS_TIMEOUT_SECONDS) {
    await ctx.hermes.updateTask(t.taskId, { status: "archived" }).catch(() => undefined);
    return fallback(`${t.assignee} did not answer in 45 minutes; analysis written from the scores`);
  }
  return null;
}

export function crmNote(a: ProspectAudit, pdfUrl: string): string {
  const s = a.score!;
  const areas = s.areas.map((x) => `- ${AUDIT_AREA_LABELS[x.area]}: ${x.status === "not-measured" ? "not measured" : `${x.status}${x.severity ? ` (${x.severity})` : ""}, ${x.score}/100`}`);
  const top = (a.analysis?.opportunities ?? []).slice(0, 3).map((o, i) => `${i + 1}. ${o.title} (${o.service})`);
  return [
    `**Zain Growth Digital Gap Audit**: ${s.overall}/100, grade ${s.grade}, ${s.areasMeasured} of 7 areas measured`,
    "",
    ...areas,
    "",
    a.analysis?.executiveSummary ?? "",
    "",
    "**Top opportunities**",
    ...top,
    "",
    `PDF report: ${pdfUrl}`,
  ].join("\n");
}

async function fileInCrm(s: StoredAudit, ctx: StepContext): Promise<Outcome> {
  const { leadId, companyId } = s.audit.prospect;
  const target: [CrmRecordKind, string] | null = leadId ? ["lead", leadId] : companyId ? ["company", companyId] : null;
  if (!target) return { status: "skipped", note: "Not linked to a CRM record (started from a website)" };
  const [kind, id] = target;
  const url = publicPdfUrl(ctx.publicBase, s.id);
  const name = `Zain Growth Digital Gap Audit - ${s.audit.prospect.name}.pdf`;
  let progress = s.crm ?? {};
  let attached = !!progress.attachmentId;
  if (!attached) {
    try {
      if (!progress.fileId) {
        const fileId = await ctx.crm.uploadPdf(name, await readFile(pdfFile(ctx.root, s.id)));
        progress = (await ctx.save((x) => (x.crm = { ...x.crm, fileId }))).crm ?? { fileId };
      }
      const attachmentId = await ctx.crm.attach(kind, id, name, progress.fileId!);
      progress = (await ctx.save((x) => (x.crm = { ...x.crm, attachmentId }))).crm ?? progress;
      attached = true;
    } catch (err) {
      // The note below still links the PDF on Zain HQ.
      ctx.log(`audits: ${s.id} CRM attachment failed (${err instanceof Error ? err.message : "error"})`);
    }
  }
  if (!progress.noteId) {
    const noteId = await ctx.crm.note(kind, id, `Digital Gap Audit: ${s.audit.score?.overall ?? "?"}/100 (${s.audit.score?.grade ?? "?"})`, crmNote(s.audit, url));
    await ctx.save((x) => (x.crm = { ...x.crm, noteId }));
  }
  const crmUrl = ctx.crm.recordUrl(kind, id);
  return {
    status: "done",
    note: attached ? `PDF attached to the ${kind} with a summary note` : "Summary note added with a link to the PDF (attachment failed)",
    patch: (x) => {
      x.audit.crmUrl = crmUrl;
      if (x.crm?.attachmentId) x.audit.crmAttachmentId = x.crm.attachmentId;
    },
  };
}
