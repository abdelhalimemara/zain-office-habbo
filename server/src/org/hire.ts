import type { HireResponse, HireStep } from "../../../shared/api";
import { DIVISION_IDS, type DivisionId } from "../../../shared/divisions";
import { CEO_PROFILE, type RosterAgent } from "../../../shared/roster";
import type { HermesClient } from "../hermes/client";
import { HermesError } from "../hermes/client";
import type { HeadcountSource } from "../headcount/catalog";
import { SKILL_CATEGORY, toHermesSkill } from "../headcount/skillFile";
import { badRequest, optionalString, requiredString } from "../http";
import { fullRoster, type HireStore } from "./hireStore";
import { profileDescription, soulFor } from "./persona";

const PROFILE = /^zain-[a-z0-9-]{2,40}$/;
const RANKS = ["vp", "lead", "specialist"] as const;

export interface HireDeps {
  hermes: HermesClient;
  headcount: HeadcountSource;
  hires: HireStore;
}

export async function parseHireRequest(
  body: Record<string, unknown>,
  deps: Pick<HireDeps, "headcount" | "hires">,
): Promise<RosterAgent> {
  const profile = requiredString(body, "profile", 1, 45);
  if (!PROFILE.test(profile)) throw badRequest("profile must match zain-[a-z0-9-]{2,40}");
  const title = requiredString(body, "title", 1, 60);
  if (!DIVISION_IDS.includes(body.division as DivisionId)) throw badRequest("division is not a Zain division");
  const rank = body.rank;
  if (!RANKS.includes(rank as (typeof RANKS)[number])) throw badRequest("rank must be vp, lead or specialist");
  const reportsTo = optionalString(body, "reportsTo", 64);
  const roster = await fullRoster(deps.hires);
  if (!reportsTo || reportsTo === profile || !roster.some((a) => a.profile === reportsTo)) {
    throw badRequest("reportsTo must name an existing roster agent");
  }
  if (body.reviewer !== undefined && typeof body.reviewer !== "boolean") throw badRequest("reviewer must be a boolean");
  const skills = body.skills;
  if (!Array.isArray(skills) || skills.length < 1 || skills.length > 15 || !skills.every((s) => typeof s === "string")) {
    throw badRequest("skills must be 1..15 headcount skill ids");
  }
  const unique = [...new Set(skills as string[])];
  for (const id of unique) {
    if (!(await deps.headcount.hasSkill(id))) throw badRequest(`unknown headcount skill ${id}`);
  }
  return {
    profile,
    title,
    division: body.division as DivisionId,
    rank: rank as RosterAgent["rank"],
    reportsTo,
    skills: unique,
    ...(body.reviewer ? { reviewer: true } : {}),
  };
}

function failure(err: unknown): string {
  if (err instanceof HermesError) return err.detail;
  return err instanceof Error ? err.message : String(err);
}

async function step(
  steps: HireStep[],
  kind: HireStep["step"],
  target: string,
  run: () => Promise<void>,
): Promise<boolean> {
  try {
    await run();
    steps.push({ step: kind, target, ok: true });
    return true;
  } catch (err) {
    steps.push({ step: kind, target, ok: false, error: failure(err) });
    return false;
  }
}

async function installSkill(deps: HireDeps, profile: string, id: string): Promise<void> {
  const skill = toHermesSkill(id, await deps.headcount.skillMarkdown(id));
  try {
    await deps.hermes.createSkill({ ...skill, category: SKILL_CATEGORY, profile });
  } catch (err) {
    if (err instanceof HermesError && err.status === 400 && /already exists/i.test(err.detail)) return;
    throw err;
  }
}

/**
 * Idempotent: an existing profile is kept (not re-cloned) and re-installing a skill that is
 * already present counts as success, so a partially failed hire can simply be retried.
 */
export async function hire(agent: RosterAgent, deps: HireDeps): Promise<HireResponse> {
  const steps: HireStep[] = [];
  const description = profileDescription(agent);
  const exists = (await deps.hermes.listProfiles()).some((p) => p.name === agent.profile);
  if (exists) {
    steps.push({ step: "create-profile", target: agent.profile, ok: true });
  } else {
    const created = await step(steps, "create-profile", agent.profile, () =>
      deps.hermes.createProfile({ name: agent.profile, clone_from: CEO_PROFILE, clone_channels: false, description }),
    );
    if (!created) return { ok: false, profile: agent.profile, steps };
  }

  await deps.hires.save(agent);
  const roster = await fullRoster(deps.hires);
  await step(steps, "write-soul", agent.profile, () => deps.hermes.writeSoul(agent.profile, soulFor(agent, roster)));
  await step(steps, "describe", agent.profile, () => deps.hermes.setDescription(agent.profile, description));
  for (const id of agent.skills) {
    await step(steps, "install-skill", id, () => installSkill(deps, agent.profile, id));
  }
  return { ok: steps.every((s) => s.ok), profile: agent.profile, steps };
}
