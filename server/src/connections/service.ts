import { join } from "node:path";
import type { Connection, ConnectionsResponse } from "../../../shared/api";
import { checkGmailToken, hermesPython, type PythonRunner } from "../clientChannels/gmail";
import { hermesHome } from "../clientChannels/hermesPaths";
import type { HermesClient, HermesStatus } from "../hermes/client";
import type { CeoWake } from "../telegram/ceoWake";
import {
  ahmadInboxJob,
  gatewayEntry,
  gmailEntry,
  hasAhmadRoute,
  platformEntries,
  telegramApprovalsEntry,
  type Entry,
} from "./channels";
import { redact, runCommand, withTimeout, type RunCommand } from "./run";
import { CLI_PROBES, fileTokenStores, mcpEntries, type McpTokenStores } from "./tools";

const CACHE_MS = 30_000;
const TOKEN_CACHE_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 10_000;

export interface ConnectionsOptions {
  hermes: HermesClient;
  ceoWake: CeoWake;
  run?: RunCommand;
  /** Python with Ahmad's profile as HERMES_HOME (his Gmail token). */
  ahmadPython?: PythonRunner;
  /** Python with the default profile as HERMES_HOME (the CEO's google-workspace token). */
  defaultPython?: PythonRunner;
  tokens?: McpTokenStores;
  home?: string;
  hermesBin?: string;
  now?: () => number;
  timeoutMs?: number;
}

function failed(id: string, kind: Entry["kind"], name: string, err: unknown): Entry {
  const why = err instanceof Error ? redact(err.message) : "probe failed";
  return { id, kind, name, status: "error", detail: `Check failed: ${why}` };
}

/** A cached token check: Google OAuth checks are slow, and tokens change rarely. */
function cachedCheck(check: () => Promise<{ ok: boolean; detail: string }>, now: () => number) {
  let cached: { at: number; value: Promise<{ ok: boolean; detail: string }> } | null = null;
  return () => {
    if (!cached || now() - cached.at > TOKEN_CACHE_MS) {
      const value = check().catch(() => ({ ok: false, detail: "check failed" }));
      cached = { at: now(), value };
    }
    return cached.value;
  };
}

/**
 * Every channel, MCP server and CLI the organisation depends on, as red/yellow/green. Cached for
 * 30s with one refresh in flight; each probe is time-boxed and a failing probe becomes an error
 * entry rather than failing the request. Read-only against Hermes.
 */
export class ConnectionsService {
  private cached: { at: number; value: ConnectionsResponse } | null = null;
  private inFlight: Promise<ConnectionsResponse> | null = null;
  private readonly now: () => number;
  private readonly ahmadToken: () => Promise<{ ok: boolean; detail: string }>;
  private readonly ceoGoogleToken: () => Promise<{ ok: boolean; detail: string }>;

  constructor(private readonly options: ConnectionsOptions) {
    this.now = options.now ?? Date.now;
    const home = options.home ?? hermesHome();
    const ahmadPython = options.ahmadPython ?? hermesPython(process.env, home);
    const defaultPython = options.defaultPython ?? hermesPython(process.env, home, home);
    this.ahmadToken = cachedCheck(() => checkGmailToken(ahmadPython, home), this.now);
    this.ceoGoogleToken = cachedCheck(async () => {
      const setup = join(home, "skills", "productivity", "google-workspace", "scripts", "setup.py");
      const { code } = await defaultPython([setup, "--check"]);
      return { ok: code === 0, detail: "" };
    }, this.now);
  }

  get(): Promise<ConnectionsResponse> {
    if (this.cached && this.now() - this.cached.at < CACHE_MS) return Promise.resolve(this.cached.value);
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private probe<T>(work: () => Promise<T>): Promise<T> {
    return withTimeout(work(), this.options.timeoutMs ?? PROBE_TIMEOUT_MS);
  }

  private async refresh(): Promise<ConnectionsResponse> {
    const { hermes, ceoWake } = this.options;
    const checkedAt = Math.floor(this.now() / 1000);
    const status = await this.probe(() => hermes.status()).catch(() => null);

    const channels = this.channels(status);
    const mcp = this.probe(() => mcpEntries(hermes, this.options.tokens ?? fileTokenStores(this.options.home))).catch((err) => [
      failed("mcp:servers", "mcp", "MCP servers", err),
    ]);
    const context = {
      run: this.options.run ?? runCommand,
      status,
      home: this.options.home,
      hermesBin: this.options.hermesBin,
      googleCheck: this.ceoGoogleToken,
    };
    const cli = Promise.all(
      CLI_PROBES.map(({ id, name, probe }) => this.probe(() => probe(context)).catch((err) => failed(id, "cli", name, err))),
    );
    const [c, m, l, approvals] = await Promise.all([
      channels,
      mcp,
      cli,
      this.probe(() => telegramApprovalsEntry(ceoWake)).catch((err) =>
        failed("channel:telegram-approvals", "channel", "Telegram approvals", err),
      ),
    ]);
    const telegramAt = c.findIndex((e) => e.id === "channel:telegram");
    const ordered = [...c];
    ordered.splice(telegramAt >= 0 ? telegramAt + 1 : ordered.length, 0, approvals);
    const connections: Connection[] = [...ordered, ...m, ...l].map((e) => ({ ...e, checkedAt }));
    const value = { connections };
    this.cached = { at: this.now(), value };
    return value;
  }

  private async channels(status: HermesStatus | null): Promise<Entry[]> {
    const { hermes } = this.options;
    if (!status) return [{ id: "channel:gateway", kind: "channel", name: "Hermes gateway", status: "error", detail: "Hermes isn't reachable" }];
    const [route, gmail] = await Promise.all([
      this.probe(() => hasAhmadRoute(hermes)).catch(() => false),
      this.probe(async () => gmailEntry(await this.ahmadToken(), await ahmadInboxJob(hermes), Math.floor(this.now() / 1000))).catch((err) =>
        failed("channel:gmail-ahmad", "channel", "Gmail · Ahmad", err),
      ),
    ]);
    return [gatewayEntry(status), ...platformEntries(status, route), gmail];
  }
}
