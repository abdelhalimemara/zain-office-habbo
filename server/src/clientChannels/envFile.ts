import { chmod, copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const ACCOUNTS_PROFILE = "zain-hq-accounts";

export function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HERMES_HOME || join(homedir(), ".hermes");
}

/** `default` keeps its .env at the Hermes home root; named profiles under profiles/<name>/. */
export function profileEnvPath(profile: string, home = hermesHome()): string {
  return profile === "default" ? join(home, ".env") : join(home, "profiles", profile, ".env");
}

/**
 * Hermes loads .env with python-dotenv's parser: single quotes are literal (no escapes and no
 * `${VAR}` interpolation), so they are preferred; values holding a quote fall back to escaped
 * double quotes, which is only safe without `${`.
 */
export function formatEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("values cannot contain line breaks");
  if (!value.includes("'")) return `'${value}'`;
  if (value.includes("${")) throw new Error("values cannot contain both ' and ${");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Replaces or appends each key, keeping every other line (comments included) as it was. */
export function upsertEnvText(existing: string, entries: Readonly<Record<string, string>>): string {
  const pending = new Map(Object.entries(entries));
  const lines = existing ? existing.replace(/\n$/, "").split("\n") : [];
  const out = lines.map((line) => {
    const key = ENV_LINE.exec(line)?.[1];
    if (!key || !pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${formatEnvValue(value)}`;
  });
  for (const [key, value] of pending) out.push(`${key}=${formatEnvValue(value)}`);
  return `${out.join("\n")}\n`;
}

export interface EnvWriteResult {
  path: string;
  backup: string | null;
  keys: string[];
}

/** Backs the file up (mode 600) before an atomic, mode-600 rewrite. Never returns or logs values. */
export async function writeEnvFile(path: string, entries: Readonly<Record<string, string>>, now = new Date()): Promise<EnvWriteResult> {
  let existing = "";
  let backup: string | null = null;
  try {
    existing = await readFile(path, "utf8");
    backup = `${path}.backup-${now.toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(path, backup);
    await chmod(backup, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, upsertEnvText(existing, entries), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  return { path, backup, keys: Object.keys(entries) };
}
