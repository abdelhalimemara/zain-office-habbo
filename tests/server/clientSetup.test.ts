import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EMAIL_KEYS, runEmailSetup } from "../../server/src/clientChannels/emailSetup";
import { formatEnvValue, profileEnvPath, upsertEnvText, writeEnvFile } from "../../server/src/clientChannels/envFile";
import { terminalPrompter, type Prompter } from "../../server/src/clientChannels/prompt";
import { toolsetsWithKanban } from "../../server/src/clientChannels/toolsets";
import { ROUTE_NAME, bridgeQrRenderer, runWhatsAppSetup, withAhmadRoute } from "../../server/src/clientChannels/whatsappSetup";
import { json, setup, type Handler } from "./helpers";

const SECRET = "s3cr3t'pa$$ w0rd";
let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "zain-hermes-home-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const mode = async (path: string) => (await stat(path)).mode & 0o777;

function scripted(answers: string[]): Prompter & { asked: { question: string; hidden: boolean }[] } {
  const asked: { question: string; hidden: boolean }[] = [];
  return {
    asked,
    ask: async (question, { hidden = false, fallback } = {}) => {
      asked.push({ question, hidden });
      const next = answers.shift();
      if (next === undefined) throw new Error(`unexpected prompt: ${question}`);
      return next || fallback || "";
    },
    close: () => undefined,
  };
}

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

describe(".env writing", () => {
  it("quotes values the way python-dotenv reads them literally", () => {
    expect(formatEnvValue("plain")).toBe("'plain'");
    expect(formatEnvValue("pa$$ ${HOME}")).toBe("'pa$$ ${HOME}'");
    expect(formatEnvValue(`it's "x" \\`)).toBe(`"it's \\"x\\" \\\\"`);
    expect(() => formatEnvValue("a\nb")).toThrow(/line breaks/);
    expect(() => formatEnvValue("it's ${X}")).toThrow();
  });

  it("replaces existing keys in place and keeps every other line", () => {
    const before = "# keys\nOPENAI_API_KEY=abc\nexport EMAIL_ADDRESS=old@x.com\n";
    expect(upsertEnvText(before, { EMAIL_ADDRESS: "a@zain.sa", EMAIL_PASSWORD: "p" })).toBe(
      "# keys\nOPENAI_API_KEY=abc\nEMAIL_ADDRESS='a@zain.sa'\nEMAIL_PASSWORD='p'\n",
    );
  });

  it("writes mode 600 and backs up the previous file with mode 600", async () => {
    const path = join(home, ".env");
    await writeFile(path, "OPENAI_API_KEY=abc\n", { mode: 0o644 });
    const result = await writeEnvFile(path, { EMAIL_PASSWORD: SECRET }, new Date("2026-10-02T10:00:00Z"));
    expect(await mode(path)).toBe(0o600);
    expect(result.backup).toBe(`${path}.backup-2026-10-02T10-00-00-000Z`);
    expect(await mode(result.backup!)).toBe(0o600);
    expect(await readFile(result.backup!, "utf8")).toBe("OPENAI_API_KEY=abc\n");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("resolves profile .env paths under the Hermes home", () => {
    expect(profileEnvPath("zain-hq-accounts", "/h")).toBe("/h/profiles/zain-hq-accounts/.env");
    expect(profileEnvPath("default", "/h")).toBe("/h/.env");
  });
});

describe("npm run ahmad:email", () => {
  const answers = () => ["not-an-email", "ahmad@zain.sa", SECRET, "", "", "", "smtp.zain.sa", "465", ""];

  it("dry run asks nothing, writes nothing and changes nothing in Hermes", async () => {
    const lines: string[] = [];
    const prompter = scripted([]);
    const { hermes, hermesFetch } = hermesWithConfig();
    expect(await runEmailSetup({ apply: false, hermes, prompter, home, log: (l) => lines.push(l) })).toBe("dry-run");
    expect(prompter.asked).toEqual([]);
    expect(await readdir(home)).toEqual([]);
    expect(hermesFetch.calls).toEqual([]);
    expect(lines.join("\n")).toContain(EMAIL_KEYS.join(", "));
  });

  it("asks for the password hidden, writes the profile .env (600) and enables kanban, never printing the secret", async () => {
    await mkdir(join(home, "profiles", "zain-hq-accounts"), { recursive: true });
    const envPath = profileEnvPath("zain-hq-accounts", home);
    await writeFile(envPath, "OPENAI_API_KEY=abc\n");
    const lines: string[] = [];
    const prompter = scripted(answers());
    const { hermes, hermesFetch } = hermesWithConfig();
    expect(await runEmailSetup({ apply: true, hermes, prompter, home, log: (l) => lines.push(l), now: () => new Date("2026-10-02T10:00:00Z") })).toBe("written");

    expect(prompter.asked.filter((a) => a.hidden).map((a) => a.question)).toEqual(["Email password or app password (hidden)"]);
    expect(prompter.asked.filter((a) => a.question === "Ahmad's email address")).toHaveLength(2);
    const env = await readFile(envPath, "utf8");
    expect(env).toBe(
      [
        "OPENAI_API_KEY=abc",
        "EMAIL_ADDRESS='ahmad@zain.sa'",
        `EMAIL_PASSWORD="s3cr3t'pa$$ w0rd"`,
        "EMAIL_IMAP_HOST='imap.zain.sa'",
        "EMAIL_IMAP_PORT='993'",
        "EMAIL_IMAP_SECURITY='tls'",
        "EMAIL_SMTP_HOST='smtp.zain.sa'",
        "EMAIL_SMTP_PORT='465'",
        "EMAIL_SMTP_SECURITY='tls'",
        "EMAIL_ALLOW_ALL_USERS='true'",
        "",
      ].join("\n"),
    );
    expect(await mode(envPath)).toBe(0o600);
    expect(lines.join("\n")).not.toContain(SECRET);
    expect(JSON.stringify(hermesFetch.calls)).not.toContain(SECRET);
    const put = hermesFetch.called("PUT /api/config")[0]!.body;
    expect(put).toEqual({
      profile: "zain-hq-accounts",
      config: { platform_toolsets: { email: ["hermes-email", "kanban"], whatsapp: ["hermes-whatsapp", "kanban"] } },
    });
    expect(lines.some((l) => l.includes("hermes gateway restart"))).toBe(true);
  });

  it("keeps existing toolsets and does not add kanban twice", () => {
    expect(toolsetsWithKanban(["hermes-email", "web"], "email")).toEqual(["hermes-email", "web", "kanban"]);
    expect(toolsetsWithKanban(["hermes-whatsapp", "kanban"], "whatsapp")).toEqual(["hermes-whatsapp", "kanban"]);
    expect(toolsetsWithKanban(undefined, "email")).toEqual(["hermes-email", "kanban"]);
  });
});

describe("terminal prompter", () => {
  it("never echoes hidden answers", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = "";
    output.on("data", (d: Buffer) => (printed += d.toString()));
    const prompter = terminalPrompter(input, output);
    const answer = prompter.ask("Password", { hidden: true });
    input.write(`${SECRET}\n`);
    expect(await answer).toBe(SECRET);
    const visible = prompter.ask("Host", { fallback: "imap.zain.sa" });
    input.write("\n");
    expect(await visible).toBe("imap.zain.sa");
    prompter.close();
    expect(printed).toContain("Password: ");
    expect(printed).toContain("Host [imap.zain.sa]: ");
    expect(printed).not.toContain(SECRET);
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
