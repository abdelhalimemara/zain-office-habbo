import type { RosterEntry } from "@shared/api";
import { getDivision, type DivisionId } from "@shared/divisions";
import { isMandate, type AgentActivity } from "@shared/flow";
import type { KanbanTask } from "@shared/hermes";
import { managerOf, ROSTER, type RosterAgent } from "@shared/roster";
import { useRoster } from "../api/hooks";
import type { AvatarSize } from "./Avatar";
import { Portrait } from "./Portrait";

export function useRosterAgents(): { agents: RosterEntry[]; loaded: boolean } {
  const { data } = useRoster();
  if (data) return { agents: data.agents, loaded: true };
  return { agents: ROSTER.map((a) => ({ ...a, hired: false, model: null })), loaded: false };
}

/** How an agent is named in the UI: their personal name when they have one, else their seat. */
export function agentLabel(agent: Pick<RosterAgent, "name" | "title">): string {
  return agent.name ?? agent.title;
}

/** The VP's title when `task` is a mandate, else undefined. */
export function mandateVpTitle(task: KanbanTask, agents: readonly RosterEntry[]): string | undefined {
  if (!isMandate(task, agents)) return undefined;
  const vp = agents.find((a) => a.profile === task.assignee);
  return (vp ? agentLabel(vp) : task.assignee) ?? undefined;
}

export function divisionManager(division: DivisionId, agents: readonly RosterAgent[]): RosterAgent {
  return agents.some((a) => a.division === division && a.rank === "vp") ? managerOf(division, agents) : managerOf(division);
}

export const ACTIVITY_LABEL: Record<AgentActivity, string> = {
  working: "Working",
  blocked: "Blocked",
  "awaiting-approval": "Awaiting approval",
  queued: "Queued",
  idle: "Idle",
};

export const RANK_LABEL: Record<RosterEntry["rank"], string> = {
  board: "Board",
  ceo: "CEO",
  vp: "VP",
  lead: "Lead",
  specialist: "Specialist",
};

function toSeconds(t: number): number {
  return t > 1e12 ? t / 1000 : t;
}

export function formatAge(createdAt: number, now: number): string {
  const s = Math.max(0, toSeconds(now) - toSeconds(createdAt));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export { Avatar, initials } from "./Avatar";

interface AgentChipProps {
  profile: string | null;
  agents: readonly RosterEntry[];
  size?: AvatarSize;
}

export function AgentChip({ profile, agents, size = "sm" }: AgentChipProps) {
  const { loaded } = useRosterAgents();
  if (!profile) return <span className="zui-person zui-person--muted">Unassigned</span>;
  const agent = agents.find((a) => a.profile === profile);
  const name = agent ? agentLabel(agent) : profile;
  return (
    <span className={`zui-person zui-person--${size}`} title={name === profile ? profile : `${name} (${profile})`}>
      <Portrait
        agent={agent}
        name={name}
        size={size}
        color={agent ? getDivision(agent.division).color : undefined}
        vacant={loaded && agent?.hired === false}
      />
      <span className="zui-person__name">{name}</span>
    </span>
  );
}

export function ActivityBadge({ activity }: { activity: AgentActivity }) {
  return <span className={`zui-activity zui-activity--${activity}`}>{ACTIVITY_LABEL[activity]}</span>;
}

export function Text({ children, className }: { children: string | null | undefined; className?: string }) {
  if (!children) return null;
  return <div className={`zui-text${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="zui-error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
