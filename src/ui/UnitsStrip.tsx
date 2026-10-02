import type { RosterEntry } from "@shared/api";
import type { DivisionId } from "@shared/divisions";
import type { KanbanTask } from "@shared/hermes";
import { unitsOf } from "@shared/units";
import { AgentChip } from "./common";

interface Props {
  division: DivisionId;
  agents: readonly RosterEntry[];
  /** The division's tasks, for each unit's count of open work. */
  tasks: readonly KanbanTask[];
}

/** Studio / Growth units on the kanban: who sits in each and how much open work they hold. */
export function UnitsStrip({ division, agents, tasks }: Props) {
  const units = unitsOf(division);
  if (!units.length) return null;
  return (
    <section className="zui-units" aria-label="Units">
      {units.map((u) => {
        const members = agents.filter((a) => a.division === division && a.unit === u.id);
        const profiles = new Set(members.map((m) => m.profile));
        const open = tasks.filter((t) => t.assignee && profiles.has(t.assignee) && t.status !== "done" && t.status !== "archived").length;
        return (
          <div key={u.id} className="zui-unit" aria-label={`${u.name} unit`}>
            <h3 className="zui-unit__name" title={u.summary}>
              {u.name} <span className="zui-count" title="Open tasks">{open}</span>
            </h3>
            <ul className="zui-chips">
              {members.map((m) => (
                <li key={m.profile}>
                  <AgentChip profile={m.profile} agents={agents} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
