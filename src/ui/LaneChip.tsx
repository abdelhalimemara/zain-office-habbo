import type { TaskStatus } from "@shared/hermes";
import { LANES, type LaneId } from "./lanes";

/** Kanban lane for a raw status; a non-mandate in `review` waits on a human, so it reads as blocked. */
export function laneForStatus(status: TaskStatus, mandate: boolean): LaneId | "archived" {
  if (status === "archived") return "archived";
  if (status === "review" && !mandate) return "blocked";
  return LANES.find((l) => l.statuses.includes(status))?.id ?? "inbox";
}

export function LaneChip({ status, mandate }: { status: TaskStatus; mandate: boolean }) {
  const lane = laneForStatus(status, mandate);
  const label = lane === "archived" ? "Archived" : LANES.find((l) => l.id === lane)!.label;
  return (
    <span className={`zui-lane-chip zui-lane-chip--${lane}`} title={`Hermes status: ${status}`}>
      {label}
    </span>
  );
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className="zui-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <span className="zui-progress__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}
