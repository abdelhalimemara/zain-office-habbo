import type { HireResponse, HireStep } from "../../../shared/api";
import { DIVISION_IDS, type DivisionId } from "../../../shared/divisions";
import { hireFieldErrors } from "../../../shared/hireRules";
import { findBoardMember } from "../../../shared/board";
import { CEO_PROFILE, ROSTER, managerOf, type RosterAgent } from "../../../shared/roster";
import { TEAM_ROLES, type TeamRole } from "../../../shared/techTeams";
import type { HermesClient } from "../hermes/client";
import { HermesError } from "../hermes/client";
import type { HeadcountSource } from "../headcount/catalog";
import { toHermesSkill } from "../headcount/skillFile";
import { badRequest, optionalString } from "../http";
import { fullRoster, type HireStore } from "./hireStore";
import { profileDescription, soulText } from "./persona";
import type { BriefReader } from "./privateBriefs";
import { allTeams, type TeamStore } from "./teamStore";

const RANKS = ["board", "vp", "lead", "specialist"] as const;
const BOARD_PROFILE = /^zain-board-[a-z0-9-]+$/;

export interface HireDeps {
  hermes: HermesClient;
  headcount: HeadcountSource;
  hires: HireStore;
  briefs: BriefReader;
  teams: TeamStore;
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
  const mismatched = (["title", "division", "rank", "reportsTo", "team", "teamRole"] as const).filter((k) => canonical[k] !== agent[k]);
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

/**
 * Repo team placement: leads (Head Engineer, Project Manager) report to the VP Tech, one of each
 * per team; specialists report to their team's Head Engineer.
 */
async function teamPlacement(
  agent: RosterAgent,
  body: Record<string, unknown>,
  deps: Pick<HireDeps, "hires" | "teams">,
): Promise<Pick<RosterAgent, "team" | "teamRole">> {
  if (body.team === undefined || body.team === null) {
    if (body.teamRole !== undefined && body.teamRole !== null) throw badRequest("teamRole needs a team");
    return {};
  }
  if (typeof body.team !== "string") throw badRequest("team must be a string");
  if (agent.division !== "tech") throw badRequest("only Zain Tech hires join a repo team");
  const team = (await allTeams(deps.teams)).find((t) => t.id === body.team);
  if (!team) throw badRequest(`team ${body.team} is not a Zain Tech team`);
  const teamRole = body.teamRole ?? (agent.rank === "specialist" ? "specialist" : undefined);
  if (!TEAM_ROLES.includes(teamRole as TeamRole)) throw badRequest("teamRole must be head-engineer, project-manager or specialist");
  const roster = await fullRoster(deps.hires);
  const members = roster.filter((a) => a.team === team.id && a.profile !== agent.profile);
  if (teamRole === "specialist") {
    if (agent.rank !== "specialist") throw badRequest("team specialists have rank specialist");
    const head = members.find((a) => a.teamRole === "head-engineer");
    if (!head || agent.reportsTo !== head.profile) {
      throw badRequest(`team specialists report to the ${team.name} Head Engineer${head ? ` (${head.profile})` : ", hire one first"}`);
    }
  } else {
    if (agent.rank !== "lead") throw badRequest("Head Engineers and Project Managers have rank lead");
    const vp = managerOf("tech", roster).profile;
    if (agent.reportsTo !== vp) throw badRequest(`team leads report to the VP Tech (${vp})`);
    const holder = members.find((a) => a.teamRole === teamRole);
    if (holder) throw badRequest(`${team.name} already has a ${teamRole}: ${holder.profile}`);
  }
  return { team: team.id, teamRole: teamRole as TeamRole };
}

export async function parseHireRequest(
  body: Record<string, unknown>,
  deps: Pick<HireDeps, "headcount" | "hires" | "teams">,
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
  const focus = optionalString(body, "focus", 200);
  const agent: RosterAgent = {
    profile,
    title,
    division: body.division as DivisionId,
    rank: rank as RosterAgent["rank"],
    reportsTo,
    skills: [...new Set(skills as string[])],
    ...(body.reviewer ? { reviewer: true } : {}),
    ...(focus ? { focus } : {}),
  };
  Object.assign(agent, await teamPlacement(agent, body, deps));
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
  const profiles = new Set((await deps.hermes.listProfiles()).map((p) => p.name));
  const exists = profiles.has(agent.profile);
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
  const teams = await allTeams(deps.teams);
  await step(steps, "write-soul", agent.profile, async () =>
    deps.hermes.writeSoul(agent.profile, await soulText(agent, roster, deps.briefs, teams)),
  );
  await step(steps, "describe", agent.profile, () => deps.hermes.setDescription(agent.profile, description));
  for (const id of agent.skills) {
    await step(steps, "install-skill", id, () => installSkill(deps, agent.profile, id));
  }
  for (const manager of managersToBrief(agent, roster).filter((m) => profiles.has(m.profile))) {
    await step(steps, "write-soul", manager.profile, async () =>
      deps.hermes.writeSoul(manager.profile, await soulText(manager, roster, deps.briefs, teams)),
    );
  }
  return { ok: steps.every((s) => s.ok), profile: agent.profile, steps };
}

/** A runtime team hire changes who its leads and the VP Tech can assign work to, so their SOULs are rewritten. */
function managersToBrief(agent: RosterAgent, roster: readonly RosterAgent[]): RosterAgent[] {
  if (!agent.team || ROSTER.some((a) => a.profile === agent.profile)) return [];
  const vp = managerOf("tech", roster);
  const leads = roster.filter((a) => a.team === agent.team && a.rank === "lead" && a.profile !== agent.profile);
  return [...leads, vp];
}
