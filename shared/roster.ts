import { BOARD_MEMBERS } from "./board";
import type { DivisionId } from "./divisions";
import { TECH_TEAM_ROSTER } from "./techRoster";
import type { TeamRole } from "./techTeams";

export type Rank = "board" | "ceo" | "vp" | "lead" | "specialist";

export interface RosterAgent {
  /** Hermes profile name. */
  profile: string;
  title: string;
  division: DivisionId;
  rank: Rank;
  /** Profile this agent reports to; null for the CEO and the board, who advise rather than report. */
  reportsTo: string | null;
  /** Skill ids: headcount `department:skill` or `<source>:skill` (see skillSources.ts). */
  skills: string[];
  /** Reviewer-class (headcount security / legal-risk): may block work it reviews. */
  reviewer?: boolean;
  /** Person name for agents with a persona (e.g. "Ahmad Al Zain"). */
  name?: string;
  /** External channels this agent talks to clients on. */
  clientChannels?: readonly ("email" | "whatsapp")[];
  /** Zain Tech repo team id (see shared/techTeams.ts). */
  team?: string;
  /** Role within `team`: the Head Engineer and Project Manager lead it; specialists report to the Head Engineer. */
  teamRole?: TeamRole;
  /** One line on what this agent works on (for repo teams: the part of the stack they own). */
  focus?: string;
  /** Sub-team inside a Studio or Growth division (see shared/units.ts); reporting stays with the VP. */
  unit?: string;
}

export const CEO_PROFILE = "default";

/** coreyhaines31/marketingskills skill ids (source `mk`, shared/skillSources.ts). */
const mk = (...skills: string[]) => skills.map((s) => `mk:${s}`);
export const COO_PROFILE = "zain-hq-coo";

const hq: RosterAgent[] = [
  { profile: CEO_PROFILE, name: "Susu", title: "CEO · Main Hermes", division: "hq", rank: "ceo", reportsTo: null,
    skills: ["executive:chief-executive", "executive:ceo-advisor", "executive:agent-hierarchy"] },
  { profile: "zain-hq-musfir", name: "Musfir", title: "Partner's Assistant (Abdullah)", division: "hq", rank: "lead", reportsTo: CEO_PROFILE,
    skills: ["executive:ceo-advisor", "operations:operating-cadence"] },
  { profile: COO_PROFILE, name: "Faisal Al-Harbi", title: "COO", division: "hq", rank: "vp", reportsTo: CEO_PROFILE,
    skills: ["operations:chief-operating-officer", "operations:operating-cadence", "operations:process-design", "pmo:portfolio-governance"] },
  { profile: "zain-hq-ops", title: "Ops / PMO Lead", division: "hq", rank: "lead", reportsTo: COO_PROFILE,
    skills: ["pmo:program-management", "pmo:dependency-and-risk-management", "operations:service-level-management"] },
  { profile: "zain-hq-care", title: "Customer Care Lead", division: "hq", rank: "lead", reportsTo: COO_PROFILE,
    skills: ["customer-experience:support-operations", "customer-experience:escalation-management", "customer-experience:self-service-and-knowledge"] },
  { profile: "zain-hq-accounts", name: "Ahmad Al Zain", title: "Account Management Lead", division: "hq", rank: "lead",
    reportsTo: COO_PROFILE, clientChannels: ["email", "whatsapp"],
    skills: ["customer-experience:customer-success-management", "customer-experience:customer-onboarding-and-implementation", "revenue:retention"] },
  { profile: "zain-hq-finance", title: "Finance Lead", division: "hq", rank: "lead", reportsTo: COO_PROFILE,
    skills: ["finance:chief-financial-officer", "finance:budgeting-and-forecasting", "finance:financial-reporting-and-close", "finance:tax"] },
  { profile: "zain-hq-people", title: "People / HR Lead", division: "hq", rank: "lead", reportsTo: COO_PROFILE,
    skills: ["people:hiring-and-interviewing", "people:org-design", "people:onboarding-and-offboarding"] },
  { profile: "zain-hq-legal", title: "Legal & Risk", division: "hq", rank: "lead", reportsTo: COO_PROFILE, reviewer: true,
    skills: ["legal-risk:contract-review", "legal-risk:privacy-and-data-protection", "legal-risk:regulatory-compliance"] },
];

