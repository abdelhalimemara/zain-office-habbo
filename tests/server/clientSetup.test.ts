import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolsetsWithKanban } from "../../server/src/clientChannels/toolsets";
import { ROUTE_NAME, bridgeQrRenderer, runWhatsAppSetup, withAhmadRoute } from "../../server/src/clientChannels/whatsappSetup";
import { json, setup, type Handler } from "./helpers";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zain-hermes-home-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

function hermesWithConfig(extra: Record<string, Handler> = {}) {
  return setup({
    "GET /api/config": (c) =>
      c.query.get("profile") === "default"
        ? { gateway: { profile_routes: [{ name: "ops-telegram", platform: "telegram", profile: "zain-hq-ops", chat_id: "1" }] } }
        : { platform_toolsets: { whatsapp: ["hermes-whatsapp"], telegram: ["hermes-telegram"] } },
    "PUT /api/config": () => ({ ok: true }),
    "PUT /api/env": () => ({ ok: true }),
    ...extra,
  });
}

describe("kanban toolsets", () => {
  it("keeps existing toolsets and does not add kanban twice", () => {
    expect(toolsetsWithKanban(["hermes-email", "web"], "email")).toEqual(["hermes-email", "web", "kanban"]);
    expect(toolsetsWithKanban(["hermes-whatsapp", "kanban"], "whatsapp")).toEqual(["hermes-whatsapp", "kanban"]);
    expect(toolsetsWithKanban(undefined, "email")).toEqual(["hermes-email", "kanban"]);
  });
});

describe("npm run ahmad:whatsapp -- --route-only", () => {
  const status = (state?: string): Handler => () => ({ gateway_platforms: state ? { whatsapp: { state } } : {} });

  it("dry run reports the WhatsApp state and changes nothing", async () => {
    const lines: string[] = [];
    const { hermes, hermesFetch } = hermesWithConfig({ "GET /api/status": status() });
    expect(await runWhatsAppSetup({ apply: false, routeOnly: true, hermes, log: (l) => lines.push(l) })).toBe("dry-run");
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(lines[0]).toBe("WhatsApp on the gateway: not configured.");
    expect(lines.join("\n")).toContain("without starting pairing");
  });

  it("routes to Ahmad, opens DMs and enables kanban without pairing", async () => {
    const lines: string[] = [];
    const { hermes, hermesFetch } = hermesWithConfig({ "GET /api/status": status("connected") });
    expect(await runWhatsAppSetup({ apply: true, routeOnly: true, hermes, log: (l) => lines.push(l) })).toBe("routed");
    const writes = hermesFetch.calls.filter((c) => c.method !== "GET").map((c) => [`${c.method} ${c.path}`, c.body]);
    expect(writes).toEqual([
      [
        "PUT /api/config",
        {
          profile: "default",
          config: {
            gateway: {
              profile_routes: [
                { name: "ops-telegram", platform: "telegram", profile: "zain-hq-ops", chat_id: "1" },
                { name: ROUTE_NAME, platform: "whatsapp", profile: "zain-hq-accounts" },
              ],
            },
          },
        },
      ],
      ["PUT /api/env", { key: "WHATSAPP_ALLOW_ALL_USERS", value: "true", profile: "default" }],
      ["PUT /api/config", { profile: "zain-hq-accounts", config: { platform_toolsets: { whatsapp: ["hermes-whatsapp", "kanban"], email: ["hermes-email", "kanban"] } } }],
      ["PUT /api/env", { key: "WHATSAPP_DM_POLICY", value: "open", profile: "default" }],
    ]);
    expect(hermesFetch.calls.some((c) => c.path.includes("onboarding"))).toBe(false);
    expect(lines).toContain("WhatsApp on the gateway: connected.");
    expect(lines.join("\n")).toContain("hermes gateway restart");
  });

  it("tells the user to link in the dashboard and re-run when WhatsApp is not connected yet", async () => {
    const lines: string[] = [];
    const { hermes } = hermesWithConfig({ "GET /api/status": status("disconnected") });
    await runWhatsAppSetup({ apply: true, routeOnly: true, hermes, log: (l) => lines.push(l) });
    const text = lines.join("\n");
    expect(text).toContain("Hermes dashboard → Messaging → WhatsApp");
    expect(text).toContain("npm run ahmad:whatsapp -- --route-only --apply");
  });
});

