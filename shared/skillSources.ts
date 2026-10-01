/**
 * Skill repositories besides headcount. A skill id is `<source>:<skill>`; ids whose prefix is not a
 * registered source are headcount `department:skill`. Every source is pinned to a reviewed commit.
 */
export interface SkillSource {
  id: string;
  repo: string;
  ref: string;
  /** Repo path of a skill's SKILL.md. */
  skillPath: (skill: string) => string;
  /** Prefix for the Hermes skill name, e.g. `hz` → `hz-pricing-strategy`. */
  hermesPrefix: string;
  /** Hermes skill category. */
  category: string;
  license: string;
  /** Reviewed skills that agents may install; anything else in the repo is ignored. */
  skills: readonly string[];
}

export const SKILL_SOURCES: readonly SkillSource[] = [
  {
    id: "hormozi",
    repo: "alexsmedile/hormozi-skills",
    ref: "25ec2b0789ae8c760b45f577024782ff399983a6",
    skillPath: (skill) => `skills/${skill}/SKILL.md`,
    hermesPrefix: "hz",
    category: "board-hormozi",
    license: "MIT",
    skills: [
      "audit-offer",
      "bonus-stack",
      "business-model",
      "dfy-dwy-diy",
      "effort-reduction",
      "hormozi-hooks",
      "hormozi-offer",
      "hormozi-pitch",
      "idea-to-product",
      "landing-page-copy",
      "market-research",
      "objection-destroyer",
      "offer-angles",
      "pricing-strategy",
      "productize",
      "value-accelerator",
      "value-perception",
    ],
  },
];

export function skillSourceFor(skillId: string): SkillSource | undefined {
  const prefix = skillId.split(":", 1)[0];
  return SKILL_SOURCES.find((s) => s.id === prefix);
}

export function sourceSkillIds(source: SkillSource): string[] {
  return source.skills.map((skill) => `${source.id}:${skill}`);
}
