import type { AuditRequest, AuditRequestResponse } from "../../../../shared/audits";
import { optionalString } from "../../http";
import type { CeoWake } from "../../telegram/ceoWake";
import { AUDIT_AGENT } from "./analysis";
import type { AuditCrm } from "./crm";
import { parseStartAudit } from "./routes";
import type { AuditHermes } from "./steps";
import { dnsResolver, siteHost, validateWebsite, type Resolver } from "./url";

export const REQUEST_TITLE_PREFIX = "Prospect audit: ";
export const REQUEST_SKILL = "run-prospect-audit";
const GROWTH_TENANT = "zain-growth";
export const REQUEST_MARKER_PREFIX = "<!-- zain-audit-request:";
export const requestMarker = (key: string) => `${REQUEST_MARKER_PREFIX}${key} -->`;

/** An AuditRequest: StartAuditRequest's fields (no parentTaskId: the task created here becomes the parent) plus notes. */
export function parseAuditRequest(body: Record<string, unknown>): AuditRequest {
  const { parentTaskId: _ignored, ...start } = parseStartAudit({ ...body, parentTaskId: undefined });
  const notes = optionalString(body, "notes", 4000);
  return { ...start, ...(notes ? { notes } : {}) };
}

export interface AuditRequestDeps {
  hermes: Pick<AuditHermes, "createTask">;
  ceoWake: Pick<CeoWake, "subscribe">;
  crm: Pick<AuditCrm, "prospect">;
  resolve?: Resolver;
  log?: (line: string) => void;
}

/** The task Rami picks up: what to audit, as the exact JSON to POST, and the requester's notes. */
export function requestTaskBody(req: AuditRequest, name: string): string {
  const { notes, ...start } = req;
  return [
    `Run a Zain Growth Digital Gap Audit of ${name} with your ${REQUEST_SKILL} skill.`,
    "",
    "Start it with this request body, adding \"parentTaskId\" = this task's id, so the result is commented here and this task is unblocked:",
    "```json",
    JSON.stringify(start, null, 2),
    "```",
    ...(notes ? ["", "Notes from the requester:", notes] : []),
    "",
    "When you complete this task, end your summary with the PDF's absolute path on its own line (Susu attaches it in Telegram).",
    "",
    requestMarker(start.leadId ?? start.companyId ?? (start.website ? siteHost(start.website) : name)),
  ].join("\n");
}

/**
 * Asks Rami (zain-growth-audit) for an audit: a kanban task in Zain Growth, not an HQ mandate (he is a
 * specialist, so it never reaches the approvals inbox), with the CEO agent's wake subscribed so Susu
 * hears back when Rami completes it.
 */
export async function createAuditRequest(req: AuditRequest, deps: AuditRequestDeps): Promise<AuditRequestResponse> {
  // Checked now, so Rami never gets a task for a URL the audit would refuse.
  const website = req.website ? await validateWebsite(req.website, deps.resolve ?? dnsResolver) : undefined;
  const record = !req.name && req.leadId ? await deps.crm.prospect("lead", req.leadId) : !req.name && req.companyId ? await deps.crm.prospect("company", req.companyId) : null;
  const name = req.name ?? record?.prospect.name ?? siteHost(website ?? "");
  const request: AuditRequest = { ...req, ...(website ? { website } : {}) };
  const task = await deps.hermes.createTask({
    title: `${REQUEST_TITLE_PREFIX}${name}`,
    body: requestTaskBody(request, name),
    assignee: AUDIT_AGENT,
    tenant: GROWTH_TENANT,
    triage: false,
  });
  const wake = await deps.ceoWake.subscribe(task.id);
  if (!wake.subscribed) deps.log?.(`audits: request ${task.id} will not wake the CEO (${wake.reason ?? "unknown"})`);
  return { taskId: task.id, assignee: AUDIT_AGENT };
}
