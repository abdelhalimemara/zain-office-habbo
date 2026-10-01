import { getDivision } from "@shared/divisions";
import { agentActivity } from "@shared/flow";
import { useBoard } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ActivityBadge, RANK_LABEL, useRosterAgents } from "./common";
import { Panel } from "./Panel";

export function AgentCard({ profile }: { profile: string }) {
  const { agents, loaded } = useRosterAgents();
  const board = useBoard();
  const openPanel = useUiStore((s) => s.openPanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const agent = agents.find((a) => a.profile === profile);

  if (!agent) {
    return (
      <Panel title={profile} onClose={closePanel}>
        <p className="zui-hint">{loaded ? "This profile is not on the Zain roster." : "Loading roster…"}</p>
      </Panel>
    );
  }

  const d = getDivision(agent.division);
  const boss = agent.reportsTo ? agents.find((a) => a.profile === agent.reportsTo) : undefined;
  const current = board.data ? agentActivity(profile, board.data) : null;
  const vacant = loaded && !agent.hired;

  return (
    <Panel title={agent.title} accent={d.color} onClose={closePanel}>
      <dl className="zui-facts">
        <dt>Profile</dt>
        <dd className="zui-mono">{agent.profile}</dd>
        <dt>Division</dt>
        <dd>{d.name}</dd>
        <dt>Rank</dt>
        <dd>{RANK_LABEL[agent.rank]}</dd>
        <dt>Reports to</dt>
        <dd>{agent.reportsTo ? (boss?.title ?? agent.reportsTo) : "The user (Telegram)"}</dd>
        <dt>Status</dt>
        <dd>
          {!loaded ? "…" : vacant ? <span className="zui-badge zui-badge--vacant">Vacant</span> : <span className="zui-badge zui-badge--hired">Hired</span>}
          {agent.model && <span className="zui-mono"> {agent.model}</span>}
        </dd>
        {current && !vacant && (
          <>
            <dt>Activity</dt>
            <dd>
              <ActivityBadge activity={current.activity} />
              {current.task && (
                <button type="button" className="zui-link" onClick={() => openPanel({ kind: "task", id: current.task!.id })}>
                  {current.task.title}
                </button>
              )}
            </dd>
          </>
        )}
      </dl>
      <h3 className="zui-subheading">Skills</h3>
      <ul className="zui-chips">
        {agent.skills.map((s) => (
          <li key={s} className="zui-chip" style={{ borderColor: d.color }}>
            {s}
          </li>
        ))}
      </ul>
      <div className="zui-row">
        {agent.rank === "vp" && (
          <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "kanban", division: agent.division })}>
            Open kanban
          </button>
        )}
        {vacant && (
          <button
            type="button"
            className="zui-btn zui-btn--primary"
            onClick={() =>
              openPanel({
                kind: "hire",
                division: agent.division,
                prefill: { profile: agent.profile, title: agent.title, rank: agent.rank, reportsTo: agent.reportsTo, skills: agent.skills },
              })
            }
          >
            Hire
          </button>
        )}
      </div>
    </Panel>
  );
}
