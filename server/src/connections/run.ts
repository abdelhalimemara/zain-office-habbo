import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a binary directly (never through a shell); a missing binary is code 127. */
export type RunCommand = (file: string, args: string[], options: { timeoutMs: number; env?: NodeJS.ProcessEnv }) => Promise<RunResult>;

export const runCommand: RunCommand = (file, args, { timeoutMs, env }) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, env: env ?? process.env, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr });
      const e = err as NodeJS.ErrnoException & { code?: unknown; killed?: boolean };
      const code = e.code === "ENOENT" ? 127 : e.killed ? 124 : typeof e.code === "number" ? e.code : 1;
      resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });

export class ProbeTimeout extends Error {}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeout(`timed out after ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const TOKEN_LIKE = /(gh[pousr]_[A-Za-z0-9]{8,}|ntn_[A-Za-z0-9]{8,}|secret_[A-Za-z0-9]{8,}|ya29\.[\w-]+|Bearer\s+\S+|[A-Za-z0-9+/_-]{32,}={0,2})/g;

/** One plain line, with anything token-shaped (and any known secret) removed. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  out = out.replace(TOKEN_LIKE, "[redacted]").replace(/\s+/g, " ").trim();
  return out.length > 140 ? `${out.slice(0, 139)}…` : out;
}

/** Reads one key from a dotenv file (python-dotenv quoting), without logging anything. */
export async function readEnvKey(path: string, key: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    const raw = match[2]!.trim();
    if (/^'.*'$/.test(raw)) return raw.slice(1, -1);
    if (/^".*"$/.test(raw)) return raw.slice(1, -1).replace(/\\(["\\])/g, "$1");
    return raw.replace(/\s+#.*$/, "") || null;
  }
  return null;
}
