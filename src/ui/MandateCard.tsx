import type { RosterEntry } from "@shared/api";
import { splitMandateBody } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { useUiStore } from "../state/store";
import { agentLabel } from "./common";
import { LaneChip, ProgressBar } from "./LaneChip";
import { absoluteTime, mandateDivision, mandateMoment, relativeTime } from "./mandates";
import { Portrait } from "./Portrait";

interface Props {
  task: KanbanTask;
  agents: readonly RosterEntry[];
  now: number;
}

export function MandateCard({ task, agents, now }: Props) {
  const openMandate = useUiStore((s) => s.openMandate);
  const division = mandateDivision(task, agents);
  const vp = agents.find((a) => a.profile === task.assignee);
  const vpTitle = vp ? agentLabel(vp) : (task.assignee ?? "Unassigned");
  const brief = task.body ? splitMandateBody(task.body).brief : "";
  const progress = task.dependencyProgress;
  const moment = mandateMoment(task);

  return (
    <li>
      <button
        type="button"
        className="zui-mandate"
        onClick={() => division && openMandate(task.id, division.id)}
        disabled={!division}
      >
        <span className="zui-mandate__top">
          <LaneChip status={task.status} hqDecision />
          <span className="zui-mandate__time" title={`${moment.verb} ${absoluteTime(moment.at)}`}>
            {relativeTime(moment.at, now)}
          </span>
        </span>
        <span className="zui-mandate__title">{task.title}</span>
        {brief && <span className="zui-mandate__brief">{brief}</span>}
        <span className="zui-mandate__who">
          <Portrait agent={vp} name={vpTitle} vacant={vp ? !vp.hired : false} />
          <span className="zui-mandate__vp">{vpTitle}</span>
          {division && (
            <span className="zui-mandate__division">
              <span className="zui-dot-mark" style={{ background: division.color }} aria-hidden="true" />
              {division.name}
            </span>
          )}
        </span>
        <span className="zui-mandate__subtasks">
          {progress && progress.total > 0 ? (
            <>
              <span>
                {progress.done}/{progress.total} subtasks
              </span>
              <ProgressBar done={progress.done} total={progress.total} label={`${task.title} subtasks`} />
            </>
          ) : (
            <span className="zui-mandate__none">No subtasks yet</span>
          )}
        </span>
      </button>
    </li>
  );
}