const studio: RosterAgent[] = [
  { profile: "zain-studio-vp", name: "Lina Haddad", title: "VP Studio", division: "studio", rank: "vp", reportsTo: CEO_PROFILE,
    skills: ["marketing:chief-content-officer", "product:chief-product-officer",
      ...mk("product-marketing", "content-strategy", "marketing-psychology", "marketing-plan")] },
  { profile: "zain-studio-art", title: "Art Director", division: "studio", rank: "specialist", reportsTo: "zain-studio-vp", unit: "creative",
    skills: ["marketing:visual-content", "product:design-system", "product:visual-reference-generation", ...mk("image", "ad-creative")] },
  { profile: "zain-studio-video", title: "Video Producer", division: "studio", rank: "specialist", reportsTo: "zain-studio-vp", unit: "creative",
    skills: ["marketing:video-content", "marketing:youtube-producer", ...mk("video", "ad-creative")] },
  { profile: "zain-studio-copy", title: "Copywriter", division: "studio", rank: "specialist", reportsTo: "zain-studio-vp", unit: "creative",
    skills: ["marketing:marketing-copywriting", "marketing:social-post-craft", "marketing:newsletter-writer",
      ...mk("copywriting", "copy-editing", "marketing-psychology")] },
  { profile: "zain-studio-social", name: "Dana Al-Shammari", title: "Organic Social Lead", division: "studio", rank: "specialist",
    reportsTo: "zain-studio-vp", unit: "organic",
    skills: mk("social", "community-marketing", "influencer-marketing", "content-strategy") },
  { profile: "zain-studio-content", name: "Karim Mansour", title: "Content & PR Lead", division: "studio", rank: "specialist",
    reportsTo: "zain-studio-vp", unit: "organic",
    skills: mk("content-strategy", "public-relations", "copywriting", "ai-seo") },
  { profile: "zain-studio-seo-writer", name: "Yara Saeed", title: "SEO Content Writer", division: "studio", rank: "specialist",
    reportsTo: "zain-studio-vp", unit: "organic",
    skills: mk("seo-audit", "ai-seo", "programmatic-seo", "content-strategy", "copywriting", "copy-editing", "schema") },
  { profile: "zain-studio-brand", title: "Brand Strategist", division: "studio", rank: "specialist", reportsTo: "zain-studio-vp", unit: "design",
    skills: ["product:brand-identity", "marketing:positioning-and-messaging", "marketing:brand-voice", ...mk("product-marketing", "customer-research")] },
  { profile: "zain-studio-ux", name: "Ziad Farouk", title: "UX / Web Designer", division: "studio", rank: "specialist", reportsTo: "zain-studio-vp", unit: "design",
    skills: ["product:interface-craft", "product:ux-product-auditor", "product:design-styles",
      ...mk("site-architecture", "cro", "signup", "onboarding")] },
];

const growth: RosterAgent[] = [
  { profile: "zain-growth-vp", name: "Omar Khalid", title: "VP Growth", division: "growth", rank: "vp", reportsTo: CEO_PROFILE,
    skills: ["marketing:chief-marketing-officer", "marketing:marketing-planning",
      ...mk("marketing-plan", "marketing-council", "marketing-loops", "offers", "pricing", "launch", "analytics", "revops")] },
  { profile: "zain-growth-paid", title: "Paid Ads Manager", division: "growth", rank: "specialist", reportsTo: "zain-growth-vp", unit: "performance",
    skills: ["demand-generation:paid-advertising", "demand-generation:experimentation", ...mk("ads", "ad-creative", "attribution", "ab-testing")] },
  { profile: "zain-growth-cro", title: "CRO Specialist", division: "growth", rank: "specialist", reportsTo: "zain-growth-vp", unit: "performance",
    skills: ["demand-generation:landing-page-cro-expert", "demand-generation:lead-capture",
      ...mk("cro", "ab-testing", "signup", "onboarding", "popups", "paywalls", "lead-magnets", "free-tools")] },
  { profile: "zain-growth-analyst", title: "Marketing Analyst", division: "growth", rank: "specialist", reportsTo: "zain-growth-vp", unit: "performance",
    skills: ["demand-generation:marketing-analytics", "data-analytics:quantitative-analysis",
      ...mk("analytics", "attribution", "customer-research", "competitor-profiling")] },
  { profile: "zain-growth-seo", title: "SEO & AI Search", division: "growth", rank: "specialist", reportsTo: "zain-growth-vp", unit: "growth",
    skills: ["demand-generation:seo-strategy", "demand-generation:ai-search-optimization", "demand-generation:programmatic-seo",
      ...mk("seo-audit", "ai-seo", "programmatic-seo", "schema", "site-architecture", "competitors", "aso", "directory-submissions")] },
  { profile: "zain-growth-lifecycle", title: "Lifecycle / CRM", division: "growth", rank: "specialist", reportsTo: "zain-growth-vp", unit: "growth",
    skills: ["demand-generation:lifecycle-messaging", "marketing:newsletter-writer",
      ...mk("emails", "sms", "churn-prevention", "referrals", "onboarding")] },
  { profile: "zain-growth-campaigns", title: "Campaign Planner", division: "growth", rank: "specialist", reportsTo: "zain-growth-vp", unit: "growth",
    skills: ["marketing:marketing-campaign-planner", "marketing:partnership-marketing",
      ...mk("launch", "events", "co-marketing", "influencer-marketing", "marketing-ideas")] },
  { profile: "zain-growth-audit", name: "Rami Saleh", title: "Prospect Audit Lead", division: "growth", rank: "specialist",
    reportsTo: "zain-growth-vp", unit: "growth",
    focus: "Runs prospect audits (SEO, competitors, ads, analytics) that Zain Growth sends to potential clients.",
    skills: mk("seo-audit", "competitors", "competitor-profiling", "ads", "analytics", "prospecting") },
  { profile: "zain-growth-outbound", name: "Hadi Nasser", title: "Outbound & Partnerships", division: "growth", rank: "specialist",
    reportsTo: "zain-growth-vp", unit: "growth",
    focus: "Prospect lists, outreach drafts and partner pitches. Ahmad (zain-hq-accounts) sends every client and prospect email; you never contact anyone outside Zain yourself.",
    skills: mk("prospecting", "cold-email", "sales-enablement", "co-marketing") },
];

