import type { HealthResponse } from "../../shared/api";
import { KANBAN_BOARD } from "../../shared/divisions";
import { HermesError, type HermesClient, type HermesStatus } from "./hermes/client";

function telegramState(status: HermesStatus): HealthResponse["telegram"] {
  const state = status.gateway_platforms?.telegram?.state;
  if (!state) return "unknown";
  return state === "connected" ? "connected" : "disconnected";
}

export async function health(hermes: HermesClient): Promise<HealthResponse> {
  let status: HermesStatus;
  try {
    status = await hermes.status();
  } catch {
    return { ok: false, hermes: "unreachable", telegram: "unknown", board: KANBAN_BOARD };
  }
  const telegram = telegramState(status);
  try {
    await hermes.boardSlugs();
    return { ok: true, hermes: "reachable", telegram, board: KANBAN_BOARD };
  } catch (err) {
    const unauthorized = err instanceof HermesError && (err.status === 401 || err.status === 403);
    return { ok: false, hermes: unauthorized ? "unauthorized" : "unreachable", telegram, board: KANBAN_BOARD };
  }
}
