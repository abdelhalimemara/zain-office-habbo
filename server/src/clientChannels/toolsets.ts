import type { HermesClient } from "../hermes/client";
import { ACCOUNTS_PROFILE } from "./envFile";

const CHANNEL_TOOLSETS = { email: "hermes-email", whatsapp: "hermes-whatsapp" } as const;
export type ClientChannel = keyof typeof CHANNEL_TOOLSETS;

/**
 * Kanban is off for chat platforms by default (hermes_cli/tools_config.py); the account agent needs
 * it inside client chats to raise "Client reply:" tasks. Lists are merged so nothing is dropped.
 */
export function toolsetsWithKanban(current: unknown, channel: ClientChannel): string[] {
  const existing = Array.isArray(current) ? current.filter((t): t is string => typeof t === "string") : [];
  const base = existing.length ? existing : [CHANNEL_TOOLSETS[channel]];
  return base.includes("kanban") ? base : [...base, "kanban"];
}

export async function enableKanbanToolsets(hermes: HermesClient, channels: readonly ClientChannel[]): Promise<Record<string, string[]>> {
  const config = await hermes.profileConfig(ACCOUNTS_PROFILE);
  const current = (config.platform_toolsets ?? {}) as Record<string, unknown>;
  const next = Object.fromEntries(channels.map((c) => [c, toolsetsWithKanban(current[c], c)]));
  await hermes.mergeConfig(ACCOUNTS_PROFILE, { platform_toolsets: next });
  return next;
}
