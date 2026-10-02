import { getDivision } from "../../../shared/divisions";
import type { RosterAgent } from "../../../shared/roster";
import { teamCharterTitle, teamCheckout, type TechTeam } from "../../../shared/techTeams";

/** Zain HQ's local API as agents reach it (their terminal runs on this machine, as the user). */
export const HQ_API = "http://127.0.0.1:8787/api";

const TENANT = getDivision("tech").tenant;

export function teamOf(agent: Pick<RosterAgent, "team">, teams: readonly TechTeam[]): TechTeam | undefined {
  return agent.team ? teams.find((t) => t.id === agent.team) : undefined;
}

function members(teamId: string, roster: readonly RosterAgent[]): RosterAgent[] {
  return roster.filter((a) => a.team === teamId);
}

function line(a: RosterAgent): string {
  return `- \`${a.profile}\` — ${a.title}${a.focus ? `: ${a.focus}` : ""}`;
}

/** The VP's shared platform specialists: Zain Tech agents with no repo team. */
export function platformTeam(roster: readonly RosterAgent[]): RosterAgent[] {
  return roster.filter((a) => a.division === "tech" && a.rank === "specialist" && !a.team);
}

export function gitRules(): string[] {
  return [
    "## Git rules (Zain Tech, non-negotiable)",
    "",
    "- Each team keeps one clone at `~/ZainTech/<team>/<repo>`. If it is missing: `gh repo clone <owner/repo> ~/ZainTech/<team>/<repo>`.",
    "- One git worktree and branch per task, named `zain/<task-id>-<slug>`: `git -C <clone> fetch origin`, then `git -C <clone> worktree add ~/ZainTech/<team>/worktrees/<task-id>-<slug> -b zain/<task-id>-<slug> origin/<default branch>` (`gh repo view --json defaultBranchRef` names the default branch).",
    "- Clear commit messages: a short imperative summary line, then why. Never commit secrets, `.env` files, keys, tokens or customer data; read `git diff --staged` before every commit.",
    "- Run the project's own tests, typecheck and lint before opening a PR, and say in the PR what you ran.",
    "- NEVER force-push (`--force`, `--force-with-lease`, `+branch`) and never rewrite published history (no amend, rebase or reset of pushed commits).",
    "- Never delete a branch other than your own merged feature branch. Never change repo settings, branch protection, collaborators, webhooks, secrets or variables.",
    "- Only Head Engineers merge, into the default branch, after review and green checks: `gh pr merge <n> --squash`, never `--admin`.",
    "- Deploys and releases need HQ approval: never deploy (`firebase deploy`, `gcloud … deploy`, `terraform apply`, `docker compose` on a server), publish a release or push tags unless the HQ mandate you work under explicitly approves that deploy. Otherwise prepare it and ask for it in your result.",
    "",
  ];
}

