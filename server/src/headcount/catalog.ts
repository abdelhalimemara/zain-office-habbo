import type { HeadcountCatalogResponse, HeadcountDepartment } from "../../../shared/api";
import { ROSTER } from "../../../shared/roster";
import { SKILL_SOURCES, skillSourceFor, type SkillSource } from "../../../shared/skillSources";
import type { FetchLike } from "../hermes/client";

/** Pinned so a hire installs reviewed skill text, not whatever `main` holds today. */
export const HEADCOUNT_REF = "98d1c17d480f606060102a781f9a8601690685f7";
const REPO = "cbrock84/headcount";
const SKILL_PATH = /^plugins\/([a-z0-9-]+)\/skills\/([a-z0-9-]+)\/SKILL\.md$/;
const SKILL_ID = /^([a-z0-9-]+):((?:[a-z0-9-]+\/)?[a-z0-9-]+)$/;
const CACHE_MS = 60 * 60 * 1000;
/**
 * A skill's supporting file relative to its folder, in a subdirectory Hermes serves to the agent
 * (tools/skill_manager_tool.py ALLOWED_SUBDIRS minus scripts/). No segment may start with a dot.
 */
export const SUPPORTING_FILE = /^(?:references|templates|assets)\/(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*$/;
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

/** Registered sources show up as one "department" each, listing only their reviewed skills. */
export function sourceDepartments(): HeadcountDepartment[] {
  return SKILL_SOURCES.map((s) => ({ id: s.id, skills: [...s.skills].sort() }));
}

export function rawSourceUrl(source: SkillSource, skill: string): string {
  return `https://raw.githubusercontent.com/${source.repo}/${encodeURIComponent(source.ref)}/${source.skillPath(skill)}`;
}

export function rosterFallback(): HeadcountDepartment[] {
  const byDept = new Map<string, Set<string>>();
  for (const id of ROSTER.flatMap((a) => a.skills)) {
    if (skillSourceFor(id)) continue;
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

/**
 * The cbrock84/headcount skill library (catalog from the GitHub tree, SKILL.md from raw) plus the
 * registered skill sources, each pinned to a reviewed commit.
 */
export class HeadcountSource {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly ref: string;
  private cached: { at: number; catalog: HeadcountCatalogResponse } | undefined;
  /** Blob paths per source; a pinned ref never changes, so a good listing is kept for the process. */
  private readonly trees = new Map<string, Promise<string[]>>();

  constructor(options: HeadcountSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.ref = encodeURIComponent(options.ref || HEADCOUNT_REF);
  }

  async catalog(): Promise<HeadcountCatalogResponse> {
    const headcount = (await this.headcountDepartments()).filter((d) => !SKILL_SOURCES.some((s) => s.id === d.id));
    return { departments: [...headcount, ...sourceDepartments()] };
  }

  private async headcountDepartments(): Promise<HeadcountDepartment[]> {
    if (this.cached && this.now() - this.cached.at < CACHE_MS) return this.cached.catalog.departments;
    try {
      const url = `https://api.github.com/repos/${REPO}/git/trees/${this.ref}?recursive=1`;
      const res = await this.get(url, { Accept: "application/vnd.github+json" });
      const data = (await res.json()) as { tree?: unknown };
      if (!Array.isArray(data.tree)) throw new Error("GitHub tree response has no tree");
      const departments = parseTree(data.tree);
      if (departments.length === 0) throw new Error("GitHub tree has no headcount skills");
      this.cached = { at: this.now(), catalog: { departments } };
      return departments;
    } catch {
      return rosterFallback();
    }
  }

  async hasSkill(id: string): Promise<boolean> {
    const parsed = parseSkillId(id);
    if (!parsed) return false;
    const source = skillSourceFor(id);
    if (source) return source.skills.includes(parsed.skill);
    if (parsed.skill.includes("/")) return false;
    const departments = await this.headcountDepartments();
    return departments.some((d) => d.id === parsed.department && d.skills.includes(parsed.skill));
  }

  async skillMarkdown(id: string): Promise<string> {
    const parsed = parseSkillId(id);
    if (!parsed) throw new Error(`invalid skill id ${id}`);
    const source = skillSourceFor(id);
    if (source && !source.skills.includes(parsed.skill)) throw new Error(`${id} is not a reviewed ${source.id} skill`);
    if (!source && parsed.skill.includes("/")) throw new Error(`invalid skill id ${id}`);
    const url = source
      ? rawSourceUrl(source, parsed.skill)
      : `https://raw.githubusercontent.com/${REPO}/${this.ref}/plugins/${parsed.department}/skills/${parsed.skill}/SKILL.md`;
    const res = await this.get(url, {});
    return res.text();
  }

  /** Supporting files of a multi-file source skill (see SkillSource.skillDir), relative to its folder. */
  async supportingFiles(id: string): Promise<string[]> {
    const target = this.sourceSkill(id);
    if (!target) return [];
    const prefix = `${target.dir}/`;
    return (await this.sourceTree(target.source))
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length))
      .filter((p) => SUPPORTING_FILE.test(p))
      .sort();
  }

  async supportingFile(id: string, path: string): Promise<string> {
    const target = this.sourceSkill(id);
    if (!target || !SUPPORTING_FILE.test(path)) throw new Error(`invalid supporting file ${path} for ${id}`);
    const { source, dir } = target;
    const file = `${dir}/${path}`.split("/").map(encodeURIComponent).join("/");
    const res = await this.get(`https://raw.githubusercontent.com/${source.repo}/${encodeURIComponent(source.ref)}/${file}`, {});
    return res.text();
  }

  private sourceSkill(id: string): { source: SkillSource; dir: string } | null {
    const parsed = parseSkillId(id);
    const source = skillSourceFor(id);
    if (!parsed || !source?.skillDir || !source.skills.includes(parsed.skill)) return null;
    return { source, dir: source.skillDir(parsed.skill) };
  }

  private sourceTree(source: SkillSource): Promise<string[]> {
    let tree = this.trees.get(source.id);
    if (!tree) {
      const url = `https://api.github.com/repos/${source.repo}/git/trees/${encodeURIComponent(source.ref)}?recursive=1`;
      tree = this.get(url, { Accept: "application/vnd.github+json" }).then(async (res) => {
        const data = (await res.json()) as { tree?: { path?: unknown; type?: unknown }[]; truncated?: unknown };
        if (!Array.isArray(data.tree) || data.truncated === true) throw new Error(`GitHub tree for ${source.repo} is incomplete`);
        return data.tree.flatMap((e) => (e.type === "blob" && typeof e.path === "string" ? [e.path] : []));
      });
      tree.catch(() => this.trees.delete(source.id));
      this.trees.set(source.id, tree);
    }
    return tree;
  }

  private async get(url: string, headers: Record<string, string>): Promise<Response> {
    const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
    return res;
  }
}
