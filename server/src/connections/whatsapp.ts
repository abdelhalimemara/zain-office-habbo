import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { ACCOUNTS_PROFILE } from "../clientChannels/hermesPaths";
import type { FetchLike } from "../hermes/client";
import type { Entry } from "./channels";
import { readEnvKey, redact, withTimeout } from "./run";

const DEFAULT_BRIDGE_PORT = 3000;
const HEALTH_TIMEOUT_MS = 3000;

export interface WhatsAppSettings {
  enabled: boolean;
  dmPolicy: string | null;
  /** True when the bridge allowlist contains "*"; the numbers themselves are never kept. */
  allowsEveryone: boolean;
  hasAllowlist: boolean;
  port: number;
}

const truthy = (v: string | null | undefined) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());

function configured(config: Record<string, unknown>): Record<string, unknown> {
  const sources = [config.platforms, (config.gateway as Record<string, unknown> | undefined)?.platforms];
  for (const source of sources) {
    const block = (source as Record<string, unknown> | undefined)?.whatsapp;
    if (block && typeof block === "object") return block as Record<string, unknown>;
  }
  return {};
}

/**
 * The default profile owns WhatsApp under multiplex. Its bridge port is `bridge_port` in the
 * platform block (plugins/platforms/whatsapp/adapter.py, default 3000); access is gated by the
 * bridge itself, which only lets everyone in when WHATSAPP_ALLOWED_USERS contains "*".
 */
export async function whatsappSettings(home: string, defaultConfig: Record<string, unknown>): Promise<WhatsAppSettings> {
  const env = join(home, ".env");
  const [enabled, dmPolicy, allowed, envPort] = await Promise.all(
    ["WHATSAPP_ENABLED", "WHATSAPP_DM_POLICY", "WHATSAPP_ALLOWED_USERS", "WHATSAPP_BRIDGE_PORT"].map((k) => readEnvKey(env, k)),
  );
  const block = configured(defaultConfig);
  const extra = (block.extra ?? {}) as Record<string, unknown>;
  const port = [extra.bridge_port, block.bridge_port, envPort].map((v) => Number(v)).find((n) => Number.isInteger(n) && n > 0);
  const users = (allowed ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  return {
    enabled: truthy(enabled) || block.enabled === true,
    dmPolicy: dmPolicy?.trim().toLowerCase() || null,
    allowsEveryone: users.includes("*"),
    hasAllowlist: users.length > 0,
    port: port ?? DEFAULT_BRIDGE_PORT,
  };
}

export function accessNote(s: WhatsAppSettings): string {
  if (s.dmPolicy === "disabled") return "DMs disabled";
  if (s.allowsEveryone) return "open to anyone";
  if (s.hasAllowlist) return "allowlist only";
  return s.dmPolicy === "pairing" ? "pairing only" : "no one allowed yet (set WHATSAPP_ALLOWED_USERS=*)";
}

export type BridgeAccess = "open" | "allowlist" | "pairing" | "self-chat" | "closed";

const ACCESS_NOTE: Record<BridgeAccess, string> = {
  open: "open to anyone",
  allowlist: "allowlist only",
  pairing: "pairing only",
  "self-chat": "self-chat only",
  closed: "rejecting all messages",
};

/** What the settings ask the bridge for (bridge.js decides in this order at startup). */
export function configuredAccess(s: WhatsAppSettings): BridgeAccess {
  if (s.allowsEveryone) return "open";
  if (s.hasAllowlist) return "allowlist";
  return s.dmPolicy === "pairing" ? "pairing" : "closed";
}

/**
 * The access the RUNNING bridge applied: bridge.js logs it right after "listening on port" each
 * time it starts (scripts/whatsapp-bridge/bridge.js:1158-1169). Only the kind is kept, never numbers.
 */
export function bridgeStartupAccess(logTail: string): BridgeAccess | null {
  const lines = logTail.split("\n");
  let start = -1;
  lines.forEach((line, i) => {
    if (line.includes("WhatsApp bridge listening on port")) start = i;
  });
  if (start < 0) return null;
  for (const line of lines.slice(start + 1, start + 12)) {
    if (line.includes("Allowed users:")) return /Allowed users:.*(^|[\s,])\*(\s|,|$)/.test(line) ? "open" : "allowlist";
    if (line.includes("Self-chat mode")) return "self-chat";
    if (line.includes("WHATSAPP_DM_POLICY=pairing")) return "pairing";
    if (line.includes("No WHATSAPP_ALLOWED_USERS set")) return "closed";
  }
  return null;
}

export interface BridgeRuntime {
  /** Tail of the default profile's platforms/whatsapp/bridge.log, when readable. */
  logTail: string | null;
  /** mtime of the default profile's .env (ms), the fallback when the log says nothing. */
  envMtimeMs: number | null;
  nowMs: number;
}

const RESTART_HINT = "settings changed — restart the gateway to apply";

export async function whatsappEntry(
  settings: WhatsAppSettings,
  routedToAhmad: boolean,
  fetchImpl: FetchLike,
  runtime: BridgeRuntime,
): Promise<Entry> {
  const base = {
    id: "channel:whatsapp",
    kind: "channel" as const,
    name: routedToAhmad ? "WhatsApp · Ahmad" : "WhatsApp",
    ...(routedToAhmad ? { profile: ACCOUNTS_PROFILE } : {}),
  };
  if (!settings.enabled) {
    return { ...base, status: "off", detail: routedToAhmad ? "Not enabled — link Ahmad's number in the Hermes dashboard" : "Not enabled" };
  }
  let health: { status?: unknown; uptime?: unknown };
  try {
    const res = await withTimeout(fetchImpl(`http://127.0.0.1:${settings.port}/health`, {}), HEALTH_TIMEOUT_MS);
    health = (await res.json()) as { status?: unknown; uptime?: unknown };
  } catch {
    return { ...base, status: "error", detail: `Bridge not running (port ${settings.port})` };
  }
  const wanted = configuredAccess(settings);
  const running = runtime.logTail ? bridgeStartupAccess(runtime.logTail) : null;
  const startedAtMs = typeof health.uptime === "number" ? runtime.nowMs - health.uptime * 1000 : null;
  const stale = running
    ? running !== wanted
    : runtime.envMtimeMs !== null && startedAtMs !== null && runtime.envMtimeMs > startedAtMs + 5000;
  const access = running ? ACCESS_NOTE[running] : accessNote(settings);
  const state = typeof health.status === "string" ? health.status : "unknown";
  if (stale) {
    const now = running ? ` (running: ${access}; configured: ${ACCESS_NOTE[wanted]})` : "";
    return { ...base, status: "warn", detail: `${state === "connected" ? "Connected" : redact(state)} · ${RESTART_HINT}${now}` };
  }
  if (state === "connected") return { ...base, status: running === "closed" ? "warn" : "ok", detail: `Connected · ${access}` };
  return { ...base, status: "warn", detail: `${redact(state).replace(/_/g, " ")} · ${access}` };
}

/** Reads the bridge log tail and the .env mtime of the default profile (never their contents into output). */
export async function bridgeRuntime(home: string, nowMs: number): Promise<BridgeRuntime> {
  const log = join(home, "platforms", "whatsapp", "bridge.log");
  const logTail = await (async () => {
    try {
      const { size } = await stat(log);
      const handle = await open(log, "r");
      try {
        const length = Math.min(size, 32 * 1024);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, size - length);
        return buffer.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  })();
  const envMtimeMs = await stat(join(home, ".env")).then(
    (s) => s.mtimeMs,
    () => null,
  );
  return { logTail, envMtimeMs, nowMs };
}
