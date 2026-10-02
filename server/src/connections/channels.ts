import type { Connection, ConnectionStatus } from "../../../shared/api";
import { JOB_NAME, SCHEDULE } from "../clientChannels/gmail";
import { ACCOUNTS_PROFILE } from "../clientChannels/hermesPaths";
import { ROUTE_NAME } from "../clientChannels/whatsappSetup";
import type { CronJob, GatewayPlatformState, HermesClient, HermesStatus } from "../hermes/client";
import type { CeoWake } from "../telegram/ceoWake";
import { redact } from "./run";

export type Entry = Omit<Connection, "checkedAt">;

const PLATFORM_NAMES: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  whatsapp_cloud: "WhatsApp Cloud",
  email: "Email",
  discord: "Discord",
  slack: "Slack",
  signal: "Signal",
  teams: "Teams",
  google_chat: "Google Chat",
};

const WARN_STATES = new Set(["connecting", "retrying", "starting", "reconnecting", "needs_attention", "pending"]);
const ERROR_STATES = new Set(["error", "disconnected", "failed", "fatal", "stopped"]);

export function platformStatus(p: GatewayPlatformState): ConnectionStatus {
  const state = (p.state ?? "").toLowerCase();
  if (state === "disabled") return "off";
  if (ERROR_STATES.has(state)) return "error";
  if (p.needs_attention || WARN_STATES.has(state)) return "warn";
  return state === "connected" ? "ok" : "warn";
}

function platformDetail(p: GatewayPlatformState, status: ConnectionStatus): string {
  if (status === "ok") return "Connected";
  if (status === "off") return "Disabled";
  const why = p.error_message ? `: ${redact(p.error_message)}` : "";
  return `${(p.state ?? "unknown").replace(/_/g, " ")}${why}`.replace(/^./, (c) => c.toUpperCase());
}

/** Under multiplex a non-default profile's own WhatsApp is not served by design (shared ingress). */
function expectedOff(key: string, p: GatewayPlatformState): boolean {
  return key.endsWith(":whatsapp") && p.state === "disabled" && p.error_code === "multiplex_shared_ingress";
}

export function gatewayEntry(status: HermesStatus): Entry {
  const state = (status.gateway_state ?? (status.gateway_running ? "running" : "stopped")).toLowerCase();
  const level: ConnectionStatus = state === "running" ? "ok" : ["draining", "restarting", "starting"].includes(state) ? "warn" : "error";
  const detail = level === "ok" ? "Running" : `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
  return { id: "channel:gateway", kind: "channel", name: "Hermes gateway", status: level, detail };
}

/**
 * Gateway-reported platforms. The default profile's WhatsApp never appears here under multiplex
 * (only the disabled per-profile slots do), so WhatsApp comes from its bridge instead.
 */
export function platformEntries(status: HermesStatus): Entry[] {
  const entries: Entry[] = [];
  for (const [key, p] of Object.entries(status.gateway_platforms ?? {})) {
    if (!p || expectedOff(key, p) || key === "whatsapp") continue;
    const [profile, platform] = key.includes(":") ? (key.split(":", 2) as [string, string]) : [undefined, key];
    const level = platformStatus(p);
    entries.push({
      id: `channel:${profile ? `${profile}:` : ""}${platform}`,
      kind: "channel",
      name: PLATFORM_NAMES[platform] ?? platform,
      status: level,
      detail: platformDetail(p, level),
      ...(profile ? { profile } : {}),
    });
  }
  return entries;
}

export function hasAhmadRoute(defaultConfig: Record<string, unknown>): boolean {
  const gateway = (defaultConfig.gateway ?? {}) as Record<string, unknown>;
  const routes = [gateway.profile_routes, defaultConfig.profile_routes].flatMap((r) => (Array.isArray(r) ? r : []));
  return routes.some((r) => (r as { name?: unknown })?.name === ROUTE_NAME);
}

export async function telegramApprovalsEntry(ceoWake: CeoWake): Promise<Entry> {
  const home = await ceoWake.telegramHome();
  return home
    ? { id: "channel:telegram-approvals", kind: "channel", name: "Telegram approvals", status: "ok", detail: "Home channel set; the CEO is woken for approvals" }
    : { id: "channel:telegram-approvals", kind: "channel", name: "Telegram approvals", status: "warn", detail: "No home channel — send /sethome to the Hermes bot" };
}

function ago(seconds: number): string {
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
}

function intervalSeconds(schedule: string): number {
  const match = /every\s+(\d+)\s*m/i.exec(schedule);
  return match ? Number(match[1]) * 60 : 15 * 60;
}

/**
 * Ahmad's Gmail is an OAuth token plus the inbox loop cron job: red when the token is invalid,
 * yellow when the loop is missing, paused, failing or overdue, green otherwise.
 */
export function gmailEntry(token: { ok: boolean; detail: string }, job: CronJob | undefined, nowSeconds: number): Entry {
  const base = { id: "channel:gmail-ahmad", kind: "channel" as const, name: "Gmail · Ahmad", profile: ACCOUNTS_PROFILE };
  if (!token.ok) return { ...base, status: "error", detail: "Google token invalid or expired — run setup.py for Ahmad's profile" };
  if (!job) return { ...base, status: "warn", detail: "Token valid; inbox loop not set up — run npm run ahmad:gmail -- --apply" };
  if (job.enabled === false || job.state === "paused") return { ...base, status: "warn", detail: "Token valid; inbox loop paused" };
  const lastRun = job.last_run_at ? Math.floor(Date.parse(job.last_run_at) / 1000) : null;
  if (lastRun === null) return { ...base, status: "ok", detail: "Token valid; inbox loop waiting for its first run" };
  const age = nowSeconds - lastRun;
  const when = `Last inbox check ${ago(age)}`;
  const lastStatus = job.last_status?.toLowerCase();
  if (lastStatus === "error") {
    const why = job.last_error ? redact(job.last_error).slice(0, 100) : "no error recorded";
    return { ...base, status: "error", detail: `${when} failed: ${why}` };
  }
  if (lastStatus && !["ok", "success", "completed", "silent"].includes(lastStatus)) {
    return { ...base, status: "warn", detail: `${when} — ${job.last_status}` };
  }
  if (age > 3 * intervalSeconds(job.schedule_display ?? SCHEDULE)) return { ...base, status: "warn", detail: `${when} — overdue` };
  return { ...base, status: "ok", detail: when };
}

export async function ahmadInboxJob(hermes: HermesClient): Promise<CronJob | undefined> {
  return (await hermes.cronJobs(ACCOUNTS_PROFILE)).find((j) => j.name === JOB_NAME);
}
