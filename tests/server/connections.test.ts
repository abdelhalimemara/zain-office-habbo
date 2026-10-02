import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatewayEntry, gmailEntry, platformEntries, platformStatus } from "../../server/src/connections/channels";
import { readEnvKey, redact, type RunCommand } from "../../server/src/connections/run";
import { mcpRemoteUrl } from "../../server/src/connections/tools";
import type { CronJob } from "../../server/src/hermes/client";
import { KANBAN, TELEGRAM_HOME, json, setup, stubConnections, type Handler } from "./helpers";

const NOW = 1_790_000_000;
const STATUS = {
  gateway_state: "running",
  gateway_running: true,
  gateway_platforms: {
    telegram: { state: "connected" },
    "zain-hq-accounts:whatsapp": { state: "disabled", error_code: "multiplex_shared_ingress", error_message: "not served under multiplex" },
  },
};
const ROUTE = { gateway: { profile_routes: [{ name: "zain-ahmad-whatsapp", platform: "whatsapp", profile: "zain-hq-accounts" }] } };
const JOB: CronJob = { id: "j1", name: "zain-ahmad-gmail-inbox", schedule_display: "every 15m", state: "scheduled", enabled: true, last_run_at: new Date((NOW - 180) * 1000).toISOString(), last_status: "ok" };

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/status": () => STATUS,
    "GET /api/config": () => ROUTE,
    "GET /api/cron/jobs": () => [JOB],
    "GET /api/mcp/servers": () => ({
      servers: [
        { name: "adspirer", transport: "stdio", url: null, command: "npx", args: ["-y", "mcp-remote@0.1.49", "https://mcp.adspirer.com/mcp"], auth: null, enabled: true },
        { name: "linear", transport: "http", url: "https://mcp.linear.app", command: null, args: [], auth: "oauth", enabled: true },
        { name: "old", transport: "stdio", url: null, command: "node", args: [], auth: null, enabled: false },
      ],
    }),
    [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [TELEGRAM_HOME] }),
    ...extra,
  };
}

const ok = { code: 0, stdout: "", stderr: "" };

describe("channel state mapping", () => {
  it.each([
    [{ state: "connected" }, "ok"],
    [{ state: "connected", needs_attention: true }, "warn"],
    [{ state: "connecting" }, "warn"],
    [{ state: "retrying" }, "warn"],
    [{ state: "error" }, "error"],
    [{ state: "disconnected" }, "error"],
    [{ state: "disabled" }, "off"],
    [{ state: "something-new" }, "warn"],
  ])("%j → %s", (p, expected) => expect(platformStatus(p)).toBe(expected));

  it("maps the gateway state", () => {
    expect(gatewayEntry({ gateway_state: "running" }).status).toBe("ok");
    expect(gatewayEntry({ gateway_state: "draining" })).toMatchObject({ status: "warn", detail: "Draining" });
    expect(gatewayEntry({ gateway_state: "stopped" }).status).toBe("error");
  });

  it("leaves WhatsApp to the bridge probe and hides Ahmad's expected multiplex-disabled slot", () => {
    const entries = platformEntries({ gateway_platforms: { ...STATUS.gateway_platforms, whatsapp: { state: "disconnected" }, slack: { state: "connected" } } });
    expect(entries.map((e) => [e.id, e.name, e.status])).toEqual([
      ["channel:telegram", "Telegram", "ok"],
      ["channel:slack", "Slack", "ok"],
    ]);
  });

  it("explains errors from the platform message without secrets", () => {
    const [e] = platformEntries({ gateway_platforms: { discord: { state: "error", error_message: "401 for token ghp_abcdefghijklmnop1234" } } });
    expect(e).toMatchObject({ name: "Discord", status: "error" });
    expect(e!.detail).not.toContain("ghp_");
  });
});

