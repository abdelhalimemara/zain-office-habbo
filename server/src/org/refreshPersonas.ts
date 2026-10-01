import { CEO_PROFILE, ROSTER } from "../../../shared/roster";
import { HermesError, type HermesClient } from "../hermes/client";
import { fullRoster, type HireStore } from "./hireStore";
import { profileDescription, soulText } from "./persona";
import type { BriefReader } from "./privateBriefs";
import type { Log } from "./reconcile";

export interface RefreshOptions {
  hermes: HermesClient;
  hires: HireStore;
  apply: boolean;
  briefs: BriefReader;
  log?: Log;
}

function reason(err: unknown): string {
  if (err instanceof HermesError) return err.detail;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Re-writes SOUL and description of every hired ROSTER agent from the current persona code, so
 * protocol changes reach agents hired earlier. Never creates profiles, installs skills or touches
 * the CEO. Returns the number of profiles that failed.
 */
export async function refreshPersonas({ hermes, hires, apply, briefs, log = console.log }: RefreshOptions): Promise<number> {
  const existing = new Set((await hermes.listProfiles()).map((p) => p.name));
  const roster = await fullRoster(hires);
  let failed = 0;
  for (const agent of ROSTER) {
    if (agent.profile === CEO_PROFILE) continue;
    if (!existing.has(agent.profile)) {
      log(`skip ${agent.profile} (not hired)`);
      continue;
    }
    if (!apply) {
      log(`would refresh ${agent.profile} (${agent.title}): SOUL + description`);
      continue;
    }
    try {
      await hermes.writeSoul(agent.profile, await soulText(agent, roster, briefs));
      await hermes.setDescription(agent.profile, profileDescription(agent));
      log(`refreshed ${agent.profile}`);
    } catch (err) {
      failed++;
      log(`FAILED ${agent.profile}: ${reason(err)}`);
    }
  }
  return failed;
}