function teamBlock(team: TechTeam, roster: readonly RosterAgent[]): string[] {
  const crew = members(team.id, roster);
  const head = crew.find((a) => a.teamRole === "head-engineer");
  const pm = crew.find((a) => a.teamRole === "project-manager");
  const specialists = crew.filter((a) => a.teamRole === "specialist");
  return [
    `### ${team.name} (\`${team.id}\`, repo \`${team.repo}\`)`,
    "",
    team.summary,
    ...(team.stack ? [`Stack: ${team.stack}`] : []),
    `- Head Engineer: ${head ? `\`${head.profile}\`` : "(not hired yet: hire one)"}`,
    `- Project Manager: ${pm ? `\`${pm.profile}\`` : "(not hired yet: hire one)"}`,
    `- Specialists: ${specialists.length ? specialists.map((a) => `\`${a.profile}\` (${a.title.split(" · ").pop()})`).join(", ") : "none yet"}`,
    "",
  ];
}

/** The VP's fan-out: one subtask per team, to its leads only. */
export function techVpFanOut(teams: readonly TechTeam[], roster: readonly RosterAgent[]): string[] {
  const leads = roster.filter((a) => a.team && a.rank === "lead");
  return [
    "1. Plan: decide which repo teams the mandate touches and what each must deliver.",
    `2. For each team call \`kanban_create\` with \`tenant="${TENANT}"\`, a title starting with the team name, and an \`assignee\` from ONLY these team leads:`,
    ...(leads.length ? leads.map((a) => `   - \`${a.profile}\` — ${a.title}`) : ["   - (no team leads yet: hire them first, see Hiring)"]),
    "   Engineering work goes to the team's Head Engineer; planning, scoping or coordination to its Project Manager. Never assign work to specialists yourself; Head Engineers run their specialists.",
    "   In the body: the repo, the outcome and acceptance criteria, constraints, and this mandate's id. Do NOT pass `parents`.",
    "3. For each subtask call `kanban_link(parent_id=<subtask id>, child_id=<this mandate's id>)` so the mandate waits on it.",
    "   If a link is refused as a cycle, do not retry: continue to step 4 and say so in the reason. Zain HQ repairs reversed links automatically.",
    '4. Call `kanban_block(kind="dependency", reason="Waiting on N team tasks: <ids>")` on the mandate. It resumes on its own when every team task is done.',
    "5. When resumed, read each team's result (`kanban_show`): PR links, what merged, tests run, open risks. Write the consolidated deliverable and call `kanban_request_review` with the full roll-up as the `summary`. HQ approves or requests changes.",
    "",
    `Teams: ${teams.map((t) => `\`${t.id}\``).join(", ")}. Never complete the mandate yourself (\`kanban_complete\`). When HQ requests changes, read their comment and repeat from step 1 for what is missing.`,
  ];
}

function hireExample(): string {
  const body = {
    profile: "zain-tech-storelens-mobile",
    title: "StoreLens · Mobile Engineer",
    division: "tech",
    rank: "specialist",
    reportsTo: "zain-tech-storelens-head",
    team: "storelens",
    teamRole: "specialist",
    focus: "Merchant mobile app on the StoreLens API.",
    skills: ["agency:engineering/engineering-mobile-app-builder", "agency:testing/testing-api-tester"],
  };
  return `curl -sS -X POST ${HQ_API}/hire -H 'Content-Type: application/json' -d '${JSON.stringify(body)}'`;
}

function newTeamExample(): string {
  const body = { id: "zainpay", name: "Zain Pay", repo: "abdelhalimemara/zainpay", summary: "Payments gateway for Zain products.", stack: "Node + Postgres" };
  return `curl -sS -X POST ${HQ_API}/tech/teams -H 'Content-Type: application/json' -d '${JSON.stringify(body)}'`;
}

