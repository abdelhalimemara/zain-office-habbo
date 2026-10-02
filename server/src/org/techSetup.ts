import { join } from "node:path";
import { getDivision } from "../../../shared/divisions";
import { allTasks } from "../../../shared/flow";
import type { RosterAgent } from "../../../shared/roster";
import { teamCharterTitle, type TechTeam } from "../../../shared/techTeams";
import type { HermesClient } from "../hermes/client";
import type { ExecFileLike } from "../telegram/ceoWake";
import type { Log } from "./reconcile";

const VIEW_TIMEOUT_MS = 20_000;
const CREATE_TIMEOUT_MS = 60_000;
const CLONE_TIMEOUT_MS = 10 * 60_000;
const NOT_FOUND = /could not resolve to a repository|not found|http 404/i;

export interface TechSetupOptions {
  hermes: HermesClient;
  execFile: ExecFileLike;
  /** Absolute home directory; clones go to `<home>/ZainTech/<team>/<repo>`. */
  home: string;
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
  teams: readonly TechTeam[];
  roster: readonly RosterAgent[];
  apply: boolean;
  ghBin?: string;
  log?: Log;
}

export interface TechSetupResult {
  createdRepos: string[];
  cloned: string[];
  charters: string[];
  /** Problems that need the operator (e.g. a PM not hired yet); setup continues past them. */
  warnings: string[];
}

function stderrOf(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  return `${typeof e.stderr === "string" ? e.stderr : ""} ${typeof e.message === "string" ? e.message : ""}`;
}

async function repoExists(repo: string, o: TechSetupOptions): Promise<boolean> {
  try {
    await o.execFile(o.ghBin ?? "gh", ["repo", "view", repo, "--json", "name"], { timeout: VIEW_TIMEOUT_MS });
    return true;
  } catch (err) {
    if (NOT_FOUND.test(stderrOf(err))) return false;
    throw new Error(`gh repo view ${repo} failed: ${stderrOf(err).trim() || "unknown error"}`);
  }
}

export function charterBody(team: TechTeam, pm: string): string {
  return [
    `Tracking task for the ${team.name} team (repo \`${team.repo}\`), owned by \`${pm}\`.`,
    "",
    "First run: write the team charter (repo, stack, scope, milestones, risks, working agreements) from the repo's README and docs, and complete this task with the charter as the result.",
    "Afterwards: post the weekly team status here as a comment (done, in progress, blocked, next, risks).",
  ].join("\n");
}

async function ensureRepo(team: TechTeam, o: TechSetupOptions, result: TechSetupResult, log: Log): Promise<boolean> {
  if (!team.createRepo || (await repoExists(team.repo, o))) return true;
  const args = ["repo", "create", team.repo, "--private", "--add-readme", "--description", team.summary.slice(0, 350)];
  if (!o.apply) {
    log(`would create private repo ${team.repo}: gh ${args.slice(0, 4).join(" ")} --add-readme`);
    return false;
  }
  await o.execFile(o.ghBin ?? "gh", args, { timeout: CREATE_TIMEOUT_MS });
  result.createdRepos.push(team.repo);
  log(`created private repo ${team.repo}`);
  return true;
}

async function ensureClone(team: TechTeam, repoReady: boolean, o: TechSetupOptions, result: TechSetupResult, log: Log): Promise<void> {
  const teamDir = join(o.home, "ZainTech", team.id);
  const dir = join(teamDir, team.repo.split("/")[1]!);
  if (await o.exists(join(dir, ".git"))) {
    log(`${team.id}: ${dir} already cloned`);
    return;
  }
  if (!o.apply) {
    log(`would clone ${team.repo} into ${dir}${repoReady ? "" : " (after creating it)"}`);
    return;
  }
  await o.mkdir(teamDir);
  await o.execFile(o.ghBin ?? "gh", ["repo", "clone", team.repo, dir, "--", "--filter=blob:none"], { timeout: CLONE_TIMEOUT_MS });
  result.cloned.push(dir);
  log(`cloned ${team.repo} into ${dir}`);
}

async function ensureCharters(o: TechSetupOptions, result: TechSetupResult, log: Log): Promise<void> {
  const [board, profiles] = await Promise.all([o.hermes.board(), o.hermes.listProfiles()]);
  const titles = new Set(allTasks(board).map((t) => t.title));
  const hired = new Set(profiles.map((p) => p.name));
  for (const team of o.teams) {
    const title = teamCharterTitle(team);
    if (titles.has(title)) {
      log(`${team.id}: "${title}" exists`);
      continue;
    }
    const pm = o.roster.find((a) => a.team === team.id && a.teamRole === "project-manager");
    if (!pm || !hired.has(pm.profile)) {
      const warning = `${team.id}: no hired Project Manager${pm ? ` (${pm.profile})` : ""}; hire first, then re-run to create "${title}"`;
      result.warnings.push(warning);
      log(warning);
      continue;
    }
    if (!o.apply) {
      log(`would create "${title}" for ${pm.profile}`);
      continue;
    }
    const task = await o.hermes.createTask({
      title,
      body: charterBody(team, pm.profile),
      assignee: pm.profile,
      tenant: getDivision("tech").tenant,
      triage: false,
    });
    result.charters.push(task.id);
    log(`created "${title}" (${task.id}) for ${pm.profile}`);
  }
}

/**
 * Idempotent Zain Tech setup: creates missing `createRepo` repos (private, with a README), clones
 * every team repo once under ~/ZainTech, and opens one charter tracking task per team. A dry run
 * only reads (gh repo view, the kanban board and profiles).
 */
export async function techSetup(o: TechSetupOptions): Promise<TechSetupResult> {
  const log = o.log ?? console.log;
  const result: TechSetupResult = { createdRepos: [], cloned: [], charters: [], warnings: [] };
  const ready = new Map<string, boolean>();
  for (const team of o.teams) ready.set(team.id, await ensureRepo(team, o, result, log));
  for (const team of o.teams) await ensureClone(team, ready.get(team.id)!, o, result, log);
  await ensureCharters(o, result, log);
  return result;
}
