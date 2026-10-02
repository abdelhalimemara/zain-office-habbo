import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import type { CreateTechTeamRequest, TechTeamsResponse } from "../../../shared/api";
import { REPO_PATTERN, TEAM_ID_PATTERN, TECH_TEAMS, type TechTeam } from "../../../shared/techTeams";
import type { HermesClient } from "../hermes/client";
import { HttpError, badRequest, optionalString, requiredString } from "../http";
import type { ExecFileLike } from "../telegram/ceoWake";
import { fullRoster, type HireStore } from "./hireStore";
import { mergeRoster } from "./rosterView";
import { allTeams, type TeamStore } from "./teamStore";

const GH_TIMEOUT_MS = 15_000;
export const defaultGhExec: ExecFileLike = promisify(nodeExecFile);

export interface GhCheck {
  execFile: ExecFileLike;
  /** Defaults to env GH_BIN, then `gh` on PATH. */
  ghBin?: string;
}

export function parseTeamRequest(body: Record<string, unknown>): CreateTechTeamRequest {
  const id = requiredString(body, "id", 2, 31);
  if (!TEAM_ID_PATTERN.test(id)) throw badRequest("id must be 2–31 lowercase letters, digits or dashes, starting with a letter or digit");
  const name = requiredString(body, "name", 1, 40);
  const repo = requiredString(body, "repo", 3, 140);
  if (!REPO_PATTERN.test(repo) || /\/\.{1,2}$/.test(repo)) throw badRequest("repo must be a GitHub owner/name");
  const summary = requiredString(body, "summary", 1, 300);
  const stack = optionalString(body, "stack", 300);
  return { id, name, repo, summary, ...(stack ? { stack } : {}) };
}

/** True when the logged-in `gh` can see the repo (no shell; arguments are passed as-is). */
export async function ghCanSee(repo: string, gh: GhCheck): Promise<boolean> {
  try {
    await gh.execFile(gh.ghBin || process.env.GH_BIN || "gh", ["repo", "view", repo, "--json", "nameWithOwner"], { timeout: GH_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export async function createTeam(req: CreateTechTeamRequest, store: TeamStore, gh: GhCheck): Promise<TechTeam> {
  const teams = await allTeams(store);
  if (teams.some((t) => t.id === req.id)) throw new HttpError(409, `team ${req.id} already exists`);
  const owner = teams.find((t) => t.repo.toLowerCase() === req.repo.toLowerCase());
  if (owner) throw new HttpError(409, `${req.repo} already belongs to team ${owner.id}`);
  if (!(await ghCanSee(req.repo, gh))) throw badRequest(`gh cannot see ${req.repo}; check the name and access`);
  const team: TechTeam = { ...req };
  await store.save(team);
  return team;
}

export async function listTeams(store: TeamStore, hires: HireStore, hermes: HermesClient): Promise<TechTeamsResponse> {
  const [teams, roster, profiles] = await Promise.all([allTeams(store), fullRoster(hires), hermes.listProfiles()]);
  const { agents } = mergeRoster(roster, profiles);
  return {
    teams: teams.map((team) => ({
      ...team,
      runtime: !TECH_TEAMS.some((t) => t.id === team.id),
      members: agents.filter((a) => a.team === team.id),
    })),
  };
}
