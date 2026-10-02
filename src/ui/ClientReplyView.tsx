import type { RosterEntry } from "@shared/api";
import type { KanbanTask } from "@shared/hermes";
import { ChannelLabel } from "./ChannelIcon";
import { ClientReplyActions } from "./ClientReplyActions";
import { parseClientReply } from "./clientReply";
import { agentLabel } from "./common";
import { Portrait } from "./Portrait";

const MISSING = "—";

export function firstName(agent: { name?: string; title: string } | undefined): string {
  return agent?.name?.split(/\s+/)[0] ?? agent?.title ?? "the agent";
}

/** Client, channel, the client's words, why HQ must decide, and the approve/send-back controls. */
export function ClientReplyView({ task, agents }: { task: KanbanTask; agents: readonly RosterEntry[] }) {
  const details = parseClientReply(task);
  const agent = agents.find((a) => a.profile === task.assignee);
  const name = agent ? agentLabel(agent) : (task.assignee ?? MISSING);
  return (
    <div className="zui-client-reply">
      <div className="zui-client-reply__meta">
        <span className="zui-client-reply__client">{details.client ?? MISSING}</span>
        <ChannelLabel channel={details.channel} />
        <span className="zui-person">
          <Portrait agent={agent} name={name} vacant={agent ? !agent.hired : false} />
          <span className="zui-person__name">{name}</span>
        </span>
      </div>
      <h4 className="zui-client-reply__label">Client's message</h4>
      <blockquote className="zui-client-reply__quote" dir="auto">{details.message ?? MISSING}</blockquote>
      <h4 className="zui-client-reply__label">Why approval</h4>
      <p className="zui-client-reply__reason" dir="auto">{details.reason ?? MISSING}</p>
      <ClientReplyActions taskId={task.id} details={details} agentName={firstName(agent)} />
    </div>
  );
}
