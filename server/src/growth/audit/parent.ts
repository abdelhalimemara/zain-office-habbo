import { AUDIT_AREA_LABELS, type AuditStatus } from "../../../../shared/audits";
import { gaps } from "./score";
import { pdfFile, publicPdfUrl, type AuditHermes } from "./steps";
import type { StoredAudit } from "./types";

/** Comments on the requesting agent's task are signed by Zain HQ. */
export const AUDIT_AUTHOR = "zain-hq-audits";
const SEVERITY_ORDER = ["critical", "high", "medium", "low"];
/** Outcomes the parent task hears about; anything else is still in progress. */
export const REPORTED: ReadonlySet<AuditStatus> = new Set(["done", "failed", "cancelled"]);

export interface ParentDeps {
  hermes: Pick<AuditHermes, "addComment" | "task" | "updateTask">;
  root: string;
  publicBase: string;
}

/** What Rami reads when his task wakes up: the outcome, the headline numbers, and where everything is. */
export function parentComment(s: StoredAudit, deps: Pick<ParentDeps, "root" | "publicBase">): string {
  const a = s.audit;
  const lines = [`Zain HQ audit ${a.id} for ${a.prospect.name} (${a.prospect.website}): ${a.status.toUpperCase()}.`];
  if (a.status === "failed") lines.push(`Error: ${a.error ?? "unknown"}. Retry once with: curl -s -X POST http://127.0.0.1:8787/api/growth/audits/${a.id}/retry -H 'Content-Type: application/json' -d '{}'`);
  if (a.status === "cancelled") lines.push("The audit was cancelled in Zain HQ.");
  if (a.score) {
    lines.push(`Score: ${a.score.overall}/100, grade ${a.score.grade}; ${a.score.areasMeasured} of 7 areas measured.`);
    const top = gaps(a.score)
      .sort((x, y) => SEVERITY_ORDER.indexOf(x.severity ?? "low") - SEVERITY_ORDER.indexOf(y.severity ?? "low"))
      .slice(0, 3);
    if (top.length) {
      lines.push("Top gaps:");
      top.forEach((g, i) => lines.push(`${i + 1}. ${AUDIT_AREA_LABELS[g.area]} (${g.status}${g.severity ? `, ${g.severity}` : ""}): ${g.summary}`));
    }
  }
  if (a.analysis?.pitchAngle) lines.push(`Pitch angle: ${a.analysis.pitchAngle}`);
  if (a.pdfPath) {
    lines.push(`PDF file: ${pdfFile(deps.root, a.id)}`);
    lines.push(`PDF URL: ${publicPdfUrl(deps.publicBase, a.id)}`);
  }
  if (a.notionPageUrl) lines.push(`Notion: ${a.notionPageUrl}`);
  if (a.crmUrl) lines.push(`CRM: ${a.crmUrl}`);
  lines.push(`Apify spend: $${(a.costUsd ?? 0).toFixed(2)}.`);
  return lines.join("\n");
}

/** Comments the outcome on the parent task, then unblocks it if it is waiting; throws so the caller can retry later. */
export async function reportToParent(s: StoredAudit, deps: ParentDeps): Promise<void> {
  const taskId = s.parent!.taskId;
  await deps.hermes.addComment(taskId, parentComment(s, deps), AUDIT_AUTHOR);
  const { task } = await deps.hermes.task(taskId);
  if (task.status === "blocked") await deps.hermes.updateTask(taskId, { status: "ready" });
}
