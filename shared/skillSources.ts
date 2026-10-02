import { AGENCY_SKILLS } from "./agencySkills";

/**
 * Skill repositories besides headcount. A skill id is `<source>:<skill>`, where a source skill may
 * sit in one subdirectory (`agency:engineering/engineering-sre`); ids whose prefix is not a
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
  /** `persona`: each file is an agent persona (frontmatter + body) installed as a role playbook. */
  format?: "skill" | "persona";
  /**
   * Repo directory of a multi-file skill. When set, its `references/`, `templates/` and `assets/` files
   * are installed next to SKILL.md.
   */
  skillDir?: (skill: string) => string;
  /** Lines added under the attribution of every installed skill from this source. */
  notes?: readonly string[];
}

/** Zain's product-marketing context, drafted by the VPs; the marketing skills look for it before any task. */
export const PRODUCT_MARKETING_CONTEXT = "~/ZainGroup/product-marketing.md";

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
  {
    id: "agency",
    repo: "msitarzewski/agency-agents",
    ref: "d3f71c4bb8922d3eea7576237a870dd59b3cdd52",
    skillPath: (skill) => `${skill}.md`,
    hermesPrefix: "ag",
    category: "zain-tech-agency",
    license: "MIT",
    skills: AGENCY_SKILLS,
    format: "persona",
  },
  {
    // Not "marketing": that id is the headcount marketing department (`marketing:brand-voice`).
    id: "mk",
    repo: "coreyhaines31/marketingskills",
    ref: "0baf720ab0c3793aa46beb4b7a7d331d51bf7a00",
    skillPath: (skill) => `skills/${skill}/SKILL.md`,
    skillDir: (skill) => `skills/${skill}`,
    hermesPrefix: "mk",
    category: "zain-marketing",
    license: "MIT",
    skills: [
      "ab-testing", "ad-creative", "ads", "ai-seo", "analytics", "aso", "attribution", "churn-prevention",
      "co-marketing", "cold-email", "community-marketing", "competitor-profiling", "competitors",
      "content-strategy", "copy-editing", "copywriting", "cro", "customer-research", "directory-submissions",
      "emails", "events", "free-tools", "image", "influencer-marketing", "launch", "lead-magnets",
      "marketing-council", "marketing-ideas", "marketing-loops", "marketing-plan", "marketing-psychology",
      "offers", "onboarding", "paywalls", "popups", "pricing", "product-marketing", "programmatic-seo",
      "prospecting", "public-relations", "referrals", "revops", "sales-enablement", "schema", "seo-audit",
      "signup", "site-architecture", "sms", "social", "video",
    ],
    notes: [
      `Zain's product marketing context is at \`${PRODUCT_MARKETING_CONTEXT}\`: read it wherever this skill says \`.agents/product-marketing.md\`.`,
      "Other skills this one names are installed with the `mk-` prefix (`copywriting` is `mk-copywriting`).",
      "Files cited as `references/...` are in this skill's own folder.",
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
