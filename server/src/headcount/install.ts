import { lstat, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { HermesError, type HermesClient } from "../hermes/client";
import { SUPPORTING_FILE, type HeadcountSource } from "./catalog";
import { toHermesSkill } from "./skillFile";

/**
 * Writes a skill's supporting files next to its SKILL.md. Hermes' HTTP API only creates SKILL.md
 * (skill_manage's write_file is agent-only), so these go straight to the skill folder Hermes reports.
 */
export interface SkillFileSink {
  /** Writes `path` (relative to the skill folder) unless it exists; true when written. */
  write(skillMd: string, path: string, content: string): Promise<boolean>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Disk writes only make sense when Hermes runs on this machine; elsewhere supporting files are skipped. */
export function skillFilesFor(hermesBaseUrl: string): SkillFileSink | undefined {
  try {
    return LOOPBACK.has(new URL(hermesBaseUrl).hostname) ? diskSkillFiles() : undefined;
  } catch {
    return undefined;
  }
}

export function diskSkillFiles(): SkillFileSink {
  return {
    async write(skillMd, path, content) {
      const dir = dirname(skillMd);
      if (!isAbsolute(skillMd) || basename(skillMd) !== "SKILL.md" || !dir.split(sep).includes("skills")) {
        throw new Error(`refusing to write next to ${skillMd}: not a Hermes SKILL.md`);
      }
      if (!SUPPORTING_FILE.test(path)) throw new Error(`refusing supporting file path ${path}`);
      const stat = await lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`skill folder ${dir} is not a plain directory`);
      const target = resolve(dir, path);
      if (!target.startsWith(dir + sep)) throw new Error(`refusing supporting file path ${path}`);
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(target, content, { encoding: "utf8", flag: "wx" });
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw err;
      }
    },
  };
}

export interface SkillInstallDeps {
  hermes: HermesClient;
  headcount: HeadcountSource;
  /** Omitted when Hermes is remote: multi-file skills then install their SKILL.md only. */
  files?: SkillFileSink;
}

export interface SkillInstall {
  /** False when the profile already had the skill. */
  created: boolean;
  /** Supporting files written now (files already present are left as they are). */
  filesWritten: number;
}

/**
 * Installs one roster skill into a profile the way hiring does: the upstream SKILL.md rewritten for
 * Hermes, then any missing supporting files. Idempotent, so a failed install can simply be retried.
 */
export async function installSkill(deps: SkillInstallDeps, profile: string, id: string): Promise<SkillInstall> {
  const skill = toHermesSkill(id, await deps.headcount.skillMarkdown(id));
  let created = true;
  try {
    await deps.hermes.createSkill({ ...skill, profile });
  } catch (err) {
    if (!(err instanceof HermesError && err.status === 400 && /already exists/i.test(err.detail))) throw err;
    created = false;
  }
  let filesWritten = 0;
  const sink = deps.files;
  if (!sink) return { created, filesWritten };
  const files = await deps.headcount.supportingFiles(id);
  if (!files.length) return { created, filesWritten };
  const skillMd = await deps.hermes.skillPath(profile, skill.name);
  for (const path of files) {
    if (await sink.write(skillMd, path, await deps.headcount.supportingFile(id, path))) filesWritten++;
  }
  return { created, filesWritten };
}
