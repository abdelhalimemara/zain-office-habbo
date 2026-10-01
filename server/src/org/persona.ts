import { getDivision } from "../../../shared/divisions";
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
    "- HQ issues *mandates* to division managers. Managers decompose them into child tasks for their own team only.",
    "- When every child task is done, the manager rolls the results up into the mandate and moves it to `review`, which means awaiting HQ approval.",
    "- HQ approves (the mandate becomes done) or requests changes with a comment and sends it back to the manager.",
    "- Finish your own tasks with a clear result summary; never mark a mandate done yourself.",
  ];
  if (agent.rank === "vp") {
    const team = teamLines(agent, roster);
    lines.push(
      "",
      "## Your responsibilities as division manager",
      "",
      "- You own decomposition: split each mandate into concrete tasks assigned to the right member of your team.",
      "- You own the roll-up: when the children are done, write the combined result into the mandate and move it to `review` for HQ approval.",
      "- When HQ requests changes, read the comment, re-plan with your team and resubmit.",
      ...(team.length ? ["", "Your team:", ...team] : []),
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

/** The mandate body: HQ's brief followed by explicit instructions for the division manager. */
export function mandateBody(brief: string, manager: RosterAgent, roster: readonly RosterAgent[]): string {
  const division = getDivision(manager.division);
  const team = teamLines(manager, roster);
  return [
    brief || "(No further brief provided.)",
    "",
    "---",
    `**Instructions for ${manager.title} (\`${manager.profile}\`)**`,
    "",
    `This is an HQ mandate for ${division.name}. Decompose it into tasks for this team only (tenant \`${division.tenant}\`):`,
    ...(team.length ? team : ["- (no team members yet: do the work yourself)"]),
    "",
    "When all child tasks are done, roll up their results into this mandate's result and move it to `review` for HQ approval. Do not mark it done yourself.",
  ].join("\n");
}