describe("npm run ahmad:whatsapp", () => {
  const onboarding = (status: string, qr: string | null = null) => ({
    pairing_id: "pair1",
    status,
    qr_payload: qr,
    expires_at: "2026-10-02T10:10:00Z",
    account_phone: status === "connected" ? "+966500000000" : null,
  });

  it("dry run makes no Hermes calls", async () => {
    const lines: string[] = [];
    const { hermes, hermesFetch } = hermesWithConfig();
    expect(await runWhatsAppSetup({ apply: false, hermes, log: (l) => lines.push(l) })).toBe("dry-run");
    expect(hermesFetch.calls).toEqual([]);
    expect(lines.join("\n")).toContain(ROUTE_NAME);
  });

  it("routes WhatsApp to Ahmad, shows each new QR once, applies on the default profile and opens DMs", async () => {
    const statuses = [onboarding("waiting", "QR-1"), onboarding("waiting", "QR-1"), onboarding("waiting", "QR-2"), onboarding("connected")];
    const lines: string[] = [];
    const rendered: string[] = [];
    const { hermes, hermesFetch } = hermesWithConfig({
      "POST /api/messaging/whatsapp/onboarding/start": () => onboarding("installing"),
      "GET /api/messaging/whatsapp/onboarding/pair1": () => statuses.shift(),
      "POST /api/messaging/whatsapp/onboarding/pair1/apply": () => ({ ok: true, needs_restart: false }),
    });
    const result = await runWhatsAppSetup({
      apply: true,
      hermes,
      renderQr: () => (payload) => (rendered.push(payload), `[qr:${payload}]`),
      sleep: async () => undefined,
      log: (l) => lines.push(l),
    });
    expect(result).toBe("linked");
    expect(rendered).toEqual(["QR-1", "QR-2"]);
    const writes = hermesFetch.calls.filter((c) => c.method !== "GET").map((c) => [`${c.method} ${c.path}`, c.body]);
    expect(writes).toEqual([
      [
        "PUT /api/config",
        {
          profile: "default",
          config: {
            gateway: {
              profile_routes: [
                { name: "ops-telegram", platform: "telegram", profile: "zain-hq-ops", chat_id: "1" },
                { name: ROUTE_NAME, platform: "whatsapp", profile: "zain-hq-accounts" },
              ],
            },
          },
        },
      ],
      ["PUT /api/env", { key: "WHATSAPP_ALLOW_ALL_USERS", value: "true", profile: "default" }],
      ["PUT /api/config", { profile: "zain-hq-accounts", config: { platform_toolsets: { whatsapp: ["hermes-whatsapp", "kanban"], email: ["hermes-email", "kanban"] } } }],
      ["POST /api/messaging/whatsapp/onboarding/start", { mode: "bot", allowed_users: "", profile: null }],
      ["POST /api/messaging/whatsapp/onboarding/pair1/apply", { mode: "bot", profile: null }],
      ["PUT /api/env", { key: "WHATSAPP_DM_POLICY", value: "open", profile: "default" }],
    ]);
    expect(lines.join("\n")).toContain("Linked devices → Link a device");
    expect(lines.some((l) => l.includes("hermes gateway restart"))).toBe(true);
  });

  it("renders the QR with the bridge's own qrcode-terminal, or reports it unavailable", async () => {
    expect(bridgeQrRenderer(home)).toBeNull();
    const bridge = join(home, "scripts", "whatsapp-bridge");
    await mkdir(join(bridge, "node_modules", "qrcode-terminal"), { recursive: true });
    await writeFile(join(bridge, "package.json"), "{}");
    await writeFile(
      join(bridge, "node_modules", "qrcode-terminal", "index.js"),
      "exports.generate = (text, opts, cb) => cb(`##${text}##${opts.small}`);",
    );
    expect(bridgeQrRenderer(home)!("PAIR")).toBe("##PAIR##true");
  });

  it("replaces its own route instead of duplicating it", () => {
    expect(withAhmadRoute([{ name: ROUTE_NAME, platform: "whatsapp", profile: "old" }])).toEqual([
      { name: ROUTE_NAME, platform: "whatsapp", profile: "zain-hq-accounts" },
    ]);
    expect(withAhmadRoute(undefined)).toHaveLength(1);
  });

  it("cancels the pairing and fails when linking errors or expires", async () => {
    const { hermes, hermesFetch } = hermesWithConfig({
      "POST /api/messaging/whatsapp/onboarding/start": () => onboarding("waiting", "QR-1"),
      "GET /api/messaging/whatsapp/onboarding/pair1": () => ({ ...onboarding("error"), error: "bridge crashed" }),
      "DELETE /api/messaging/whatsapp/onboarding/pair1": () => ({ ok: true }),
    });
    await expect(
      runWhatsAppSetup({ apply: true, hermes, renderQr: () => null, sleep: async () => undefined, log: () => undefined }),
    ).rejects.toThrow("WhatsApp linking error: bridge crashed");
    expect(hermesFetch.called("DELETE /api/messaging/whatsapp/onboarding/pair1")).toHaveLength(1);
    expect(hermesFetch.called("POST /api/messaging/whatsapp/onboarding/pair1/apply")).toEqual([]);
  });

  it("points to the Hermes dashboard when no QR renderer is available", async () => {
    const lines: string[] = [];
    const { hermes } = hermesWithConfig({
      "POST /api/messaging/whatsapp/onboarding/start": () => onboarding("waiting", "QR-1"),
      "GET /api/messaging/whatsapp/onboarding/pair1": () => onboarding("connected"),
      "POST /api/messaging/whatsapp/onboarding/pair1/apply": () => json({ ok: true, needs_restart: true }),
    });
    await runWhatsAppSetup({ apply: true, hermes, renderQr: () => null, sleep: async () => undefined, log: (l) => lines.push(l) });
    expect(lines.join("\n")).toContain("open the Hermes dashboard → Messaging → WhatsApp");
    expect(lines.join("\n")).toContain("Hermes could not restart it itself");
  });
});
