import type { RosterResponse } from "../../../shared/api";
import type { HermesProfile } from "../../../shared/hermes";
import { isExternal, type RosterAgent } from "../../../shared/roster";

/** An external agent has no Hermes profile to look up: it is always on staff, working its kanban lane. */
export function mergeRoster(roster: readonly RosterAgent[], profiles: readonly HermesProfile[]): RosterResponse {
  const byName = new Map(profiles.map((p) => [p.name, p]));
  return {
    agents: roster.map((agent) => {
      const profile = byName.get(agent.profile);
      if (isExternal(agent)) return { ...agent, hired: true, model: null };
      return { ...agent, hired: Boolean(profile), model: profile?.model ?? null };
    }),
  };
}
