import type { DivisionId } from "@shared/divisions";

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
