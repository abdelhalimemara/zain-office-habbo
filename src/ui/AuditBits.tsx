import type { AuditStatus, AuditStep, Grade } from "@shared/audits";
import { GRADE_HINT, orderedSteps, STATUS_LABEL, stepsFinished, stepTooltip } from "./auditModel";

export function AuditStatusChip({ status }: { status: AuditStatus }) {
  return <span className={`zui-audit-status zui-audit-status--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function GradeBadge({ grade, score, size = "sm" }: { grade: Grade; score?: number; size?: "sm" | "lg" }) {
  const label = `Grade ${grade}, ${GRADE_HINT[grade].toLowerCase()}${score !== undefined ? `, score ${score} of 100` : ""}`;
  return (
    <span className={`zui-grade zui-grade--${grade} zui-grade--${size}`} role="img" aria-label={label} title={label}>
      {grade}
    </span>
  );
}

/** Nine small dots, one per pipeline step, each with its status and note as a tooltip. */
export function StepDots({ steps }: { steps: readonly AuditStep[] }) {
  const all = orderedSteps(steps);
  return (
    <ol className="zui-step-dots" aria-label={`Progress: ${stepsFinished(steps)} of ${all.length} steps`}>
      {all.map((s) => {
        const tip = stepTooltip(s);
        return (
          <li key={s.id} className={`zui-step-dot zui-step-dot--${s.status}`} title={tip}>
            <span className="zui-sr-only">{tip}</span>
          </li>
        );
      })}
    </ol>
  );
}

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The overall score as a ring filled to the score, coloured by grade. */
export function ScoreDial({ score, grade }: { score: number; grade: Grade }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className={`zui-dial zui-dial--${grade}`} role="img" aria-label={`Overall score ${clamped} of 100, grade ${grade}`}>
      <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
        <circle className="zui-dial__track" cx="40" cy="40" r={RADIUS} />
        <circle
          className="zui-dial__fill"
          cx="40"
          cy="40"
          r={RADIUS}
          strokeDasharray={`${(clamped / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <span className="zui-dial__value" aria-hidden="true">
        {Math.round(clamped)}
      </span>
    </div>
  );
}
