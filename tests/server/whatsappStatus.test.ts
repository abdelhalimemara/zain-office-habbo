import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessNote, whatsappEntry, whatsappSettings, type WhatsAppSettings } from "../../server/src/connections/whatsapp";
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
    expect(await whatsappEntry(settings({ port: 3123 }), true, fetchImpl)).toEqual({
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
    expect(await whatsappEntry(settings({ allowsEveryone: false }), false, bridge({ status: "waiting_for_qr" }))).toMatchObject({
      name: "WhatsApp",
      status: "warn",
      detail: "waiting for qr · allowlist only",
    });
  });

  it("is red when the bridge is unreachable while WhatsApp is enabled", async () => {
    expect(await whatsappEntry(settings(), true, down)).toMatchObject({ status: "error", detail: "Bridge not running (port 3000)" });
  });

  it("is off when WhatsApp is not enabled, without calling the bridge", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => ((called = true), json({}));
    expect(await whatsappEntry(settings({ enabled: false }), true, fetchImpl)).toMatchObject({
      status: "off",
      detail: "Not enabled — link Ahmad's number in the Hermes dashboard",
    });
    expect(called).toBe(false);
  });
});
