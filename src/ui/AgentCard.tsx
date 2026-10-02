import { findBoardMember } from "@shared/board";
import { getDivision } from "@shared/divisions";
import { agentActivity } from "@shared/flow";
import { SKILL_SOURCES, skillSourceFor } from "@shared/skillSources";
import { useBoard } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ACTIVITY_LABEL, ActivityBadge, Avatar, RANK_LABEL, useRosterAgents } from "./common";
import { Panel } from "./Panel";

/** Headcount skills stay one flat list; skills from a registered source are grouped under it. */
function skillGroups(skills: readonly string[]): { label: string | null; skills: string[] }[] {
  const headcount = skills.filter((s) => !skillSourceFor(s));
  const sources = SKILL_SOURCES.map((src) => ({
    label: `${src.id} · ${src.repo} (${src.license})`,
    skills: skills.filter((s) => skillSourceFor(s) === src),
  })).filter((g) => g.skills.length > 0);
  return [...(headcount.length ? [{ label: null, skills: headcount }] : []), ...sources];
}

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
  const member = agent.rank === "board" ? findBoardMember(agent.profile) : undefined;

  return (
    <Panel title={agent.title} accent={d.color} onClose={closePanel}>
      <div className="zui-profile zui-profile--hero">
        <Avatar name={member?.name ?? agent.title} color={d.color} size="lg" />
        <div className="zui-profile__text">
          <strong>{member?.name ?? agent.title}</strong>
          <span className="zui-hint">
            {RANK_LABEL[agent.rank]} · {d.name}
          </span>
        </div>
        {loaded && <span className={`zui-status-dot zui-status-dot--${vacant ? "vacant" : (current?.activity ?? "idle")}`} title={vacant ? "Vacant" : current ? ACTIVITY_LABEL[current.activity] : "Hired"} />}
      </div>
      <dl className="zui-facts">
        <dt>Profile</dt>
        <dd className="zui-mono">{agent.profile}</dd>
        <dt>Division</dt>
        <dd>{d.name}</dd>
        <dt>Rank</dt>
        <dd>{RANK_LABEL[agent.rank]}</dd>
        {member ? (
          <>
            <dt>Role</dt>
            <dd>Advises the CEO and founder</dd>
            <dt>Seat</dt>
            <dd>{member.seat}</dd>
          </>
        ) : (
          <>
            <dt>Reports to</dt>
            <dd>{agent.reportsTo ? (boss?.title ?? agent.reportsTo) : "The user (Telegram)"}</dd>
          </>
        )}
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
      {member && (
        <>
          <h3 className="zui-subheading">Lens</h3>
          <ul className="zui-lens">
            {member.lens.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      <h3 className="zui-subheading">Skills</h3>
      {skillGroups(agent.skills).map((g) => (
        <section key={g.label ?? "headcount"} aria-label={g.label ? `${g.label} skills` : "Skills"}>
          {g.label && <p className="zui-skill-group">{g.label}</p>}
          <ul className="zui-chips">
            {g.skills.map((s) => (
              <li key={s} className="zui-chip" style={{ borderColor: d.color }}>
                {g.label ? s.split(":")[1] : s}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="zui-row">
        {member && !vacant && (
          <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "board", members: [agent.profile] })}>
            Consult
          </button>
        )}
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