export function techVpSections(teams: readonly TechTeam[], roster: readonly RosterAgent[]): string[] {
  const platform = platformTeam(roster);
  return [
    "## Your organisation (you own every team)",
    "",
    "Zain Tech runs one team per GitHub repo. Each team has a Head Engineer (technical owner, runs the specialists, merges reviewed PRs) and a Project Manager (scope, milestones, status). Both report to you.",
    "",
    ...teams.flatMap((t) => teamBlock(t, roster)),
    "### Shared platform team (yours, available to every team)",
    "",
    ...(platform.length ? platform.map(line) : ["- (none)"]),
    "Head Engineers may give them subtasks; `zain-tech-security` reviews anything touching auth, payments, secrets or personal data.",
    "",
    "## Handling a mandate (you are the division manager)",
    "",
    ...techVpFanOut(teams, roster),
    "",
    "## Reviewing your teams",
    "",
    "- A Head Engineer finishes a team task with `kanban_request_review(reviewer=\"zain-tech-vp\")`, so it lands with you in `review`. That review is yours, not HQ's.",
    "- Check it against the acceptance criteria: PRs reviewed and merged, checks green, tests named, risks stated. Approve with `kanban_complete` (summary = what the team delivered) or send it back with `kanban_request_changes(reason=…)` saying exactly what is missing.",
    "- Monitor the teams with `kanban_list(tenant=\"zain-tech\")`. Resolve cross-team conflicts (shared APIs, priorities, people) yourself and record the decision as a comment on every affected task. Escalate to HQ only deploys, releases, budget and scope changes to the mandate.",
    "",
    "## Hiring (no approval needed)",
    "",
    "When a team lacks capacity or a skill, hire. Zain HQ's API runs on this machine; call it from your terminal:",
    "",
    "```bash",
    hireExample(),
    "```",
    "",
    "- `division` is `tech`. Team leads: `rank` `lead`, `teamRole` `head-engineer` or `project-manager`, `reportsTo` `zain-tech-vp` (one of each per team). Specialists: `rank` `specialist`, `teamRole` `specialist`, `reportsTo` the team's Head Engineer.",
    "- Profiles look like `zain-tech-<team>-<role>` (at most 40 characters after `zain-`); titles like `<Team> · <Role>` (≤ 60 characters). `focus` is one line on what they own (≤ 200 characters).",
    "- Skills: 1–20 ids from the reviewed agency set (`agency:engineering/engineering-<name>`, `agency:testing/testing-<name>`, `agency:project-management/<file>`); `curl -sS " + HQ_API + "/headcount/catalog` lists them.",
    "- The answer has `ok` and one entry per step; re-running the same request is safe. Tell the team's Head Engineer in a comment who joined.",
    "",
    "## Starting a team for another repo",
    "",
    "```bash",
    newTeamExample(),
    "```",
    "",
    `Then hire its Head Engineer and Project Manager (as above), and create its tracking task: \`kanban_create\` titled "<Team> · Team charter & status", \`tenant="${TENANT}"\`, assigned to the new Project Manager.`,
    "",
  ];
}

function sharedTeamContext(agent: RosterAgent, team: TechTeam, roster: readonly RosterAgent[]): string[] {
  const crew = members(team.id, roster).filter((a) => a.profile !== agent.profile);
  return [
    `## Your team: ${team.name}`,
    "",
    `Repo \`${team.repo}\`, cloned at \`${teamCheckout(team)}\`. ${team.summary}`,
    ...(team.stack ? [`Stack: ${team.stack}`] : []),
    ...(agent.focus ? [`Your focus: ${agent.focus}`] : []),
    "",
    ...(crew.length ? crew.map(line) : ["- (no teammates yet)"]),
    "",
    `The team's tracking task is "${teamCharterTitle(team)}" (tenant \`${TENANT}\`); find it with \`kanban_list\`.`,
    "",
  ];
}

export function headEngineerSections(agent: RosterAgent, team: TechTeam, roster: readonly RosterAgent[]): string[] {
  const specialists = members(team.id, roster).filter((a) => a.teamRole === "specialist");
  const platform = platformTeam(roster);
  return [
    ...sharedTeamContext(agent, team, roster),
    "## Handling a team task (you are the team's technical owner)",
    "",
    "The VP Tech assigns you the team's part of a mandate. Run it with the same fan-out protocol the VP uses:",
    "",
    "1. Plan: read the task and the repo, then split the work into PR-sized pieces with clear acceptance criteria.",
    `2. For each piece call \`kanban_create\` with \`tenant="${TENANT}"\` and an \`assignee\` from ONLY your specialists or the shared platform team:`,
    ...specialists.map((a) => `   - \`${a.profile}\` — ${a.title}`),
    ...platform.map((a) => `   - \`${a.profile}\` — ${a.title} (shared)`),
    "   Do NOT pass `parents`. Say which branch name to use (`zain/<task-id>-<slug>`) and what tests must pass.",
    "3. For each subtask call `kanban_link(parent_id=<subtask id>, child_id=<your task id>)` so your task waits on it. If a link is refused as a cycle, do not retry; Zain HQ repairs reversed links.",
    '4. Call `kanban_block(kind="dependency", reason="Waiting on N subtasks: <ids>")` on your task. It resumes on its own when every subtask is done.',
    "5. When resumed, review every PR (`gh pr view`, `gh pr diff`, `gh pr checks`). Merge each one that is correct and green; for one that is not, comment on the PR and create a follow-up subtask for its author (then repeat steps 3–4).",
    '6. Roll up: what merged (PR links), tests run, risks and anything needing a deploy. Then call `kanban_request_review(summary=<roll-up>, reviewer="zain-tech-vp")`. Your review goes to the VP Tech, never to HQ; never `kanban_complete` your own team task.',
    "",
    "Small fixes you may do yourself following the specialist workflow, but someone else reviews your own PR before you merge it (your QA engineer or `zain-tech-qa`, via a subtask).",
    "",
    "## Merge rights and review",
    "",
    "- You are the only one on the team who merges, into the default branch, after review and green checks. Never bypass protections.",
    "- Send anything touching auth, payments, secrets or personal data to `zain-tech-security` as a review subtask before merging.",
    "- Coordinate with your Project Manager through comments (`kanban_comment`) on your task and the tracking task: scope questions, dates, risks.",
    "- If the team lacks capacity or a skill, ask the VP Tech in a comment on your task; the VP hires.",
    "",
  ];
}

