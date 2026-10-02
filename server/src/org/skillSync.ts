import { CEO_PROFILE } from "../../../shared/roster";
import { HermesError, type HermesClient } from "../hermes/client";
import type { HeadcountSource } from "../headcount/catalog";
import { installSkill, type SkillFileSink } from "../headcount/install";
import { hermesSkillName } from "../headcount/skillFile";
import { fullRoster, type HireStore } from "./hireStore";
import { profileDescription, withMarketingBlock } from "./persona";
import type { Log } from "./reconcile";

export interface ProfilePlan {
  profile: string;
  title: string;
  hired: boolean;
  /** Roster skill ids the profile does not have yet. */
  missing: string[];
  /** The SOUL with the unit / marketing-context block added, when it differs from the current one. */
  soul?: string;
  /** The roster description, when the profile's differs. */
  description?: string;
  /** Hermes could not be read for this profile; nothing is applied to it. */
  error?: string;
}

export interface SkillSyncOptions {
  hermes: HermesClient;
  headcount: HeadcountSource;
  hires: HireStore;
  apply: boolean;
  /** Only this profile. */
  profile?: string;
  files?: SkillFileSink;
  log?: Log;
}

function reason(err: unknown): string {
  if (err instanceof HermesError) return err.detail;
  return err instanceof Error ? err.message : String(err);
}

/**
 * What each roster profile lacks compared with shared/roster.ts: skills (by their Hermes name), the
 * unit and marketing-context block in its SOUL, and its description. Only reads Hermes. The CEO's
 * SOUL and description are hand-kept, so only its skills are compared.
 */
export async function planSkillSync(
  { hermes, hires, profile }: Pick<SkillSyncOptions, "hermes" | "hires" | "profile">,
): Promise<ProfilePlan[]> {
  const roster = await fullRoster(hires);
  const scope = profile ? roster.filter((a) => a.profile === profile) : roster;
  if (profile && !scope.length) throw new Error(`${profile} is not on the roster`);
  const existing = new Map((await hermes.listProfiles()).map((p) => [p.name, p]));
  const plans: ProfilePlan[] = [];
  for (const agent of scope) {
    const live = existing.get(agent.profile);
    if (!live) {
      plans.push({ profile: agent.profile, title: agent.title, hired: false, missing: [...agent.skills] });
      continue;
    }
    const plan: ProfilePlan = { profile: agent.profile, title: agent.title, hired: true, missing: [] };
    try {
      const installed = new Set(await hermes.listSkills(agent.profile));
      plan.missing = agent.skills.filter((id) => !installed.has(hermesSkillName(id)));
      if (agent.profile !== CEO_PROFILE) {
        const soul = await hermes.readSoul(agent.profile);
        const next = withMarketingBlock(soul, agent);
        if (next !== soul) plan.soul = next;
        const description = profileDescription(agent);
        if (live.description !== description) plan.description = description;
      }
    } catch (err) {
      plans.push({ ...plan, missing: [], error: reason(err) });
      continue;
    }
    plans.push(plan);
  }
  return plans;
}

export function describePlan(plan: ProfilePlan): string {
  const who = `${plan.profile} (${plan.title})`;
  if (!plan.hired) return `${who}: needs hire`;
  if (plan.error) return `${who}: FAILED to read from Hermes: ${plan.error}`;
  const parts = [
    ...(plan.missing.length ? [`install ${plan.missing.length} skill(s): ${plan.missing.map(hermesSkillName).join(", ")}`] : []),
    ...(plan.soul ? ["SOUL: add unit / marketing context"] : []),
    ...(plan.description ? ["description: update"] : []),
  ];
  return `${who}: ${parts.length ? parts.join("; ") : "up to date"}`;
}

async function applyPlan(plan: ProfilePlan, options: SkillSyncOptions, log: Log): Promise<number> {
  let failed = 0;
  const attempt = async (what: string, run: () => Promise<string | void>) => {
    try {
      const note = await run();
      log(`  ok ${what}${note ? ` (${note})` : ""}`);
    } catch (err) {
      failed++;
      log(`  FAILED ${what}: ${reason(err)}`);
    }
  };
  for (const id of plan.missing) {
    await attempt(`${hermesSkillName(id)} <- ${id}`, async () => {
      const result = await installSkill(options, plan.profile, id);
      return result.filesWritten ? `${result.filesWritten} reference file(s)` : undefined;
    });
  }
  if (plan.soul) await attempt("SOUL", () => options.hermes.writeSoul(plan.profile, plan.soul!));
  if (plan.description) await attempt("description", () => options.hermes.setDescription(plan.profile, plan.description!));
  return failed;
}

/**
 * Brings every hired roster profile up to its roster skills, the way hiring installs them (same names,
 * prefixes and categories), and patches the unit / marketing-context block into its SOUL. Never removes
 * a skill and never hires: profiles that do not exist are listed as needing a hire. Dry run unless
 * `apply`; idempotent. Returns the number of failed steps.
 */
export async function syncSkills(options: SkillSyncOptions): Promise<number> {
  const log = options.log ?? console.log;
  const plans = await planSkillSync(options);
  let failed = 0;
  for (const plan of plans) {
    log(describePlan(plan));
    if (plan.error) failed++;
    if (options.apply && plan.hired) failed += await applyPlan(plan, options, log);
  }
  const pending = plans.filter((p) => p.hired && (p.missing.length || p.soul || p.description)).length;
  const unhired = plans.filter((p) => !p.hired).length;
  log("");
  log(`${plans.length} profile(s): ${pending} to update, ${unhired} need a hire.`);
  return failed;
}
