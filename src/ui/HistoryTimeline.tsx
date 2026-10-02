import type { RosterEntry, TaskHistoryEntry, TaskHistoryKind } from "@shared/api";
import { useUiStore } from "../state/store";
import { agentLabel } from "./common";
import { absoluteTime, relativeTime } from "./mandates";
import { Portrait } from "./Portrait";

export const HISTORY_KINDS: Record<TaskHistoryKind, { label: string; icon: string }> = {
  created: { label: "Created", icon: "✦" },
  started: { label: "Started", icon: "▶" },
  "subtask-linked": { label: "Subtask linked", icon: "⤷" },
  blocked: { label: "Blocked", icon: "‖" },
  unblocked: { label: "Unblocked", icon: "↻" },
  "review-requested": { label: "Sent to HQ for review", icon: "⚑" },
  "sent-back": { label: "Sent back", icon: "↩" },
  completed: { label: "Completed", icon: "✓" },
  commented: { label: "Comment", icon: "✎" },
  status: { label: "Status changed", icon: "•" },
};

/** Author the server stamps on actions taken from this UI. */
const UI_AUTHOR = "zain-hq-ui";

interface Props {
  entries: readonly TaskHistoryEntry[];
  agents: readonly RosterEntry[];
  now?: number;
}

export function HistoryTimeline({ entries, agents, now = Date.now() / 1000 }: Props) {
  const openPanel = useUiStore((s) => s.openPanel);
  if (entries.length === 0) return <p className="zui-hint">No history recorded for this task yet.</p>;
  const sorted = [...entries].sort((a, b) => a.at - b.at || a.id - b.id);
  return (
    <ol className="zui-history" aria-label="History">
      {sorted.map((e) => {
        const kind = HISTORY_KINDS[e.kind] ?? HISTORY_KINDS.status;
        const agent = e.actor ? agents.find((a) => a.profile === e.actor) : undefined;
        const actorName = agent ? agentLabel(agent) : e.actor === UI_AUTHOR ? "HQ (you)" : e.actor;
        return (
          <li key={e.id} className={`zui-history__item zui-history__item--${e.kind}`}>
            <span className="zui-history__icon" aria-hidden="true">
              {kind.icon}
            </span>
            <div className="zui-history__body">
              <div className="zui-history__head">
                <span className="zui-history__kind">{kind.label}</span>
                {actorName && (
                  <span className="zui-person">
                    <Portrait agent={agent} name={actorName} vacant={agent ? !agent.hired : false} />
                    <span className="zui-person__name">{actorName}</span>
                  </span>
                )}
                <time className="zui-history__time" dateTime={new Date(e.at * 1000).toISOString()} title={absoluteTime(e.at)}>
                  {relativeTime(e.at, now)}
                </time>
              </div>
              {e.text && <p className="zui-history__text">{e.text}</p>}
              {e.relatedTaskId && (
                <button type="button" className="zui-link zui-history__related" onClick={() => openPanel({ kind: "task", id: e.relatedTaskId! })}>
                  Open {e.kind === "subtask-linked" ? "subtask" : "related task"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
