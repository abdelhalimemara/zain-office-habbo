import { getDivision, type Division } from "../../../shared/divisions";
import { CEO_PROFILE, agentsInDivision, findAgent, type RosterAgent } from "../../../shared/roster";
import { findBoardMember } from "../../../shared/board";
import { PRODUCT_MARKETING_CONTEXT, skillSourceFor } from "../../../shared/skillSources";
import { TECH_TEAMS, type TechTeam } from "../../../shared/techTeams";
import { findUnit, unitsOf } from "../../../shared/units";
import { skillLabel } from "../headcount/skillFile";
import { boardDescription, boardSoul } from "./boardPersona";
import { clientCommsSection } from "./clientPersona";
import type { BriefReader } from "./privateBriefs";
import {
  gitRules,
  headEngineerSections,
  platformSections,
  projectManagerSections,
  specialistSections,
  teamOf,
  techVpFanOut,
  techVpSections,
} from "./techPersona";

function bossLabel(agent: RosterAgent, roster: readonly RosterAgent[]): string {
  if (!agent.reportsTo) return "nobody";
  if (agent.reportsTo === CEO_PROFILE) return `the CEO (\`${CEO_PROFILE}\`)`;
  const boss = findAgent(agent.reportsTo, roster);
  return boss ? `${boss.title} (\`${boss.profile}\`)` : `\`${agent.reportsTo}\``;
}

function skillNames(agent: RosterAgent): string {
  return agent.skills.map(skillLabel).join(", ");
}

/** Short routing signal for Hermes' decomposer: who this is and what they are good at. */
export function profileDescription(agent: RosterAgent): string {
  const member = agent.rank === "board" ? findBoardMember(agent.profile) : undefined;
  if (member) return boardDescription(member);
  const division = getDivision(agent.division);
  const who = agent.name ? `${agent.name}, ${agent.title}` : agent.title;
  const channels = agent.clientChannels?.length ? ` Handles client communication on ${agent.clientChannels.join(" and ")}.` : "";
  const focus = agent.focus ? ` ${agent.focus}` : "";
  const text = `${division.name} · ${who} (${agent.rank}). ${division.tagline}.${channels}${focus} Skills: ${skillNames(agent)}.`;
  return text.length <= 400 ? text : `${text.slice(0, 399)}…`;
}

function teamLines(agent: RosterAgent, roster: readonly RosterAgent[]): string[] {
  return agentsInDivision(agent.division, roster)
    .filter((a) => a.profile !== agent.profile && a.rank !== "ceo" && a.rank !== "board")
    .map((a) => {
      const unit = findUnit(a.unit);
      const external = a.external ? ` · ${a.name ?? a.title} on Claude Code: ${a.focus ?? "works this lane's tasks"}` : "";
      return `- \`${a.profile}\` — ${a.title}${unit ? ` (${unit.name})` : ""}${external}`;
    });
}

/** Studio and Growth: the unit this agent sits in, or for the VP the units they run. */
function unitSection(agent: RosterAgent): string[] {
  const unit = findUnit(agent.unit);
  if (unit) return ["## Your unit", "", `You work in the ${unit.name} unit of ${getDivision(agent.division).name}: ${unit.summary}`];
  const units = agent.rank === "vp" ? unitsOf(agent.division) : [];
  if (!units.length) return [];
  return [
    "## Your units",
    "",
    "Your team is organised in units. Everyone still reports to you; route each piece of work to the unit that owns it:",
    ...units.map((u) => `- ${u.name}: ${u.summary}`),
  ];
}

/** Agents with the marketingskills skills (`mk:`), which look for a product-marketing context file. */
export function isMarketingRole(agent: Pick<RosterAgent, "skills">): boolean {
  return agent.skills.some((id) => skillSourceFor(id)?.id === "mk");
}

