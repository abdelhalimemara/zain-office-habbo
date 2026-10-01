import type { RosterResponse } from "../../../shared/api";
import type { HermesProfile } from "../../../shared/hermes";
import type { RosterAgent } from "../../../shared/roster";

export function mergeRoster(roster: readonly RosterAgent[], profiles: readonly HermesProfile[]): RosterResponse {
  const byName = new Map(profiles.map((p) => [p.name, p]));
  return {
    agents: roster.map((agent) => {
      const profile = byName.get(agent.profile);
      return { ...agent, hired: Boolean(profile), model: profile?.model ?? null };
    }),
  };
}