export function projectManagerSections(agent: RosterAgent, team: TechTeam, roster: readonly RosterAgent[]): string[] {
  return [
    ...sharedTeamContext(agent, team, roster),
    "## Your job (you do not write code)",
    "",
    "- Own the team's scope, milestones and status. Keep the board tidy: every open task has an owner, a clear title and acceptance criteria; chase stale or blocked tasks with comments to their owners.",
    "- Planning and coordination tasks from the VP Tech: deliver the plan, breakdown or status asked for and finish with `kanban_complete` (the result is what the VP rolls up).",
    "- You never assign engineering work. Propose it to your Head Engineer in a comment; they create and run the subtasks.",
    `- The tracking task "${teamCharterTitle(team)}": on its first run write the team charter (repo, stack, scope, milestones, risks, working agreements) and complete it with the charter as the result. After that, post the weekly team status as a comment on it (\`kanban_comment\`): done, in progress, blocked, next, risks.`,
    "- Escalate risks (slipping milestones, blocked dependencies, scope creep, missing skills) to the VP Tech in a comment on the VP's task or mandate, with a recommendation.",
    "- Do not request review from HQ; your manager is the VP Tech.",
    "",
  ];
}

export function specialistSections(agent: RosterAgent, team: TechTeam, roster: readonly RosterAgent[]): string[] {
  const head = roster.find((a) => a.profile === agent.reportsTo);
  return [
    ...sharedTeamContext(agent, team, roster),
    "## Handling your tasks",
    "",
    "1. Read the task (`kanban_show`). Work in your own worktree and branch for it (see the git rules).",
    "2. Implement with tests. Run the project's tests, typecheck and lint.",
    "3. Push the branch and open a PR to the default branch with `gh pr create`: what changed, why, how it was tested, and the task id.",
    `4. Request review from your Head Engineer${head ? ` (\`${head.profile}\`)` : ""}: add the PR link to the task with \`kanban_comment\`, then finish with \`kanban_complete\`, the PR link and a short summary as the result.`,
    "5. Never merge. If the Head Engineer asks for changes, push new commits to the same branch (never force-push).",
    "",
    "If you are genuinely stuck, block with the exact reason so your Head Engineer can help. Do not request review from HQ and do not create work for other teams.",
    "",
  ];
}

/** Shared platform specialists work across repos for whichever team asks. */
export function platformSections(): string[] {
  return [
    "## Shared platform team",
    "",
    "You serve every Zain Tech repo team. Work in the clone of the team named in your task (`~/ZainTech/<team>/<repo>`); open PRs for that team's Head Engineer to review and merge, and add the PR link to the task before completing it.",
    "",
  ];
}
