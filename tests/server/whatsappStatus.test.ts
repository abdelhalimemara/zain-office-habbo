import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accessNote,
  bridgeRuntime,
  bridgeStartupAccess,
  configuredAccess,
  whatsappEntry,
  whatsappSettings,
  type BridgeRuntime,
  type WhatsAppSettings,
} from "../../server/src/connections/whatsapp";
import type { FetchLike } from "../../server/src/hermes/client";
import { json } from "./helpers";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zain-wa-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const settings = (over: Partial<WhatsAppSettings> = {}): WhatsAppSettings => ({
  enabled: true,
  dmPolicy: "open",
  allowsEveryone: true,
  hasAllowlist: true,
  port: 3000,
  ...over,
});
const bridge = (body: unknown): FetchLike => async () => json(body);
const NO_RUNTIME: BridgeRuntime = { logTail: null, envMtimeMs: null, nowMs: 1_790_000_000_000 };
const startup = (accessLine: string) =>
  [
    "2026-10-02 12:30:03,971 🌉 WhatsApp bridge listening on port 3000 (mode: bot)",
    "2026-10-02 12:30:03,971 📁 Session stored in: /x",
    "2026-10-02 12:30:03,973 🔒 Allowed users: *",
    "2026-10-02 12:54:03,668 🌉 WhatsApp bridge listening on port 3000 (mode: bot)",
    "2026-10-02 12:54:03,668 📁 Session stored in: /x",
    `2026-10-02 12:54:03,669 ${accessLine}`,
    "2026-10-02 12:54:05,000 ✅ WhatsApp connected!",
  ].join("\n");
const down: FetchLike = async () => {
  throw new TypeError("connect ECONNREFUSED");
};

describe("WhatsApp settings", () => {
  it("reads enablement, access and the bridge port from the default profile, keeping no numbers", async () => {
    await writeFile(join(home, ".env"), "WHATSAPP_ENABLED='true'\nWHATSAPP_DM_POLICY=open\nWHATSAPP_ALLOWED_USERS=966511111111,*\n");
    const s = await whatsappSettings(home, { platforms: { whatsapp: { enabled: true, extra: { bridge_port: 3123 } } } });
    expect(s).toEqual({ enabled: true, dmPolicy: "open", allowsEveryone: true, hasAllowlist: true, port: 3123 });
    expect(JSON.stringify(s)).not.toContain("9665");
  });

  it("falls back to WHATSAPP_BRIDGE_PORT, then 3000, and to config enablement", async () => {
    await writeFile(join(home, ".env"), "WHATSAPP_BRIDGE_PORT=3456\n");
    expect(await whatsappSettings(home, {})).toMatchObject({ enabled: false, port: 3456, hasAllowlist: false });
    await writeFile(join(home, ".env"), "");
    expect(await whatsappSettings(home, { gateway: { platforms: { whatsapp: { enabled: true } } } })).toMatchObject({ enabled: true, port: 3000 });
  });

  it.each([
    [settings(), "open to anyone"],
    [settings({ allowsEveryone: false }), "allowlist only"],
    [settings({ allowsEveryone: false, hasAllowlist: false, dmPolicy: "pairing" }), "pairing only"],
    [settings({ allowsEveryone: false, hasAllowlist: false }), "no one allowed yet (set WHATSAPP_ALLOWED_USERS=*)"],
    [settings({ dmPolicy: "disabled" }), "DMs disabled"],
  ])("access note %#", (s, note) => expect(accessNote(s)).toBe(note));
});

describe("WhatsApp entry from the bridge", () => {
  it("is green when the bridge reports connected, named for Ahmad when routed", async () => {
    let asked = "";
    const fetchImpl: FetchLike = async (url) => ((asked = String(url)), json({ status: "connected", queueLength: 0, uptime: 12 }));
    expect(await whatsappEntry(settings({ port: 3123 }), true, fetchImpl, NO_RUNTIME)).toEqual({
      id: "channel:whatsapp",
      kind: "channel",
      name: "WhatsApp · Ahmad",
      profile: "zain-hq-accounts",
      status: "ok",
      detail: "Connected · open to anyone",
    });
    expect(asked).toBe("http://127.0.0.1:3123/health");
  });

  it("is yellow for any other bridge status", async () => {
    expect(await whatsappEntry(settings({ allowsEveryone: false }), false, bridge({ status: "waiting_for_qr" }), NO_RUNTIME)).toMatchObject({
      name: "WhatsApp",
      status: "warn",
      detail: "waiting for qr · allowlist only",
    });
  });

  it("is red when the bridge is unreachable while WhatsApp is enabled", async () => {
    expect(await whatsappEntry(settings(), true, down, NO_RUNTIME)).toMatchObject({ status: "error", detail: "Bridge not running (port 3000)" });
  });

  it("is off when WhatsApp is not enabled, without calling the bridge", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => ((called = true), json({}));
    expect(await whatsappEntry(settings({ enabled: false }), true, fetchImpl, NO_RUNTIME)).toMatchObject({
      status: "off",
      detail: "Not enabled — link Ahmad's number in the Hermes dashboard",
    });
    expect(called).toBe(false);
  });
});