describe("Gmail · Ahmad", () => {
  const valid = { ok: true, detail: "" };
  it.each([
    [{ ok: false, detail: "" }, JOB, "error", "token invalid"],
    [valid, undefined, "warn", "not set up"],
    [valid, { ...JOB, state: "paused" }, "warn", "paused"],
    [valid, { ...JOB, last_run_at: null }, "ok", "first run"],
    [valid, JOB, "ok", "Last inbox check 3 min ago"],
    [valid, { ...JOB, last_status: "error" }, "warn", "error"],
    [valid, { ...JOB, last_run_at: new Date((NOW - 3600) * 1000).toISOString() }, "warn", "overdue"],
  ])("%# token/job → %s", (token, job, status, text) => {
    const entry = gmailEntry(token, job as CronJob | undefined, NOW);
    expect(entry.status).toBe(status);
    expect(entry.detail).toContain(text);
    expect(entry.profile).toBe("zain-hq-accounts");
  });
});

describe("helpers", () => {
  it("redacts token-shaped text and known secrets", () => {
    expect(redact("token ntn_abcdefghij1234 and Bearer xyz.abc")).toBe("token [redacted] and [redacted]");
    expect(redact("my secret is hunter2-pw", ["hunter2-pw"])).toBe("my secret is [redacted]");
    expect(redact("x".repeat(200))).toBe("[redacted]");
  });

  it("reads one key from a dotenv file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zain-env-"));
    await writeFile(join(dir, ".env"), "A=1\nNOTION_API_TOKEN='ntn_abc'\nexport B=\"x\\\"y\"\n");
    expect(await readEnvKey(join(dir, ".env"), "NOTION_API_TOKEN")).toBe("ntn_abc");
    expect(await readEnvKey(join(dir, ".env"), "B")).toBe('x"y');
    expect(await readEnvKey(join(dir, ".env"), "MISSING")).toBeNull();
    expect(await readEnvKey(join(dir, "nope"), "A")).toBeNull();
    await rm(dir, { recursive: true });
  });

  it("finds the URL behind an mcp-remote proxy", () => {
    expect(mcpRemoteUrl({ name: "a", transport: "stdio", url: null, command: "npx", args: ["-y", "mcp-remote@0.1.49", "https://x.test/mcp", "--transport"], auth: null, enabled: true })).toBe("https://x.test/mcp");
    expect(mcpRemoteUrl({ name: "b", transport: "http", url: "https://y", command: null, args: [], auth: null, enabled: true })).toBeNull();
  });
});