const labs: RosterAgent[] = [
  { profile: "zain-labs-vp", name: "Noura Al-Qahtani", title: "VP Labs", division: "labs", rank: "vp", reportsTo: CEO_PROFILE,
    skills: ["revenue:chief-revenue-officer", "executive:business-growth-consultant"] },
  { profile: "zain-labs-deals", title: "Partnerships & Deals", division: "labs", rank: "specialist", reportsTo: "zain-labs-vp",
    skills: ["revenue:deal-negotiation", "corporate-strategy:strategic-alliances"] },
  { profile: "zain-labs-venture", title: "Venture Analyst", division: "labs", rank: "specialist", reportsTo: "zain-labs-vp",
    skills: ["executive:saas-idea-validator", "executive:ai-research-analyst", "corporate-strategy:market-entry"] },
  { profile: "zain-labs-pricing", title: "Pricing & Unit Economics", division: "labs", rank: "specialist", reportsTo: "zain-labs-vp",
    skills: ["revenue:pricing-and-packaging", "finance:unit-economics"] },
  { profile: "zain-labs-retention", title: "Retention & Activation", division: "labs", rank: "specialist", reportsTo: "zain-labs-vp",
    skills: ["revenue:retention", "revenue:activation", "revenue:referral-programs"] },
  { profile: "zain-labs-revops", title: "RevOps Analyst", division: "labs", rank: "specialist", reportsTo: "zain-labs-vp",
    skills: ["revenue:revenue-operations", "data-analytics:business-intelligence"] },
];

const tech: RosterAgent[] = [
  { profile: "zain-tech-vp", name: "Yousef Al-Mutairi", title: "VP Tech", division: "tech", rank: "vp", reportsTo: CEO_PROFILE,
    skills: ["technology:chief-technology-officer", "technology:solution-architecture"] },
  { profile: "zain-tech-fullstack", title: "Full-stack Engineer", division: "tech", rank: "specialist", reportsTo: "zain-tech-vp",
    skills: ["technology:test-driven-development", "technology:api-design", "technology:systematic-debugging"] },
  { profile: "zain-tech-ai", title: "AI Workflow Engineer", division: "tech", rank: "specialist", reportsTo: "zain-tech-vp",
    skills: ["technology:ai-workflow-architect", "technology:prompt-optimizer"] },
  { profile: "zain-tech-devops", title: "DevOps / Cloud", division: "tech", rank: "specialist", reportsTo: "zain-tech-vp",
    skills: ["technology:cloud-infrastructure", "technology:release-and-deployment", "technology:observability-and-reliability"] },
  { profile: "zain-tech-qa", title: "QA & Code Review", division: "tech", rank: "specialist", reportsTo: "zain-tech-vp",
    skills: ["technology:code-review", "technology:completion-verification"] },
  { profile: "zain-tech-security", title: "Security Reviewer", division: "tech", rank: "specialist", reportsTo: "zain-tech-vp", reviewer: true,
    skills: ["security:security-architecture-review", "security:threat-modeling"] },
];

const board: RosterAgent[] = BOARD_MEMBERS.map((m) => ({
  profile: m.profile,
  title: m.title ?? `Board · ${m.name}`,
  division: "hq",
  rank: "board",
  reportsTo: null,
  skills: m.skills,
}));

export const ROSTER: readonly RosterAgent[] = [...hq, ...board, ...studio, ...growth, ...labs, ...tech, ...TECH_TEAM_ROSTER];

export function boardMembers(roster: readonly RosterAgent[] = ROSTER): RosterAgent[] {
  return roster.filter((a) => a.rank === "board");
}

export function agentsInDivision(division: DivisionId, roster: readonly RosterAgent[] = ROSTER): RosterAgent[] {
  return roster.filter((a) => a.division === division);
}

/** The manager who receives HQ mandates for a division (the COO for HQ support floors). */
export function managerOf(division: DivisionId, roster: readonly RosterAgent[] = ROSTER): RosterAgent {
  const vp = roster.find((a) => a.division === division && a.rank === "vp");
  if (!vp) throw new Error(`Division ${division} has no VP`);
  return vp;
}

export function findAgent(profile: string, roster: readonly RosterAgent[] = ROSTER): RosterAgent | undefined {
  return roster.find((a) => a.profile === profile);
}

/** "Ahmad Al Zain · Account Management Lead" when named, else the title. */
export function displayName(agent: Pick<RosterAgent, "name" | "title">): string {
  return agent.name ? `${agent.name} · ${agent.title}` : agent.title;
}
