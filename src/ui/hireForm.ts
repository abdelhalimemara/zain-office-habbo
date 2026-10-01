import type { DivisionId } from "@shared/divisions";

export const PROFILE_PATTERN = /^zain-[a-z0-9-]{2,40}$/;
export const MIN_SKILLS = 1;
export const MAX_SKILLS = 15;

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveProfile(division: DivisionId, title: string): string {
  const rest = [division, slugify(title)].filter(Boolean).join("-");
  return `zain-${rest.slice(0, 40).replace(/-+$/, "")}`;
}

export interface HireFormValues {
  title: string;
  profile: string;
  skills: readonly string[];
}

export type HireFormErrors = Partial<Record<keyof HireFormValues, string>>;

export function validateHire({ title, profile, skills }: HireFormValues): HireFormErrors {
  const errors: HireFormErrors = {};
  if (!title.trim()) errors.title = "Title is required.";
  else if (title.trim().length > 80) errors.title = "Title must be 80 characters or fewer.";
  if (!PROFILE_PATTERN.test(profile)) errors.profile = "Use zain- followed by 2–40 lowercase letters, digits or dashes.";
  if (skills.length < MIN_SKILLS) errors.skills = "Pick at least one skill.";
  else if (skills.length > MAX_SKILLS) errors.skills = `Pick at most ${MAX_SKILLS} skills.`;
  return errors;
}
