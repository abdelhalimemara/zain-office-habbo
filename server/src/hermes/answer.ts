import type { HermesTaskDetail } from "./client";

/**
 * Where an agent may have left its structured answer when it completed a task, most likely first: `result` (what we
 * ask for), the summary, the metadata of its last run (agents often pass the JSON as kanban_complete(metadata=…)),
 * then comments, newest first.
 */
export function agentAnswers(detail: HermesTaskDetail): string[] {
  const { task } = detail;
  const run = detail.runs?.at(-1);
  const metadata = run?.metadata;
  const fromMetadata = metadata == null ? [] : typeof metadata === "string" ? [metadata] : [JSON.stringify(metadata)];
  return [task.result, task.latest_summary, run?.summary, ...fromMetadata, ...[...(detail.comments ?? [])].reverse().map((c) => c.body)]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "");
}
