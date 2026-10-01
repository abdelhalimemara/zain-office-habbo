import { skillSourceFor } from "../../../shared/skillSources";
import { parseSkillId } from "./catalog";

/**
 * Hermes skill rules (tools/skill_manager_tool.py): name /^[a-z0-9][a-z0-9._-]*$/ ≤ 64 chars,
 * frontmatter with `name` + `description`, and a new skill's description must fit the
 * 60-char system-prompt budget (agent/skill_utils.py SKILL_PROMPT_DESC_LIMIT).
 */
export const SKILL_CATEGORY = "headcount";
const NAME_MAX = 64;
const DESCRIPTION_MAX = 60;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n/;

/**
 * `marketing:brand-voice` → `hc-marketing-brand-voice`, `hormozi:pricing-strategy` →
 * `hz-pricing-strategy` (the source's prefix); prefixes keep clear of cloned default skills.
 */
export function hermesSkillName(id: string): string {
  const parsed = parseSkillId(id);
  if (!parsed) throw new Error(`invalid skill id ${id}`);
  const source = skillSourceFor(id);
  const name = source ? `${source.hermesPrefix}-${parsed.skill}` : `hc-${parsed.department}-${parsed.skill}`;
  return name.slice(0, NAME_MAX).replace(/[-.]+$/, "");
}

export function skillCategory(id: string): string {
  return skillSourceFor(id)?.category ?? SKILL_CATEGORY;
}

export function humanize(slug: string): string {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function shortDescription(department: string, skill: string): string {
  const full = `${humanize(skill)} (${department}).`;
  if (full.length <= DESCRIPTION_MAX) return full;
  const bare = `${humanize(skill)}.`;
  return bare.length <= DESCRIPTION_MAX ? bare : `${bare.slice(0, DESCRIPTION_MAX - 1).trimEnd()}.`;
}

function upstreamDescription(frontmatter: string): string | null {
  const match = /^description:\s*(.+)$/m.exec(frontmatter);
  if (!match?.[1]) return null;
  return match[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
}

function attribution(id: string): string {
  const source = skillSourceFor(id);
  if (!source) return `> Headcount skill \`${id}\` (github.com/cbrock84/headcount).`;
  return `> Skill \`${id}\` from github.com/${source.repo} at ${source.ref.slice(0, 12)} (${source.license}).`;
}

/** Rewrites an upstream SKILL.md so Hermes accepts it as a new skill in the right category. */
export function toHermesSkill(id: string, upstream: string): { name: string; content: string; category: string } {
  const parsed = parseSkillId(id);
  if (!parsed) throw new Error(`invalid skill id ${id}`);
  const name = hermesSkillName(id);
  const source = upstream.replace(/^﻿/, "");
  const fm = FRONTMATTER.exec(source);
  const body = (fm ? source.slice(fm[0].length) : source).trim();
  if (!body) throw new Error(`skill ${id} has an empty SKILL.md`);
  const whenToUse = fm ? upstreamDescription(fm[1]!) : null;
  const content = [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(shortDescription(parsed.department, parsed.skill))}`,
    "---",
    "",
    attribution(id),
    ...(whenToUse ? ["", `**When to use:** ${whenToUse}`] : []),
    "",
    body,
    "",
  ].join("\n");
  return { name, content, category: skillCategory(id) };
}