describe("GET /api/connections", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "zain-conn-home-"));
    await writeFile(
      join(home, ".env"),
      "NOTION_API_TOKEN='ntn_supersecret0123456'\nWHATSAPP_ENABLED=true\nWHATSAPP_DM_POLICY=open\nWHATSAPP_ALLOWED_USERS=*,966500000000\n",
    );
  });
  afterEach(() => rm(home, { recursive: true, force: true }));

  function app(run: RunCommand, extra: Record<string, Handler> = {}, overrides: Parameters<typeof stubConnections>[2] = {}) {
    return setup(routes(extra), {
      connections: (hermes, ceoWake) =>
        stubConnections(hermes, ceoWake, {
          run,
          home,
          now: () => NOW * 1000,
          ahmadPython: async () => ({ code: 0, stdout: "AUTHENTICATED" }),
          defaultPython: async () => ({ code: 0, stdout: "AUTHENTICATED" }),
          tokens: { hermesToken: async () => false, mcpRemoteToken: async (url) => url === "https://mcp.adspirer.com/mcp" },
          fetchImpl: async (url) => (String(url) === "http://127.0.0.1:3000/health" ? json({ status: "connected", queueLength: 0 }) : json({}, 404)),
          ...overrides,
        }),
    });
  }

  const healthyRun: RunCommand = async (file, args) => {
    if (file.endsWith("hermes")) return { ...ok, stdout: "Hermes Agent v1.2.3\n" };
    if (file === "ntn") return { ...ok, stdout: "Abdelhalim (abdelhalim@zain.sa)\n" };
    if (file === "gh") return { ...ok, stderr: "github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Token: gho_************************************\n" };
    throw new Error(`unexpected ${file} ${args.join(" ")}`);
  };

  it("lists channels, then MCP servers, then CLIs, with plain details and no secrets", async () => {
    const calls: { file: string; env?: NodeJS.ProcessEnv }[] = [];
    const { send } = app(async (file, args, opts) => (calls.push({ file, env: opts.env }), healthyRun(file, args, opts)));
    const res = await send("GET", "/api/connections");
    expect(res.status).toBe(200);
    const text = await res.text();
    const { connections } = JSON.parse(text) as { connections: { id: string; kind: string; status: string; detail: string; checkedAt: number }[] };
    expect(connections.map((c) => [c.id, c.status])).toEqual([
      ["channel:gateway", "ok"],
      ["channel:telegram", "ok"],
      ["channel:telegram-approvals", "ok"],
      ["channel:whatsapp", "ok"],
      ["channel:gmail-ahmad", "ok"],
      ["mcp:adspirer", "ok"],
      ["mcp:linear", "error"],
      ["mcp:old", "off"],
      ["cli:hermes", "ok"],
      ["cli:ntn", "ok"],
      ["cli:gh", "ok"],
      ["cli:google-workspace", "ok"],
    ]);
    expect(connections.every((c) => c.checkedAt === NOW)).toBe(true);
    expect(connections.find((c) => c.id === "cli:gh")!.detail).toBe("Logged in to github.com as octo");
    expect(text).not.toContain("ntn_supersecret");
    expect(text).not.toContain("gho_");
    expect(text).not.toContain("966500000000");
    expect(connections.find((c) => c.id === "channel:whatsapp")).toMatchObject({ name: "WhatsApp · Ahmad", detail: "Connected · open to anyone" });
    expect(calls.find((c) => c.file === "ntn")!.env!.NOTION_API_TOKEN).toBe("ntn_supersecret0123456");
  });

  it("caches for 30 seconds with a single refresh in flight", async () => {
    let t = NOW * 1000;
    let statusCalls = 0;
    const { send } = app(healthyRun, { "GET /api/status": () => (statusCalls++, STATUS) }, { now: () => t });
    await Promise.all([send("GET", "/api/connections"), send("GET", "/api/connections")]);
    expect(statusCalls).toBe(1);
    t += 29_000;
    await send("GET", "/api/connections");
    expect(statusCalls).toBe(1);
    t += 2_000;
    await send("GET", "/api/connections");
    expect(statusCalls).toBe(2);
  });

  it("turns a hanging probe into an error entry instead of failing the request", async () => {
    const hang: RunCommand = (file, args, opts) => (file === "gh" ? new Promise(() => undefined) : healthyRun(file, args, opts));
    const { send } = app(hang, {}, { timeoutMs: 50 });
    const { connections } = await (await send("GET", "/api/connections")).json();
    expect(connections.find((c: { id: string }) => c.id === "cli:gh")).toMatchObject({ status: "error", detail: "Check failed: timed out after 0.05s" });
    expect(connections.find((c: { id: string }) => c.id === "cli:ntn").status).toBe("ok");
  });

  it("reports missing CLIs as off and failed auth as error, redacted", async () => {
    const run: RunCommand = async (file) =>
      file === "ntn" ? { code: 1, stdout: "", stderr: "invalid token ntn_supersecret0123456" } : { code: 127, stdout: "", stderr: "" };
    const { send } = app(run, {}, { defaultPython: async () => ({ code: 1, stdout: "" }) });
    const text = await (await send("GET", "/api/connections")).text();
    const byId = Object.fromEntries((JSON.parse(text).connections as { id: string; status: string }[]).map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ "cli:hermes": "error", "cli:ntn": "error", "cli:gh": "off", "cli:google-workspace": "error" });
    expect(text).not.toContain("ntn_supersecret");
  });

  it("still answers when Hermes is down", async () => {
    const { send } = app(healthyRun, {
      "GET /api/status": () => json({ detail: "x" }, 502),
      "GET /api/mcp/servers": () => json({ detail: "x" }, 502),
    });
    const res = await send("GET", "/api/connections");
    expect(res.status).toBe(200);
    const { connections } = await res.json();
    expect(connections[0]).toMatchObject({ id: "channel:gateway", status: "error" });
    expect(connections.find((c: { id: string }) => c.id === "mcp:servers").status).toBe("error");
    expect(connections.find((c: { id: string }) => c.id === "cli:hermes")).toMatchObject({ status: "error", detail: expect.stringContaining("dashboard unreachable") });
  });

  it("is behind the host guard and never writes to Hermes", async () => {
    const { send, hermesFetch } = app(healthyRun);
    expect((await send("GET", "/api/connections", undefined, { Host: "evil.test" })).status).toBe(403);
    await send("GET", "/api/connections");
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
