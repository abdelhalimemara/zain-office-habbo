import { getDivision, type Division } from "../../../shared/divisions";
import { CEO_PROFILE, agentsInDivision, findAgent, type RosterAgent } from "../../../shared/roster";
import { humanize } from "../headcount/skillFile";

function bossLabel(agent: RosterAgent, roster: readonly RosterAgent[]): string {
  if (!agent.reportsTo) return "nobody";
  if (agent.reportsTo === CEO_PROFILE) return `the CEO (\`${CEO_PROFILE}\`)`;
  const boss = findAgent(agent.reportsTo, roster);
  return boss ? `${boss.title} (\`${boss.profile}\`)` : `\`${agent.reportsTo}\``;
}

function skillNames(agent: RosterAgent): string {
  return agent.skills.map((id) => humanize(id.split(":")[1] ?? id).toLowerCase()).join(", ");
}

/** Short routing signal for Hermes' decomposer: who this is and what they are good at. */
export function profileDescription(agent: RosterAgent): string {
  const division = getDivision(agent.division);
  const text = `${division.name} · ${agent.title} (${agent.rank}). ${division.tagline}. Skills: ${skillNames(agent)}.`;
  return text.length <= 400 ? text : `${text.slice(0, 399)}…`;
}

function teamLines(agent: RosterAgent, roster: readonly RosterAgent[]): string[] {
  return agentsInDivision(agent.division, roster)
    .filter((a) => a.profile !== agent.profile && a.rank !== "ceo")
    .map((a) => `- \`${a.profile}\` — ${a.title}`);
}

/** The VP-owned fan-out, spelled out in the Hermes worker tools the VP actually has. */
function fanOutProtocol(division: Division, team: readonly string[]): string[] {
  return [
    "1. Plan: break the mandate into concrete pieces of work for your team.",
    `2. For each piece call \`kanban_create\` with \`tenant="${division.tenant}"\` and an \`assignee\` from ONLY this team list:`,
    ...(team.length ? team.map((t) => `   ${t}`) : ["   - (no team members yet: do the work yourself and skip to step 5)"]),
    "   Do NOT pass `parents`. Passing this mandate as a parent makes the subtask wait for the mandate and deadlocks the work.",
    "3. For each subtask call `kanban_link(parent_id=<subtask id>, child_id=<this mandate's id>)` so the mandate waits on it.",
    "   If a link is refused as a cycle, do not retry: continue to step 4 and say so in the reason. Zain HQ repairs reversed links automatically.",
    '4. Call `kanban_block(kind="dependency", reason="Waiting on N subtasks: <ids>")` on the mandate. It resumes on its own when every subtask is done.',
    "5. When resumed, read the subtask results (`kanban_show`), write the consolidated deliverable, and call `kanban_request_review` with the full roll-up as the `summary`. HQ approves or requests changes.",
    "",
    "Never complete the mandate yourself (`kanban_complete`), and never assign work outside your team. When HQ requests changes, read their comment and repeat from step 1 for what is missing.",
  ];
}

export function soulFor(agent: RosterAgent, roster: readonly RosterAgent[]): string {
  const division = getDivision(agent.division);
  const lines = [
    `# ${agent.title} — ${division.name}`,
    "",
    `You are the ${agent.title} of ${division.name} (${division.tagline}), part of Zain Group, an agency headquartered in Riyadh.`,
    `You report to ${bossLabel(agent, roster)}. Your Hermes profile is \`${agent.profile}\`.`,
    "",
    "## How work flows at Zain Group",
    "",
    `- All work lives on the \`zain-group\` kanban board. Every ${division.name} task carries tenant \`${division.tenant}\`.`,
    "- HQ issues *mandates* to division managers (VPs; the COO for HQ). The manager fans each mandate out to their own team as subtasks.",
    "- When every subtask is done, the manager rolls the results up and requests review, which means awaiting HQ approval.",
    "- HQ approves (the mandate becomes done) or requests changes with a comment and sends it back to the manager.",
  ];
  if (agent.rank === "vp") {
    lines.push("", "## Handling a mandate (you are the division manager)", "", ...fanOutProtocol(division, teamLines(agent, roster)));
  } else {
    lines.push(
      "",
      "## Handling your tasks",
      "",
      "- Do the task you are assigned and finish it with `kanban_complete`, including a clear result summary your manager can roll up.",
      "- Do not request review from HQ and do not create work for other divisions; HQ only reviews your manager's mandates.",
      "- If you are genuinely stuck, block with the exact reason so your manager can help.",
    );
  }
  if (agent.reviewer) {
    lines.push(
      "",
      "## Reviewer authority",
      "",
      "- You review work in your area of expertise and may block a task you review, stating the exact reason and what would unblock it.",
    );
  }
  lines.push("", "## Expertise", "", ...agent.skills.map((id) => `- ${id}`), "");
  return lines.join("\n");
}

/** The mandate body: HQ's brief followed by the fan-out protocol for the division manager. */
export function mandateBody(brief: string, manager: RosterAgent, roster: readonly RosterAgent[]): string {
  const division = getDivision(manager.division);
  return [
    brief || "(No further brief provided.)",
    "",
    "---",
    `**Instructions for ${manager.title} (\`${manager.profile}\`)**`,
    "",
    `This is an HQ mandate for ${division.name}. You own it end to end:`,
    "",
    ...fanOutProtocol(division, teamLines(manager, roster)),
  ].join("\n");
}
