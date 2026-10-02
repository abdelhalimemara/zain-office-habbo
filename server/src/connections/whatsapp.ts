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

export async function whatsappEntry(
  settings: WhatsAppSettings,
  routedToAhmad: boolean,
  fetchImpl: FetchLike,
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
  const access = accessNote(settings);
  let health: { status?: unknown };
  try {
    const res = await withTimeout(fetchImpl(`http://127.0.0.1:${settings.port}/health`, {}), HEALTH_TIMEOUT_MS);
    health = (await res.json()) as { status?: unknown };
  } catch {
    return { ...base, status: "error", detail: `Bridge not running (port ${settings.port})` };
  }
  const state = typeof health.status === "string" ? health.status : "unknown";
  if (state === "connected") return { ...base, status: "ok", detail: `Connected · ${access}` };
  return { ...base, status: "warn", detail: `${redact(state).replace(/_/g, " ")} · ${access}` };
}