describe("the running bridge's effective access", () => {
  it.each([
    ["🔒 Allowed users: *", "open"],
    ["🔒 Allowed users: 966511111111, *", "open"],
    ["🔒 Allowed users: 966511111111", "allowlist"],
    ["🤝 WHATSAPP_DM_POLICY=pairing — unknown DMs are forwarded for gateway pairing.", "pairing"],
    ["🔒 No WHATSAPP_ALLOWED_USERS set — incoming messages are rejected.", "closed"],
    ["🔒 Self-chat mode — only your own messages to yourself are processed.", "self-chat"],
  ])("reads the last startup: %s → %s", (line, access) => expect(bridgeStartupAccess(startup(line))).toBe(access));

  it("is unknown without a startup line", () => {
    expect(bridgeStartupAccess("random output")).toBeNull();
    expect(configuredAccess(settings())).toBe("open");
    expect(configuredAccess(settings({ allowsEveryone: false, hasAllowlist: false, dmPolicy: "pairing" }))).toBe("pairing");
  });

  it("warns to restart when the running bridge predates the settings, without leaking numbers", async () => {
    const runtime = { ...NO_RUNTIME, logTail: startup("🔒 No WHATSAPP_ALLOWED_USERS set — incoming messages are rejected.").replace("Allowed users: *", "Allowed users: 966511111111") };
    const entry = await whatsappEntry(settings(), true, bridge({ status: "connected", uptime: 600 }), runtime);
    expect(entry).toMatchObject({
      status: "warn",
      detail: "Connected · settings changed — restart the gateway to apply (running: rejecting all messages; configured: open to anyone)",
    });
    expect(JSON.stringify(entry)).not.toContain("9665");
  });

  it("is green when the running bridge already applies the settings", async () => {
    const runtime = { ...NO_RUNTIME, logTail: startup("🔒 Allowed users: *") };
    expect(await whatsappEntry(settings(), true, bridge({ status: "connected", uptime: 600 }), runtime)).toMatchObject({ status: "ok", detail: "Connected · open to anyone" });
  });

  it("is yellow when the bridge itself rejects everyone, even if that matches the settings", async () => {
    const runtime = { ...NO_RUNTIME, logTail: startup("🔒 No WHATSAPP_ALLOWED_USERS set — incoming messages are rejected.") };
    const closed = settings({ allowsEveryone: false, hasAllowlist: false, dmPolicy: "open" });
    expect(await whatsappEntry(closed, false, bridge({ status: "connected" }), runtime)).toMatchObject({ status: "warn", detail: "Connected · rejecting all messages" });
  });

  it("falls back to .env mtime vs bridge uptime when the log is unavailable", async () => {
    const nowMs = 1_790_000_000_000;
    const changedAfterStart = { logTail: null, envMtimeMs: nowMs - 60_000, nowMs };
    expect(await whatsappEntry(settings(), false, bridge({ status: "connected", uptime: 600 }), changedAfterStart)).toMatchObject({
      status: "warn",
      detail: "Connected · settings changed — restart the gateway to apply",
    });
    const changedBefore = { logTail: null, envMtimeMs: nowMs - 3_600_000, nowMs };
    expect((await whatsappEntry(settings(), false, bridge({ status: "connected", uptime: 600 }), changedBefore)).status).toBe("ok");
  });

  it("reads only the tail of the default profile's bridge log and the .env mtime", async () => {
    await mkdir(join(home, "platforms", "whatsapp"), { recursive: true });
    await writeFile(join(home, "platforms", "whatsapp", "bridge.log"), `${"x".repeat(40_000)}\n${startup("🔒 Allowed users: *")}`);
    await writeFile(join(home, ".env"), "WHATSAPP_ENABLED=true\n");
    await utimes(join(home, ".env"), 1_790_000_000, 1_790_000_000);
    const runtime = await bridgeRuntime(home, 5);
    expect(runtime.logTail!.length).toBeLessThanOrEqual(32 * 1024);
    expect(bridgeStartupAccess(runtime.logTail!)).toBe("open");
    expect(runtime.envMtimeMs).toBe(1_790_000_000_000);
    expect(await bridgeRuntime(join(home, "missing"), 5)).toEqual({ logTail: null, envMtimeMs: null, nowMs: 5 });
  });
});
