import { useId, useState } from "react";
import type { RosterEntry } from "@shared/api";
import { getDivision, type DivisionId } from "@shared/divisions";
import { agentActivity, tasksForTenant } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { useBoard } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ActivityBadge, divisionManager, ErrorNote, useRosterAgents } from "./common";
import { DONE_PREVIEW, LANES, defaultLane, groupByLane, type Lane, type LaneId } from "./lanes";
import { Panel } from "./Panel";
import { Portrait } from "./Portrait";
import { TaskCard } from "./TaskCard";
import { useMediaQuery } from "./useMediaQuery";

export const PHONE_QUERY = "(max-width: 699px)";

interface LaneListProps {
  lane: Lane;
  tasks: KanbanTask[];
  agents: readonly RosterEntry[];
  now: number;
}

function LaneList({ lane, tasks, agents, now }: LaneListProps) {
  const openPanel = useUiStore((s) => s.openPanel);
  const [showAll, setShowAll] = useState(false);
  const limited = lane.id === "done" && !showAll && tasks.length > DONE_PREVIEW;
  const shown = limited ? tasks.slice(0, DONE_PREVIEW) : tasks;
  return (
    <>
      <ul className="zui-column__list">
        {shown.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            agents={agents}
            now={now}
            statusTag={lane.statuses.length > 1 || !lane.statuses.includes(t.status) ? t.status : undefined}
            onOpen={(id) => openPanel({ kind: "task", id })}
          />
        ))}
      </ul>
      {limited && (
        <button type="button" className="zui-link zui-lane__more" onClick={() => setShowAll(true)}>
          Show all {tasks.length}
        </button>
      )}
    </>
  );
}

function laneClass(lane: Lane, collapsed: boolean): string {
  return ["zui-lane", lane.id === "awaiting" && "zui-lane--hq", collapsed && "zui-lane--collapsed"].filter(Boolean).join(" ");
}

function LaneTabs({ groups, ...rest }: { groups: Record<LaneId, KanbanTask[]>; agents: readonly RosterEntry[]; now: number }) {
  const [chosen, setChosen] = useState<LaneId | null>(null);
  const active = chosen ?? defaultLane(groups);
  const base = useId();
  const lane = LANES.find((l) => l.id === active)!;
  return (
    <div className="zui-lane-tabs">
      <div role="tablist" aria-label="Lanes" className="zui-lane-tabs__list">
        {LANES.map((l) => (
          <button
            key={l.id}
            type="button"
            role="tab"
            id={`${base}-${l.id}`}
            aria-selected={l.id === active}
            aria-controls={`${base}-panel`}
            className={`zui-lane-tab${l.id === "awaiting" ? " zui-lane-tab--hq" : ""}`}
            onClick={() => setChosen(l.id)}
          >
            {l.label} <span className="zui-count">{groups[l.id].length}</span>
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${active}`} className={laneClass(lane, false)}>
        {groups[active].length === 0 && <p className="zui-hint">Nothing here.</p>}
        <LaneList key={active} lane={lane} tasks={groups[active]} {...rest} />
      </section>
    </div>
  );
}

export function KanbanPanel({ division }: { division: DivisionId }) {
  const d = getDivision(division);
  const board = useBoard();
  const { agents, loaded } = useRosterAgents();
  const openPanel = useUiStore((s) => s.openPanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const phone = useMediaQuery(PHONE_QUERY);
  const manager = divisionManager(division, agents);
  const hiredManager = agents.find((a) => a.profile === manager.profile)?.hired ?? false;
  const groups = groupByLane(board.data ? tasksForTenant(board.data, d.tenant) : [], agents);
  const managerActivity = board.data ? agentActivity(manager.profile, board.data).activity : null;
  const now = board.data?.now ?? Date.now() / 1000;

  return (
    <Panel title={`${d.name} · Kanban`} accent={d.color} onClose={closePanel} wide>
      <section className="zui-manager">
        <div className="zui-profile">
          <Portrait agent={manager} name={manager.title} color={d.color} size="md" vacant={loaded && !hiredManager} />
          <div className="zui-profile__text">
            <strong>{manager.title}</strong>
            <span className="zui-mono">{manager.profile}</span>
          </div>
          {managerActivity && <ActivityBadge activity={managerActivity} />}
        </div>
        <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "mandate", division })}>
          New mandate
        </button>
      </section>
      <ErrorNote error={board.error} />
      {board.isPending && <p className="zui-hint">Loading board…</p>}
      {board.data && LANES.every((l) => groups[l.id].length === 0) ? (
        <div className="zui-empty">
          <p>No work in {d.name} yet.</p>
          <p className="zui-hint">
            Send a mandate and {manager.title} will split it across the team, then bring the result back to HQ for approval.
          </p>
        </div>
      ) : phone ? (
        <LaneTabs groups={groups} agents={agents} now={now} />
      ) : (
        <div className="zui-kanban">
          {LANES.map((lane) => {
            const tasks = groups[lane.id];
            return (
              <section key={lane.id} className={laneClass(lane, tasks.length === 0)} aria-label={`${lane.label} (${tasks.length})`}>
                <h3 className="zui-column__title">
                  <span className="zui-lane__label">{lane.label}</span> <span className="zui-count">{tasks.length}</span>
                </h3>
                {tasks.length > 0 && <LaneList lane={lane} tasks={tasks} agents={agents} now={now} />}
              </section>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
