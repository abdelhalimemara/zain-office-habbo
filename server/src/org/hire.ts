import type { HireResponse, HireStep } from "../../../shared/api";
import { DIVISION_IDS, type DivisionId } from "../../../shared/divisions";
import { hireFieldErrors } from "../../../shared/hireRules";
import { findBoardMember } from "../../../shared/board";
import { CEO_PROFILE, ROSTER, type RosterAgent } from "../../../shared/roster";
import type { HermesClient } from "../hermes/client";
import { HermesError } from "../hermes/client";
import type { HeadcountSource } from "../headcount/catalog";
import { toHermesSkill } from "../headcount/skillFile";
import { badRequest, optionalString } from "../http";
import { fullRoster, type HireStore } from "./hireStore";
import { profileDescription, soulFor } from "./persona";

const RANKS = ["board", "vp", "lead", "specialist"] as const;
const BOARD_PROFILE = /^zain-board-[a-z0-9-]+$/;

export interface HireDeps {
  hermes: HermesClient;
  headcount: HeadcountSource;
  hires: HireStore;
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  return value;
}

/** A canonical ROSTER profile may only be hired as itself, so the org chart cannot be rewritten. */
function assertMatchesRoster(agent: RosterAgent): void {
  const canonical = ROSTER.find((a) => a.profile === agent.profile);
  if (!canonical) return;
  const mismatched = (["title", "division", "rank", "reportsTo"] as const).filter((k) => canonical[k] !== agent[k]);
  if (mismatched.length) {
    throw badRequest(`${agent.profile} is a roster position; ${mismatched.join(", ")} must match the roster`);
  }
}

/** Board seats advise rather than report, and each one is defined in shared/board.ts. */
function boardReportsTo(profile: string, body: Record<string, unknown>): null {
  if (!BOARD_PROFILE.test(profile)) throw badRequest("board profiles must match zain-board-*");
  if (!findBoardMember(profile)) throw badRequest(`${profile} is not a board seat defined in shared/board.ts`);
  if (body.reportsTo !== undefined && body.reportsTo !== null) throw badRequest("reportsTo must be null for the board");
  return null;
}

async function managerReportsTo(profile: string, body: Record<string, unknown>, hires: HireStore): Promise<string> {
  if (BOARD_PROFILE.test(profile)) throw badRequest("zain-board-* profiles must be hired with rank board");
  const reportsTo = optionalString(body, "reportsTo", 64);
  const roster = await fullRoster(hires);
  if (!reportsTo || reportsTo === profile || !roster.some((a) => a.profile === reportsTo)) {
    throw badRequest("reportsTo must name an existing roster agent");
  }
  return reportsTo;
}

export async function parseHireRequest(
  body: Record<string, unknown>,
  deps: Pick<HireDeps, "headcount" | "hires">,
): Promise<RosterAgent> {
  const profile = stringField(body, "profile");
  const title = stringField(body, "title").trim();
  const skills = body.skills;
  if (!Array.isArray(skills) || !skills.every((s) => typeof s === "string")) {
    throw badRequest("skills must be an array of skill ids");
  }
  const errors = hireFieldErrors({ profile, title, skills });
  const first = (["profile", "title", "skills"] as const).find((k) => errors[k]);
  if (first) throw badRequest(`${first}: ${errors[first]}`);
  if (!DIVISION_IDS.includes(body.division as DivisionId)) throw badRequest("division is not a Zain division");
  const rank = body.rank;
  if (!RANKS.includes(rank as (typeof RANKS)[number])) throw badRequest("rank must be board, vp, lead or specialist");
  const reportsTo = rank === "board" ? boardReportsTo(profile, body) : await managerReportsTo(profile, body, deps.hires);
  if (body.reviewer !== undefined && typeof body.reviewer !== "boolean") throw badRequest("reviewer must be a boolean");
  const agent: RosterAgent = {
    profile,
    title,
    division: body.division as DivisionId,
    rank: rank as RosterAgent["rank"],
    reportsTo,
    skills: [...new Set(skills as string[])],
    ...(body.reviewer ? { reviewer: true } : {}),
  };
  assertMatchesRoster(agent);
  for (const id of agent.skills) {
    if (!(await deps.headcount.hasSkill(id))) throw badRequest(`unknown skill ${id}`);
  }
  return agent;
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
    await deps.hermes.createSkill({ ...skill, profile });
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
