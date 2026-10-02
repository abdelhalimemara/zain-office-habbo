import { useId, useState } from "react";
import type { RosterEntry } from "@shared/api";
import { getDivision, type DivisionId } from "@shared/divisions";
import type { KanbanTask } from "@shared/hermes";
import { ACTION_DETAIL_MAX, ACTION_TITLE_MAX, type ActionPriority } from "@shared/leadership";
import { useUiStore } from "../state/store";
import { DIVISION_HEAD, DIVISION_OPTIONS, PRIORITIES, seatLabel, type DraftAction, type RowErrors } from "./leadershipModel";
import { Portrait } from "./Portrait";

function Owner({ division, agents }: { division: DivisionId; agents: readonly RosterEntry[] }) {
  const head = DIVISION_HEAD[division];
  return <Portrait agent={agents.find((a) => a.profile === head)} name={seatLabel(head, agents)} size="md" color={getDivision(division).color} labelled={false} />;
}

export function PriorityChip({ priority }: { priority: ActionPriority }) {
  return <span className={`zui-prio zui-prio--${priority}`}>{priority}</span>;
}

/** "Assigned · t_1234" linking to the mandate, with its kanban status when the board knows it. */
export function AssignedLink({ taskId, task }: { taskId: string; task?: KanbanTask }) {
  const openPanel = useUiStore((s) => s.openPanel);
  return (
    <span className="zui-action__assigned">
      <span className="zui-action__assigned-label">Assigned ·</span>{" "}
      <button type="button" className="zui-link zui-mono" onClick={() => openPanel({ kind: "task", id: taskId })} aria-label={`Open task ${taskId}`}>
        {taskId}
      </button>
      {task && <span className={`zui-status-pill zui-status-pill--${task.status}`}>{task.status}</span>}
    </span>
  );
}

/** An assigned action, read-only. */
export function ActionSummary({ row, agents, task }: { row: DraftAction; agents: readonly RosterEntry[]; task?: KanbanTask }) {
  const division = DIVISION_OPTIONS.find((d) => d.id === row.division)?.label ?? row.division;
  return (
    <li className="zui-action zui-action--done">
      <Owner division={row.division} agents={agents} />
      <div className="zui-action__body">
        <div className="zui-action__head">
          <PriorityChip priority={row.priority} />
          <span className="zui-action__division">{division}</span>
          {row.due && <span className="zui-hint">Due {row.due}</span>}
        </div>
        <p className="zui-action__title" dir="auto">
          {row.title}
        </p>
        {row.detail && (
          <p className="zui-action__detail" dir="auto">
            {row.detail}
          </p>
        )}
        {row.taskId ? <AssignedLink taskId={row.taskId} task={task} /> : <span className="zui-hint">Not assigned</span>}
      </div>
    </li>
  );
}

interface RowProps {
  row: DraftAction;
  index: number;
  agents: readonly RosterEntry[];
  errors?: RowErrors;
  /** Why the last assign failed for this row. */
  failure?: string;
  disabled: boolean;
  onChange: (patch: Partial<DraftAction>) => void;
  onRemove: () => void;
  onRetry: () => void;
}

/** One editable action: owner, division, title, priority, due date, and an expandable detail. */
export function ActionRow({ row, index, agents, errors, failure, disabled, onChange, onRemove, onRetry }: RowProps) {
  const n = index + 1;
  const [open, setOpen] = useState(!row.title || Boolean(errors?.detail));
  const ids = { detail: useId(), title: useId() };
  const showDetail = open || Boolean(errors?.detail);
  return (
    <li className={`zui-action zui-action--${row.priority}${failure ? " zui-action--failed" : ""}`} aria-label={`Action ${n}`}>
      <Owner division={row.division} agents={agents} />
      <div className="zui-action__body">
        <div className="zui-action__head">
          <select
            className="zui-input zui-action__division-select"
            aria-label={`Division, action ${n}`}
            value={row.division}
            disabled={disabled}
            onChange={(e) => onChange({ division: e.target.value as DivisionId })}
          >
            {DIVISION_OPTIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <div className="zui-prio-seg" role="radiogroup" aria-label={`Priority, action ${n}`}>
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={row.priority === p}
                className={`zui-prio-seg__opt zui-prio-seg__opt--${p}`}
                disabled={disabled}
                onClick={() => onChange({ priority: p })}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            type="date"
            className="zui-input zui-action__due"
            aria-label={`Due date, action ${n}`}
            value={row.due}
            disabled={disabled}
            onChange={(e) => onChange({ due: e.target.value })}
            aria-invalid={errors?.due ? true : undefined}
          />
          <button type="button" className="zui-btn zui-btn--icon zui-action__remove" aria-label={`Remove action ${n}`} disabled={disabled} onClick={onRemove}>
            ×
          </button>
        </div>
        <input
          id={ids.title}
          className="zui-input zui-action__title-input"
          aria-label={`Title, action ${n}`}
          placeholder="What has to happen"
          maxLength={ACTION_TITLE_MAX + 50}
          value={row.title}
          disabled={disabled}
          dir="auto"
          onChange={(e) => onChange({ title: e.target.value })}
          aria-invalid={errors?.title ? true : undefined}
        />
        {errors?.title && <p className="zui-error">{errors.title}</p>}
        {errors?.due && <p className="zui-error">{errors.due}</p>}
        <button type="button" className="zui-link zui-action__toggle" aria-expanded={showDetail} aria-controls={ids.detail} onClick={() => setOpen(!showDetail)}>
          {showDetail ? "Hide detail" : row.detail ? "Show detail" : "Add detail"}
        </button>
        {showDetail && (
          <textarea
            id={ids.detail}
            className="zui-input zui-action__detail-input"
            aria-label={`Detail, action ${n}`}
            rows={3}
            placeholder="What done looks like, context from the meeting, constraints"
            value={row.detail}
            disabled={disabled}
            dir="auto"
            onChange={(e) => onChange({ detail: e.target.value })}
            aria-invalid={errors?.detail ? true : undefined}
          />
        )}
        {errors?.detail && <p className="zui-error">{errors.detail}</p>}
        {row.detail.length > ACTION_DETAIL_MAX * 0.9 && !errors?.detail && (
          <p className="zui-hint">
            {row.detail.length}/{ACTION_DETAIL_MAX}
          </p>
        )}
        {failure && (
          <div className="zui-action__failure" role="alert">
            <span>Couldn't assign: {failure}</span>
            <button type="button" className="zui-btn" disabled={disabled} onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
