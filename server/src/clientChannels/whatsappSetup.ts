import { createRequire } from "node:module";
import { join } from "node:path";
import type { HermesClient, WhatsAppOnboarding } from "../hermes/client";
import { ACCOUNTS_PROFILE, hermesHome } from "./hermesPaths";
import { enableKanbanToolsets } from "./toolsets";

export const ROUTE_NAME = "zain-ahmad-whatsapp";
const POLL_MS = 2000;
const DONE = new Set(["error", "expired", "cancelled"]);

export type QrRenderer = (payload: string) => string;

/**
 * qrcode-terminal is a dependency of Hermes' own WhatsApp bridge, which the onboarding installs;
 * reusing it avoids adding a package here. Null when the bridge is not installed yet.
 */
export function bridgeQrRenderer(agentDir = join(hermesHome(), "hermes-agent")): QrRenderer | null {
  try {
    const req = createRequire(join(agentDir, "scripts", "whatsapp-bridge", "package.json"));
    const qrcode = req("qrcode-terminal") as { generate: (text: string, opts: { small: boolean }, cb: (qr: string) => void) => void };
    return (payload) => {
      let out = "";
      qrcode.generate(payload, { small: true }, (qr) => (out = qr));
      return out;
    };
  } catch {
    return null;
  }
}

type Route = { name?: string; platform?: string; profile?: string };

/**
 * Under a multiplex gateway only the default profile may run WhatsApp (gateway/run_adapters.py
 * skips it for other profiles), so Ahmad's number is linked there and every WhatsApp chat is
 * routed to his profile with an unscoped gateway.profile_routes entry.
 */
export function withAhmadRoute(existing: unknown): Route[] {
  const routes = (Array.isArray(existing) ? existing : []).filter((r): r is Route => !!r && typeof r === "object");
  return [...routes.filter((r) => r.name !== ROUTE_NAME), { name: ROUTE_NAME, platform: "whatsapp", profile: ACCOUNTS_PROFILE }];
}

export interface WhatsAppSetupOptions {
  apply: boolean;
  /** Configure routing and access only; the user links the number in the Hermes dashboard. */
  routeOnly?: boolean;
  hermes: HermesClient;
  renderQr?: () => QrRenderer | null;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

async function waitForLink(
  hermes: HermesClient,
  start: WhatsAppOnboarding,
  { renderQr, sleep, log }: Required<Pick<WhatsAppSetupOptions, "renderQr" | "sleep" | "log">>,
): Promise<WhatsAppOnboarding> {
  let state = start;
  let shownQr: string | null = null;
  let lastStatus = "";
  for (;;) {
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      if (state.status === "installing") log("Installing Hermes' WhatsApp bridge (first run only)…");
      if (state.status === "starting") log("Starting the WhatsApp bridge…");
    }
    if (state.qr_payload && state.qr_payload !== shownQr) {
      shownQr = state.qr_payload;
      const render = renderQr();
      log("");
      log("On Ahmad's phone: WhatsApp → Settings → Linked devices → Link a device, then scan:");
      log(render ? render(state.qr_payload) : "(QR renderer unavailable: open the Hermes dashboard → Messaging → WhatsApp to scan instead.)");
      log(`The code refreshes every ~20s; this session expires at ${state.expires_at ?? "in 10 minutes"}.`);
    }
    if (state.status === "connected") return state;
    if (DONE.has(state.status)) throw new Error(`WhatsApp linking ${state.status}${state.error ? `: ${state.error}` : ""}`);
    await sleep(POLL_MS);
    state = await hermes.whatsappOnboardingStatus(state.pairing_id);
  }
}

async function whatsappState(hermes: HermesClient): Promise<string> {
  try {
    return (await hermes.gatewayPlatforms()).whatsapp?.state ?? "not configured";
  } catch {
    return "unknown (Hermes unreachable)";
  }
}

async function routeAndOpen(hermes: HermesClient): Promise<void> {
  const defaults = await hermes.profileConfig("default");
  const gateway = (defaults.gateway ?? {}) as Record<string, unknown>;
  await hermes.mergeConfig("default", { gateway: { profile_routes: withAhmadRoute(gateway.profile_routes) } });
  await hermes.setEnv("default", "WHATSAPP_ALLOW_ALL_USERS", "true");
  await enableKanbanToolsets(hermes, ["whatsapp", "email"]);
}

