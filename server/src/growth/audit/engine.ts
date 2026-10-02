import { randomBytes } from "node:crypto";
import { AUDIT_STEPS, type AuditStep, type AuditStepId, type ProspectAudit, type StartAuditRequest } from "../../../../shared/audits";
import type { RecordStore } from "../../board/recordStore";
import { HttpError } from "../../http";
import type { ActorRunner } from "./apify";
import { Budget, round } from "./budget";
import type { AuditCrm } from "./crm";
import type { AuditNotionSink } from "./notion";
import type { PdfRenderer } from "./pdf";
import { checkAnalysis, pdfFile, runStep, type AuditHermes, type Outcome, type StepContext } from "./steps";
import type { CrmFlags, StoredAudit } from "./types";
import { dnsResolver, siteHost, validateWebsite, type Resolver } from "./url";

export const MAX_RUNNING_AUDITS = 2;
export const DEFAULT_PUBLIC_BASE = "https://hq.zain-studio.com";

export interface AuditEngineDeps {
  store: RecordStore<StoredAudit>;
  apify: ActorRunner;
  hermes: AuditHermes;
  crm: AuditCrm;
  pdf: PdfRenderer;
  notion?: AuditNotionSink;
  /** Where .zain/audits/<id>.pdf is written. */
  root: string;
  /** Base of the PDF links filed in the CRM and Notion. */
  publicBase?: string;
  resolve?: Resolver;
  maxRunning?: number;
  /** Apify spend cap per audit; AUDIT_MAX_COST_USD unless a test lowers it. */
  maxCostUsd?: number;
  now?: () => number;
  log?: (line: string) => void;
  newId?: () => string;
}

const FINISHED = new Set(["done", "skipped", "failed"]);
const OPEN = new Set(["queued", "running"]);
/** Steps that only need what came before them in this table. */
const NEEDS: Record<AuditStepId, readonly AuditStepId[]> = {
  website: [],
  ads: [],
  search: ["website"],
  social: ["website"],
  score: ["website", "search", "social", "ads"],
  analysis: ["score"],
  pdf: ["analysis"],
  crm: ["pdf"],
  notion: ["crm"],
};
/** A failure here ends the audit; other steps fail on their own and the audit carries on. */
const CRITICAL = new Set<AuditStepId>(["website", "score", "pdf"]);

const step = (a: ProspectAudit, id: AuditStepId) => a.steps.find((s) => s.id === id)!;

/**
 * Prospect audits as persisted jobs (.zain/audits.json). tick() promotes queued audits into the two
 * running slots and starts every step whose inputs are ready; steps run in the background (Apify runs
 * take minutes), save their outcome and kick the next tick. The analysis step is a Hermes task that
 * later ticks pick up. Every change to a record goes through update(), one at a time per audit.
 */
