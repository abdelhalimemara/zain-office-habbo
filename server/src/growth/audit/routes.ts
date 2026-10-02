import { readFile } from "node:fs/promises";
import type { Hono } from "hono";
import { AUDITS_API, type StartAuditRequest } from "../../../../shared/audits";
import { HttpError, TASK_ID, badRequest, optionalString, readJsonObject } from "../../http";
import type { CeoWake } from "../../telegram/ceoWake";
import { CRM_ID, type AuditCrm } from "./crm";
import { createAuditRequest, parseAuditRequest } from "./requests";
import type { AuditEngine } from "./engine";

const AUDIT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SOCIALS = ["instagram", "tiktok", "facebook", "x", "linkedin"] as const;
/** Agents (curl) mark themselves so the audit records who asked. */
export const REQUESTED_BY_HEADER = "x-zain-requested-by";

export function auditIdParam(id: string | undefined): string {
  if (!id || !AUDIT_ID.test(id)) throw badRequest("invalid audit id");
  return id;
}

function crmId(body: Record<string, unknown>, field: "leadId" | "companyId"): string | undefined {
  const v = optionalString(body, field, 64);
  if (v !== undefined && !CRM_ID.test(v)) throw badRequest(`${field} must be a CRM record id`);
  return v;
}

export function parseStartAudit(body: Record<string, unknown>): StartAuditRequest {
  const req: StartAuditRequest = {};
  const leadId = crmId(body, "leadId");
  const companyId = crmId(body, "companyId");
  const website = optionalString(body, "website", 2048);
  const name = optionalString(body, "name", 200);
  if (leadId) req.leadId = leadId;
  else if (companyId) req.companyId = companyId;
  if (website) req.website = website;
  if (name) req.name = name;
  if (!req.leadId && !req.companyId && !req.website) throw badRequest("give leadId, companyId or website");
  const parent = optionalString(body, "parentTaskId", 64);
  if (parent !== undefined) {
    if (!TASK_ID.test(parent)) throw badRequest("parentTaskId must be a kanban task id");
    req.parentTaskId = parent;
  }
  if (body.socials !== undefined && body.socials !== null) {
    if (typeof body.socials !== "object" || Array.isArray(body.socials)) throw badRequest("socials must be an object");
    const socials = body.socials as Record<string, unknown>;
    const out: NonNullable<StartAuditRequest["socials"]> = {};
    for (const key of SOCIALS) {
      const v = optionalString(socials, key, 300);
      if (v !== undefined) out[key] = v;
    }
    if (Object.keys(out).length) req.socials = out;
  }
  return req;
}

export const PROSPECTS_API = "/api/growth/prospects";
const MAX_QUERY = 80;

/** Prospect audits API (shared/audits.ts AUDITS_API); the Growth agents start audits through it with curl. */
export function auditRoutes(app: Hono, audits: AuditEngine, crm: AuditCrm, ceoWake: Pick<CeoWake, "subscribe">): void {
  // Ask Rami for an audit: a task for zain-growth-audit that wakes the CEO agent when he completes it.
  app.post(AUDITS_API.request, async (c) => {
    const req = parseAuditRequest(await readJsonObject(c));
    return c.json(await createAuditRequest(req, { hermes: audits.hermes, ceoWake, crm, resolve: audits.resolver, log: console.warn }), 201);
  });

  // CRM lookup for the New audit form: read-only, at most ten leads and companies.
  app.get(PROSPECTS_API, async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length > MAX_QUERY) throw badRequest(`q must be at most ${MAX_QUERY} characters`);
    return c.json({ prospects: await crm.search(q) });
  });

  app.get(AUDITS_API.list, async (c) => c.json({ audits: await audits.list() }));

  app.post(AUDITS_API.list, async (c) => {
    const req = parseStartAudit(await readJsonObject(c));
    const by = c.req.header(REQUESTED_BY_HEADER) === "agent" ? "agent" : "hq";
    return c.json({ audit: await audits.start(req, by) }, 201);
  });

  app.get(`${AUDITS_API.list}/:id`, async (c) => c.json({ audit: await audits.get(auditIdParam(c.req.param("id"))) }));

  app.get(`${AUDITS_API.list}/:id/pdf`, async (c) => {
    const id = auditIdParam(c.req.param("id"));
    const audit = await audits.get(id);
    if (!audit.pdfPath) throw new HttpError(404, "the PDF is not ready yet");
    let pdf: Buffer;
    try {
      pdf = await readFile(audits.pdfLocation(id));
    } catch {
      throw new HttpError(404, "the PDF is not ready yet");
    }
    const name = `Zain Growth audit - ${audit.prospect.name}`.replace(/[^\p{L}\p{N} ._-]+/gu, "").slice(0, 100);
    const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${id}.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get(`${AUDITS_API.list}/:id/screenshot`, async (c) => {
    const id = auditIdParam(c.req.param("id"));
    if (!(await audits.get(id)).screenshotPath) throw new HttpError(404, "no mobile capture for this audit");
    let png: Buffer;
    try {
      png = await readFile(audits.screenshotLocation(id));
    } catch {
      throw new HttpError(404, "no mobile capture for this audit");
    }
    return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  });

  app.post(`${AUDITS_API.list}/:id/retry`, async (c) => {
    const id = auditIdParam(c.req.param("id"));
    await readJsonObject(c);
    return c.json({ audit: await audits.retry(id) });
  });

  app.post(`${AUDITS_API.list}/:id/cancel`, async (c) => {
    const id = auditIdParam(c.req.param("id"));
    await readJsonObject(c);
    return c.json({ audit: await audits.cancel(id) });
  });
}
