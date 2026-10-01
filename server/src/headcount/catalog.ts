import type { HeadcountCatalogResponse, HeadcountDepartment } from "../../../shared/api";
import { ROSTER } from "../../../shared/roster";
import type { FetchLike } from "../hermes/client";

/** Pinned so a hire installs reviewed skill text, not whatever `main` holds today. */
export const HEADCOUNT_REF = "98d1c17d480f606060102a781f9a8601690685f7";
const REPO = "cbrock84/headcount";
const SKILL_PATH = /^plugins\/([a-z0-9-]+)\/skills\/([a-z0-9-]+)\/SKILL\.md$/;
const SKILL_ID = /^([a-z0-9-]+):([a-z0-9-]+)$/;
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface HeadcountSourceOptions {
  fetchImpl?: FetchLike;
  /** Git ref for the tree and raw SKILL.md URLs; defaults to HEADCOUNT_REF. */
  ref?: string;
  now?: () => number;
}

export function parseSkillId(id: string): { department: string; skill: string } | null {
  const match = SKILL_ID.exec(id);
  return match ? { department: match[1]!, skill: match[2]! } : null;
}

export function parseTree(tree: { path?: unknown; type?: unknown }[]): HeadcountDepartment[] {
  const byDept = new Map<string, Set<string>>();
  for (const entry of tree) {
    if (entry.type !== "blob" || typeof entry.path !== "string") continue;
    const match = SKILL_PATH.exec(entry.path);
    if (!match) continue;
    const skills = byDept.get(match[1]!) ?? new Set<string>();
    skills.add(match[2]!);
    byDept.set(match[1]!, skills);
  }
  return toDepartments(byDept);
}

export function rosterFallback(): HeadcountDepartment[] {
  const byDept = new Map<string, Set<string>>();
  for (const id of ROSTER.flatMap((a) => a.skills)) {
    const parsed = parseSkillId(id);
    if (!parsed) continue;
    const skills = byDept.get(parsed.department) ?? new Set<string>();
    skills.add(parsed.skill);
    byDept.set(parsed.department, skills);
  }
  return toDepartments(byDept);
}

function toDepartments(byDept: Map<string, Set<string>>): HeadcountDepartment[] {
  return [...byDept.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, skills]) => ({ id, skills: [...skills].sort() }));
}

/** The cbrock84/headcount skill library: catalog from the GitHub tree, SKILL.md from raw. */
export class HeadcountSource {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly ref: string;
  private cached: { at: number; catalog: HeadcountCatalogResponse } | undefined;

  constructor(options: HeadcountSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.ref = encodeURIComponent(options.ref || HEADCOUNT_REF);
  }

  async catalog(): Promise<HeadcountCatalogResponse> {
    if (this.cached && this.now() - this.cached.at < CACHE_MS) return this.cached.catalog;
    try {
      const url = `https://api.github.com/repos/${REPO}/git/trees/${this.ref}?recursive=1`;
      const res = await this.get(url, { Accept: "application/vnd.github+json" });
      const data = (await res.json()) as { tree?: unknown };
      if (!Array.isArray(data.tree)) throw new Error("GitHub tree response has no tree");
      const departments = parseTree(data.tree);
      if (departments.length === 0) throw new Error("GitHub tree has no headcount skills");
      this.cached = { at: this.now(), catalog: { departments } };
      return this.cached.catalog;
    } catch {
      return { departments: rosterFallback() };
    }
  }

  async hasSkill(id: string): Promise<boolean> {
    const parsed = parseSkillId(id);
    if (!parsed) return false;
    const { departments } = await this.catalog();
    return departments.some((d) => d.id === parsed.department && d.skills.includes(parsed.skill));
  }

  async skillMarkdown(id: string): Promise<string> {
    const parsed = parseSkillId(id);
    if (!parsed) throw new Error(`invalid headcount skill id ${id}`);
    const url = `https://raw.githubusercontent.com/${REPO}/${this.ref}/plugins/${parsed.department}/skills/${parsed.skill}/SKILL.md`;
    const res = await this.get(url, {});
    return res.text();
  }

  private async get(url: string, headers: Record<string, string>): Promise<Response> {
    const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
    return res;
  }
}