export class AuditEngine {
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly budget: Budget;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: AuditEngineDeps) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = deps.log ?? console.log;
    this.budget = new Budget(deps.apify, deps.maxCostUsd);
  }

  async list(): Promise<ProspectAudit[]> {
    return (await this.deps.store.list()).map((s) => s.audit).sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<ProspectAudit> {
    return (await this.load(id)).audit;
  }

  /** Where an audit's PDF lives on disk. */
  pdfLocation(id: string): string {
    return pdfFile(this.deps.root, id);
  }

  /** Resolves the prospect (from the CRM when ids are given), validates its website and queues the audit. */
  async start(req: StartAuditRequest, requestedBy: ProspectAudit["requestedBy"]): Promise<ProspectAudit> {
    const record = req.leadId
      ? await this.deps.crm.prospect("lead", req.leadId)
      : req.companyId
        ? await this.deps.crm.prospect("company", req.companyId)
        : null;
    const website = req.website ?? record?.prospect.website;
    if (!website) throw new HttpError(400, "This CRM record has no website; pass website");
    const url = await validateWebsite(website, this.deps.resolve ?? dnsResolver);
    const prospect = { ...record?.prospect, ...req.socials, name: req.name ?? record?.prospect.name ?? siteHost(url), website: url };
    await this.ensureNoOpenAudit(prospect);
    const at = this.now();
    const audit: ProspectAudit = {
      id: this.deps.newId?.() ?? `aud_${randomBytes(5).toString("hex")}`,
      prospect: Object.fromEntries(Object.entries(prospect).filter(([, v]) => v !== undefined)) as unknown as ProspectAudit["prospect"],
      status: "queued",
      steps: AUDIT_STEPS.map((id) => ({ id, status: "pending" })),
      costUsd: 0,
      requestedBy,
      createdAt: at,
      updatedAt: at,
    };
    const flags: CrmFlags | undefined = record && Object.values(record.flags).some((v) => v !== undefined) ? record.flags : undefined;
    await this.deps.store.put({ id: audit.id, audit, data: {}, ...(flags ? { crmFlags: flags } : {}) });
    void this.tick();
    return audit;
  }

  /** Reruns from the first step that did not finish; collection steps that finished keep their data. */
  async retry(id: string): Promise<ProspectAudit> {
    const current = await this.load(id);
    const a = current.audit;
    const first = a.steps.findIndex((s) => s.status === "failed" || s.status === "skipped" || s.status === "pending");
    if (OPEN.has(a.status)) throw new HttpError(409, `audit ${id} is still ${a.status}`);
    if (first < 0) throw new HttpError(409, `audit ${id} has nothing to retry`);
    await this.ensureNoOpenAudit(a.prospect, id);
    const saved = await this.update(id, (s) => {
      for (const st of s.audit.steps.slice(first)) {
        if (st.status === "done" && ["website", "search", "social", "ads"].includes(st.id)) continue;
        st.status = "pending";
        delete st.note;
        delete st.startedAt;
        delete st.finishedAt;
        if (st.id === "score") delete s.audit.score;
        if (st.id === "analysis") {
          delete s.audit.analysis;
          delete s.analysisTask;
        }
        if (st.id === "pdf") delete s.audit.pdfPath;
      }
      s.audit.status = "queued";
      delete s.audit.error;
    });
    void this.tick();
    return saved.audit;
  }

  async cancel(id: string): Promise<ProspectAudit> {
    const current = await this.load(id);
    if (!OPEN.has(current.audit.status)) throw new HttpError(409, `audit ${id} is already ${current.audit.status}`);
    const saved = await this.update(id, (s) => {
      s.audit.status = "cancelled";
      for (const st of s.audit.steps) if (st.status === "pending") st.note = "Cancelled";
    });
    const task = saved.analysisTask?.taskId;
    if (task && step(saved.audit, "analysis").status === "running") await this.deps.hermes.updateTask(task, { status: "archived" }).catch(() => undefined);
    return saved.audit;
  }

  /** One pass: queued audits into free slots, ready steps started, finished audits closed. Never throws. */
  async tick(): Promise<void> {
    try {
      const all = await this.deps.store.list();
      let free = (this.deps.maxRunning ?? MAX_RUNNING_AUDITS) - all.filter((s) => s.audit.status === "running").length;
      for (const s of all.filter((x) => x.audit.status === "queued").sort((a, b) => a.audit.createdAt - b.audit.createdAt)) {
        if (free-- <= 0) break;
        await this.update(s.id, (x) => {
          if (x.audit.status === "queued") x.audit.status = "running";
        });
      }
      for (const s of await this.deps.store.list()) {
        if (s.audit.status !== "running") continue;
        try {
          await this.advance(s);
        } catch (err) {
          this.log(`audits: ${s.id} failed to advance (${err instanceof Error ? err.message : "error"})`);
        }
      }
    } catch (err) {
      this.log(`audits: tick failed (${err instanceof Error ? err.message : "error"})`);
    }
  }

  /** Resolves when every step under way has saved its outcome (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight.values()]);
  }

  private async advance(s: StoredAudit): Promise<void> {
    const a = s.audit;
    const failed = a.steps.find((st) => CRITICAL.has(st.id) && st.status === "failed");
    if (failed) {
      await this.update(s.id, (x) => {
        x.audit.status = "failed";
        x.audit.error = failed.note ?? `${failed.id} failed`;
      });
      return;
    }
    if (a.steps.every((st) => FINISHED.has(st.status))) {
      await this.update(s.id, (x) => (x.audit.status = "done"));
      return;
    }
    this.budget.open(s.id, a.costUsd ?? 0);
    for (const st of a.steps) {
      const key = `${s.id}:${st.id}`;
      if (this.inflight.has(key)) continue;
      if (st.id === "analysis" && st.status === "running" && s.analysisTask?.taskId) {
        this.background(key, async () => {
          const outcome = await checkAnalysis(s, this.context(s.id));
          if (!outcome) return false;
          await this.finish(s.id, "analysis", outcome);
          return true;
        });
        continue;
      }
      // "running" with nothing in flight: the server restarted mid-step, so it runs again.
      const ready = NEEDS[st.id].every((dep) => FINISHED.has(step(a, dep).status));
      if ((st.status === "pending" || st.status === "running") && ready) this.launch(s.id, st.id);
    }
  }

  private launch(id: string, stepId: AuditStepId): void {
    this.background(`${id}:${stepId}`, async () => {
      const started = await this.update(id, (x) => {
        if (x.audit.status !== "running") return;
        Object.assign(step(x.audit, stepId), { status: "running", startedAt: this.now() } satisfies Partial<AuditStep>);
        delete step(x.audit, stepId).note;
      });
      if (started.audit.status !== "running") return false;
      let outcome: Outcome;
      try {
        outcome = await runStep(stepId, started, this.context(id));
      } catch (err) {
        const message = err instanceof Error ? err.message : "failed";
        this.log(`audits: ${id} ${stepId} failed (${message})`);
        outcome = { status: "failed", note: message.slice(0, 200), costUsd: (err as { costUsd?: number }).costUsd };
      }
      await this.finish(id, stepId, outcome);
      return true;
    });
  }

  /** Runs work in the background under a key, once at a time per key; progress (true) kicks the next tick. */
  private background(key: string, work: () => Promise<boolean>): void {
    if (this.inflight.has(key)) return;
    const run = work()
      .catch((err: unknown) => {
        this.log(`audits: ${key} (${err instanceof Error ? err.message : "error"})`);
        return false;
      })
      .then((progressed) => {
        this.inflight.delete(key);
        if (progressed) void this.tick();
      });
    this.inflight.set(key, run);
  }

  private async finish(id: string, stepId: AuditStepId, outcome: Outcome): Promise<void> {
    await this.update(id, (x) => {
      const st = step(x.audit, stepId);
      st.status = outcome.status;
      st.note = outcome.note;
      if (outcome.costUsd) st.costUsd = round((st.costUsd ?? 0) + outcome.costUsd);
      if (outcome.status !== "running") st.finishedAt = this.now();
      outcome.patch?.(x);
    });
  }

  private context(id: string): StepContext {
    const { hermes, crm, pdf, notion, root } = this.deps;
    return {
      budget: this.budget,
      hermes,
      crm,
      pdf,
      notion,
      root,
      publicBase: this.deps.publicBase ?? DEFAULT_PUBLIC_BASE,
      now: this.now,
      log: this.log,
      save: (patch) => this.update(id, patch),
    };
  }

  /** Serialized read-modify-write of one audit; keeps updatedAt and the total cost current. */
  private update(id: string, change: (s: StoredAudit) => void): Promise<StoredAudit> {
    const run = (this.locks.get(id) ?? Promise.resolve()).then(async () => {
      const s = await this.load(id);
      change(s);
      s.audit.costUsd = round(s.audit.steps.reduce((n, st) => n + (st.costUsd ?? 0), 0));
      s.audit.updatedAt = this.now();
      await this.deps.store.put(s);
      return s;
    });
    this.locks.set(id, run.catch(() => undefined));
    return run;
  }

  private async load(id: string): Promise<StoredAudit> {
    const s = await this.deps.store.get(id);
    if (!s) throw new HttpError(404, `audit ${id} not found`);
    return s;
  }

  private async ensureNoOpenAudit(p: ProspectAudit["prospect"], except?: string): Promise<void> {
    const host = siteHost(p.website);
    const clash = (await this.deps.store.list()).find(
      (s) =>
        s.id !== except &&
        OPEN.has(s.audit.status) &&
        ((p.leadId && s.audit.prospect.leadId === p.leadId) ||
          (p.companyId && s.audit.prospect.companyId === p.companyId) ||
          siteHost(s.audit.prospect.website) === host),
    );
    if (clash) throw new HttpError(409, `${p.name} already has an audit under way (${clash.id})`);
  }
}