/**
 * For a number linked in the Hermes dashboard (on the default profile, as multiplex requires):
 * route it to Ahmad and open it to anyone. Linking writes WHATSAPP_DM_POLICY=pairing, so this
 * must run after linking (re-running is harmless).
 */
async function runRouteOnly(apply: boolean, hermes: HermesClient, log: (line: string) => void): Promise<"dry-run" | "routed"> {
  const state = await whatsappState(hermes);
  log(`WhatsApp on the gateway: ${state}.`);
  if (!apply) {
    log("Dry run. With --apply this will (without starting pairing):");
    log(`- add gateway.profile_routes "${ROUTE_NAME}" on the default profile: every WhatsApp chat → ${ACCOUNTS_PROFILE}`);
    log("- set WHATSAPP_ALLOW_ALL_USERS=true and WHATSAPP_DM_POLICY=open on the default profile");
    log(`- enable the kanban toolset for ${ACCOUNTS_PROFILE} on WhatsApp and email`);
    return "dry-run";
  }
  await routeAndOpen(hermes);
  await hermes.setEnv("default", "WHATSAPP_DM_POLICY", "open");
  log(`Routed every WhatsApp chat to ${ACCOUNTS_PROFILE}, opened DMs to anyone and enabled kanban in his chats.`);
  log("");
  log("Next steps:");
  if (state !== "connected") {
    log("1. Link Ahmad's number: Hermes dashboard → Messaging → WhatsApp (default profile), scan the QR on his phone.");
    log("2. Linking resets the DM policy to pairing: run `npm run ahmad:whatsapp -- --route-only --apply` again afterwards.");
    log("3. Then run `hermes gateway restart`.");
  } else {
    log("1. Run `hermes gateway restart` so the route and open DM policy take effect.");
    log("2. From another phone, send Ahmad's number a WhatsApp message and check he answers.");
  }
  return "routed";
}

export async function runWhatsAppSetup({
  apply,
  routeOnly = false,
  hermes,
  renderQr = () => bridgeQrRenderer(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}: WhatsAppSetupOptions): Promise<"dry-run" | "linked" | "routed"> {
  if (routeOnly) return runRouteOnly(apply, hermes, log);
  if (!apply) {
    log("Dry run. With --apply this will:");
    log(`- add gateway.profile_routes "${ROUTE_NAME}" on the default profile: every WhatsApp chat → ${ACCOUNTS_PROFILE}`);
    log("- allow every sender on WhatsApp (WHATSAPP_ALLOW_ALL_USERS=true) on the default profile");
    log(`- enable the kanban toolset for ${ACCOUNTS_PROFILE} on WhatsApp and email`);
    log("- start WhatsApp linking (bot mode) and show the QR code here, then apply it (Hermes restarts the gateway)");
    log("- set WHATSAPP_DM_POLICY=open so anyone can message Ahmad");
    return "dry-run";
  }
  await routeAndOpen(hermes);
  log(`Routed every WhatsApp chat to ${ACCOUNTS_PROFILE} and enabled kanban in his chats.`);

  const start = await hermes.whatsappOnboardingStart({ mode: "bot", allowed_users: "", profile: null });
  let linked: WhatsAppOnboarding;
  try {
    linked = await waitForLink(hermes, start, { renderQr, sleep, log });
  } catch (err) {
    await hermes.whatsappOnboardingCancel(start.pairing_id).catch(() => undefined);
    throw err;
  }
  log(`Linked WhatsApp ${linked.account_phone ?? ""}`.trim() + ".");
  const applied = await hermes.whatsappOnboardingApply(linked.pairing_id, { mode: "bot", profile: null });
  await hermes.setEnv("default", "WHATSAPP_DM_POLICY", "open");
  log("");
  log("Next steps:");
  log("1. Run `hermes gateway restart` so the open DM policy takes effect" + (applied.needs_restart ? " (Hermes could not restart it itself)." : "."));
  log("2. From another phone, send Ahmad's number a WhatsApp message and check he answers.");
  log("3. Run `npm run seed:roster -- --refresh-personas --apply` if you have not already, so Ahmad's SOUL has the client charter.");
  return "linked";
}
