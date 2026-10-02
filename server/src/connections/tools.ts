import { createHash } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hermesHome } from "../clientChannels/hermesPaths";
import type { HermesClient, HermesStatus, McpServer } from "../hermes/client";
import type { Entry } from "./channels";
import { readEnvKey, redact, type RunCommand } from "./run";

const CLI_TIMEOUT_MS = 8000;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** The remote URL an `npx mcp-remote <url>` stdio server proxies to. */
export function mcpRemoteUrl(server: McpServer): string | null {
  if (server.transport !== "stdio" || !server.args.some((a) => a.startsWith("mcp-remote"))) return null;
  return server.args.find((a) => /^https?:\/\//.test(a)) ?? null;
}

export interface McpTokenStores {
  /** Hermes' own OAuth store: HERMES_HOME/mcp-tokens/<name>.json (tools/mcp_oauth.py). */
  hermesToken: (name: string) => Promise<boolean>;
  /** mcp-remote caches tokens as ~/.mcp-auth/mcp-remote-<version>/<md5(url)>_tokens.json. */
  mcpRemoteToken: (url: string) => Promise<boolean>;
}

export function fileTokenStores(home = hermesHome(), user = homedir()): McpTokenStores {
  return {
    hermesToken: (name) => exists(join(home, "mcp-tokens", `${name}.json`)),
    mcpRemoteToken: async (url) => {
      const hash = createHash("md5").update(url).digest("hex");
      const root = join(user, ".mcp-auth");
      const dirs = await readdir(root).catch(() => [] as string[]);
      for (const dir of dirs.filter((d) => d.startsWith("mcp-remote"))) {
        if (await exists(join(root, dir, `${hash}_tokens.json`))) return true;
      }
      return false;
    },
  };
}

/**
 * Hermes' /test endpoint spawns the server (and mcp-remote may open a browser to sign in), so
 * health comes from config and cached credentials only: never a live probe.
 */
export async function mcpEntries(hermes: HermesClient, tokens: McpTokenStores): Promise<Entry[]> {
  const servers = await hermes.mcpServers();
  return Promise.all(
    servers.map(async (s): Promise<Entry> => {
      const base = { id: `mcp:${s.name}`, kind: "mcp" as const, name: s.name };
      if (!s.enabled) return { ...base, status: "off", detail: "Disabled" };
      const remote = mcpRemoteUrl(s);
      if (s.auth === "oauth") {
        return (await tokens.hermesToken(s.name))
          ? { ...base, status: "ok", detail: "Enabled · signed in" }
          : { ...base, status: "error", detail: "OAuth sign-in required — authorise it in the Hermes dashboard" };
      }
      if (remote) {
        return (await tokens.mcpRemoteToken(remote))
          ? { ...base, status: "ok", detail: "Enabled · signed in via mcp-remote" }
          : { ...base, status: "warn", detail: "Enabled · no cached sign-in yet; it will ask on first use" };
      }
      return { ...base, status: "ok", detail: `Enabled · ${s.transport}${s.auth === "header" ? " with API key" : ""}` };
    }),
  );
}

export interface CliContext {
  run: RunCommand;
  status: HermesStatus | null;
  home?: string;
  hermesBin?: string;
  googleCheck: () => Promise<{ ok: boolean; detail: string }>;
}

async function hermesCli({ run, status, hermesBin }: CliContext): Promise<Entry> {
  const base = { id: "cli:hermes", kind: "cli" as const, name: "Hermes CLI" };
  const bin = hermesBin || process.env.HERMES_BIN || join(homedir(), ".local", "bin", "hermes");
  const version = await run(bin, ["--version"], { timeoutMs: CLI_TIMEOUT_MS });
  if (version.code === 127) return { ...base, status: "error", detail: "hermes not found" };
  if (version.code !== 0) return { ...base, status: "error", detail: `hermes --version failed (exit ${version.code})` };
  const v = redact(version.stdout.split("\n")[0] ?? "");
  if (!status) return { ...base, status: "error", detail: `${v} · dashboard unreachable` };
  if (!status.gateway_running) return { ...base, status: "warn", detail: `${v} · dashboard up, gateway not running` };
  return { ...base, status: "ok", detail: `${v} · dashboard and gateway reachable` };
}

async function notionCli({ run, home = hermesHome() }: CliContext): Promise<Entry> {
  const base = { id: "cli:ntn", kind: "cli" as const, name: "Notion CLI" };
  const token = await readEnvKey(join(home, ".env"), "NOTION_API_TOKEN");
  if (!token) return { ...base, status: "warn", detail: "NOTION_API_TOKEN not set in the default profile" };
  const result = await run("ntn", ["whoami"], { timeoutMs: CLI_TIMEOUT_MS, env: { ...process.env, NOTION_API_TOKEN: token } });
  if (result.code === 127) return { ...base, status: "off", detail: "ntn not installed" };
  if (result.code !== 0) {
    const why = redact(result.stderr || result.stdout, [token]);
    return { ...base, status: "error", detail: `Not authenticated${why ? ` — ${why}` : ""}` };
  }
  return { ...base, status: "ok", detail: "Authenticated" };
}

async function githubCli({ run }: CliContext): Promise<Entry> {
  const base = { id: "cli:gh", kind: "cli" as const, name: "GitHub CLI" };
  const result = await run("gh", ["auth", "status"], { timeoutMs: CLI_TIMEOUT_MS });
  if (result.code === 127) return { ...base, status: "off", detail: "gh not installed" };
  const output = `${result.stdout}\n${result.stderr}`;
  const account = /Logged in to (\S+) account (\S+)/.exec(output) ?? /Logged in to (\S+) as (\S+)/.exec(output);
  if (result.code !== 0 || !account) return { ...base, status: "error", detail: "Not logged in — run gh auth login" };
  return { ...base, status: "ok", detail: redact(`Logged in to ${account[1]} as ${account[2]}`) };
}

async function googleCli({ googleCheck }: CliContext): Promise<Entry> {
  const base = { id: "cli:google-workspace", kind: "cli" as const, name: "Google Workspace (CEO)" };
  const check = await googleCheck();
  return check.ok
    ? { ...base, status: "ok", detail: "Token valid" }
    : { ...base, status: "error", detail: "Token missing or expired — run the google-workspace setup" };
}

export const CLI_PROBES: readonly { id: string; name: string; probe: (ctx: CliContext) => Promise<Entry> }[] = [
  { id: "cli:hermes", name: "Hermes CLI", probe: hermesCli },
  { id: "cli:ntn", name: "Notion CLI", probe: notionCli },
  { id: "cli:gh", name: "GitHub CLI", probe: githubCli },
  { id: "cli:google-workspace", name: "Google Workspace (CEO)", probe: googleCli },
];
