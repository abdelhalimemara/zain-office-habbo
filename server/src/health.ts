import type { HealthResponse, ReconcilerStatus } from "../../shared/api";
import { KANBAN_BOARD } from "../../shared/divisions";
import { HermesError, type HermesClient, type HermesStatus } from "./hermes/client";
import type { CeoWake } from "./telegram/ceoWake";

function telegramState(status: HermesStatus): HealthResponse["telegram"] {
  const state = status.gateway_platforms?.telegram?.state;
  if (!state) return "unknown";
  return state === "connected" ? "connected" : "disconnected";
}

/** Read-only mirror of kanban_db_dispatch.review_dispatch_enabled: absent means on, else truthiness. */
async function reviewDispatch(hermes: HermesClient): Promise<HealthResponse["reviewDispatch"]> {
  try {
    const kanban = (await hermes.config()).kanban ?? {};
    if (!("review_dispatch" in kanban)) return "on";
    return kanban.review_dispatch ? "on" : "off";
  } catch {
    return "unknown";
  }
}

async function telegramApprovals(ceoWake: CeoWake | undefined): Promise<HealthResponse["telegramApprovals"]> {
  if (!ceoWake) return "unknown";
  try {
    return (await ceoWake.telegramHome()) ? "ready" : "needs-sethome";
  } catch {
    return "unknown";
  }
}

export async function health(
  hermes: HermesClient,
  reconciler?: () => ReconcilerStatus,
  ceoWake?: CeoWake,
): Promise<HealthResponse> {
  return { ...(await hermesHealth(hermes, ceoWake)), ...(reconciler ? { reconciler: reconciler() } : {}) };
}

async function hermesHealth(hermes: HermesClient, ceoWake: CeoWake | undefined): Promise<HealthResponse> {
  const down = { ok: false, telegram: "unknown", reviewDispatch: "unknown", telegramApprovals: "unknown", board: KANBAN_BOARD } as const;
  let status: HermesStatus;
  try {
    status = await hermes.status();
  } catch {
    return { ...down, hermes: "unreachable" };
  }
  const telegram = telegramState(status);
  try {
    await hermes.boardSlugs();
  } catch (err) {
    const unauthorized = err instanceof HermesError && (err.status === 401 || err.status === 403);
    return { ...down, hermes: unauthorized ? "unauthorized" : "unreachable", telegram };
  }
  const [dispatch, approvals] = await Promise.all([reviewDispatch(hermes), telegramApprovals(ceoWake)]);
  return { ok: true, hermes: "reachable", telegram, reviewDispatch: dispatch, telegramApprovals: approvals, board: KANBAN_BOARD };
}
