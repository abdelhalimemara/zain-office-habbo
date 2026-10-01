/** Hire validation shared by the hire form and the server (which also checks the live catalog). */

export const PROFILE_PATTERN = /^zain-[a-z0-9-]{2,40}$/;
export const TITLE_MAX = 60;
export const MIN_SKILLS = 1;
export const MAX_SKILLS = 20;
/** `department:skill` for headcount, `<source>:skill` for a registered skill source. */
export const SKILL_ID_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;

export interface HireFields {
  profile: string;
  title: string;
  skills: readonly string[];
}

export type HireFieldErrors = Partial<Record<keyof HireFields, string>>;

export function hireFieldErrors({ profile, title, skills }: HireFields): HireFieldErrors {
  const errors: HireFieldErrors = {};
  const t = title.trim();
  if (!t) errors.title = "Title is required.";
  else if (t.length > TITLE_MAX) errors.title = `Title must be ${TITLE_MAX} characters or fewer.`;
  if (!PROFILE_PATTERN.test(profile)) errors.profile = "Use zain- followed by 2–40 lowercase letters, digits or dashes.";
  if (skills.length < MIN_SKILLS) errors.skills = "Pick at least one skill.";
  else if (skills.length > MAX_SKILLS) errors.skills = `Pick at most ${MAX_SKILLS} skills.`;
  else if (skills.some((s) => !SKILL_ID_PATTERN.test(s))) errors.skills = "Skills must be ids like department:skill.";
  return errors;
}