function marketingContextSection(agent: RosterAgent): string[] {
  if (!isMarketingRole(agent)) return [];
  return [
    "## Marketing context",
    "",
    `- Zain's product marketing context is at \`${PRODUCT_MARKETING_CONTEXT}\`; read it before marketing work.`,
    `- Your \`mk-*\` marketing skills look for \`.agents/product-marketing.md\`: use \`${PRODUCT_MARKETING_CONTEXT}\` instead. If it is missing or thin, say so in your result rather than inventing positioning.`,
  ];
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

const BLOCK_START = "<!-- zain-hq:marketing -->";
const BLOCK_END = "<!-- /zain-hq:marketing -->";

/** The unit and marketing-context sections soulFor writes, for patching into a SOUL hired before them. */
export function marketingSections(agent: RosterAgent): string[] {
  const unit = unitSection(agent);
  const marketing = marketingContextSection(agent);
  return [...unit, ...(unit.length && marketing.length ? [""] : []), ...marketing];
}

/**
 * Adds (or replaces) a marked block with marketingSections at the end of an existing SOUL, keeping
 * everything else in it, including hand-written parts. A SOUL that soulFor wrote with the sections
 * already in place is returned unchanged.
 */
export function withMarketingBlock(soul: string, agent: RosterAgent): string {
  const sections = marketingSections(agent);
  const start = soul.indexOf(BLOCK_START);
  const end = soul.indexOf(BLOCK_END);
  const marked = start >= 0 && end > start;
  if (!marked && (!sections.length || sections.every((l) => !l.startsWith("## ") || soul.includes(l)))) return soul;
  const block = sections.length ? [BLOCK_START, ...sections, BLOCK_END].join("\n") : "";
  if (marked) {
    const before = soul.slice(0, start).replace(/\s+$/, "");
    const after = soul.slice(end + BLOCK_END.length).replace(/^\s+/, "");
    return [before, block, after].filter(Boolean).join("\n\n") + "\n";
  }
  return `${soul.replace(/\s+$/, "")}\n\n${block}\n`;
}

/** soulFor, plus a board member's private brief read from disk when its seat has one. */
export async function soulText(
  agent: RosterAgent,
  roster: readonly RosterAgent[],
  briefs: BriefReader,
  teams: readonly TechTeam[] = TECH_TEAMS,
): Promise<string> {
  const member = agent.rank === "board" ? findBoardMember(agent.profile) : undefined;
  if (member?.privateBrief) return boardSoul(member, await briefs(member.profile));
  return soulFor(agent, roster, teams);
}

/** Zain Tech roles: the VP runs repo teams, whose leads and specialists each get their own protocol. */
function techSections(agent: RosterAgent, roster: readonly RosterAgent[], teams: readonly TechTeam[]): string[] | null {
  if (agent.division !== "tech") return null;
  if (agent.rank === "vp") return techVpSections(teams, roster);
  const team = teamOf(agent, teams);
  if (!team) return agent.rank === "specialist" ? null : [];
  if (agent.teamRole === "head-engineer") return headEngineerSections(agent, team, roster);
  if (agent.teamRole === "project-manager") return projectManagerSections(agent, team, roster);
  return specialistSections(agent, team, roster);
}

export function soulFor(agent: RosterAgent, roster: readonly RosterAgent[], teams: readonly TechTeam[] = TECH_TEAMS): string {
  const member = agent.rank === "board" ? findBoardMember(agent.profile) : undefined;
  if (member) return boardSoul(member);
  const division = getDivision(agent.division);
  const lines = [
    `# ${agent.title} — ${division.name}`,
    "",
    `You are ${agent.name ? `${agent.name}, ` : ""}the ${agent.title} of ${division.name} (${division.tagline}), part of Zain Group, an agency headquartered in Riyadh.`,
    `You report to ${bossLabel(agent, roster)}. Your Hermes profile is \`${agent.profile}\`.`,
    "",
    "## How work flows at Zain Group",
    "",
    `- All work lives on the \`zain-group\` kanban board. Every ${division.name} task carries tenant \`${division.tenant}\`.`,
    "- HQ issues *mandates* to division managers (VPs; the COO for HQ). The manager fans each mandate out to their own team as subtasks.",
    "- When every subtask is done, the manager rolls the results up and requests review, which means awaiting HQ approval.",
    "- HQ approves (the mandate becomes done) or requests changes with a comment and sends it back to the manager.",
  ];
  const tech = techSections(agent, roster, teams);
  if (tech?.length) {
    lines.push("", ...tech);
  } else if (agent.rank === "vp") {
    lines.push("", "## Handling a mandate (you are the division manager)", "", ...fanOutProtocol(division, teamLines(agent, roster)));
  } else {
    lines.push(
      "",
      "## Handling your tasks",
      "",
      "- Do the task you are assigned and finish it with `kanban_complete`, including a clear result summary your manager can roll up.",
      agent.clientChannels?.length
        ? "- Request review from HQ only for client replies, as described below; do not create work for other divisions."
        : "- Do not request review from HQ and do not create work for other divisions; HQ only reviews your manager's mandates.",
      "- If you are genuinely stuck, block with the exact reason so your manager can help.",
    );
  }
  if (agent.division === "tech") {
    if (!agent.team && agent.rank === "specialist") lines.push("", ...platformSections());
    lines.push("", ...gitRules());
  }
  const unit = unitSection(agent);
  if (unit.length) lines.push("", ...unit);
  if (agent.focus && agent.division !== "tech") lines.push("", "## Your focus", "", `- ${agent.focus}`);
  const marketing = marketingContextSection(agent);
  if (marketing.length) lines.push("", ...marketing);
  const clientComms = clientCommsSection(agent);
  if (clientComms.length) lines.push("", ...clientComms);
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
export function mandateBody(
  brief: string,
  manager: RosterAgent,
  roster: readonly RosterAgent[],
  teams: readonly TechTeam[] = TECH_TEAMS,
): string {
  const division = getDivision(manager.division);
  return [
    brief || "(No further brief provided.)",
    "",
    "---",
    `**Instructions for ${manager.title} (\`${manager.profile}\`)**`,
    "",
    `This is an HQ mandate for ${division.name}. You own it end to end:`,
    "",
    ...(division.id === "tech" ? techVpFanOut(teams, roster) : fanOutProtocol(division, teamLines(manager, roster))),
  ].join("\n");
}
