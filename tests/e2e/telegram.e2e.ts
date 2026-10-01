import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HealthResponse } from "../../shared/api";
import type { KanbanTask } from "../../shared/hermes";
import { FakeHermes, TELEGRAM_HOME } from "./fakeHermes";
import { HERMES_CLI_STUB, openApp, startStack, type Stack } from "./harness";
import { sleep, until } from "./processes";

const BANNER = "document.querySelector('.zui-hud .zui-banner--info')?.textContent ?? null";
let stack: Stack;
let open: KanbanTask;
let done: KanbanTask;
let blocked: KanbanTask;
let specialist: KanbanTask;

// Seeded before the server starts, so its startup reconcile already sees them.
beforeAll(async () => {
  const hermes = new FakeHermes();
  hermes.boards.push("zain-group");
  open = hermes.seedTask({ title: "Open studio mandate", tenant: "zain-studio", assignee: "zain-studio-vp", status: "ready" });
  done = hermes.seedTask({ title: "Finished growth mandate", tenant: "zain-growth", assignee: "zain-growth-vp", status: "done" });
  blocked = hermes.seedTask({ title: "Blocked tech mandate", tenant: "zain-tech", assignee: "zain-tech-vp", status: "blocked" });
  specialist = hermes.seedTask({ title: "Copy pass", tenant: "zain-studio", assignee: "zain-studio-copy", status: "ready" });
  stack = await startStack({ hermes });
});

afterAll(async () => {
  await stack?.stop();
});

const health = async () => (await (await fetch(`${stack.serverUrl}/api/health`)).json()) as HealthResponse;

/** curl-style POST: JSON body, no Origin, no Sec-Fetch-Site (what the CEO's Telegram agent sends). */
function curlPost(path: string, body: unknown): Promise<{ status: number; body: string }> {
  const url = new URL(path, stack.serverUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

const subscriptionsFor = (id: string) => stack.cliCalls().filter((argv) => argv[4] === id);

describe("Telegram approvals", () => {
  it("the server runs the hermes CLI stub, never the real binary", async () => {
    // startStack already refuses to start when any server process sees another HERMES_BIN.
    expect(HERMES_CLI_STUB).toMatch(/tests\/e2e\/hermesCliStub\.mjs$/);
    expect((await health()).telegramApprovals).toBe("needs-sethome");
    expect(stack.cliCalls()).toEqual([]);
  });

  it("HUD says Telegram approvals are off until a home channel exists", async () => {
    const { page, hermes } = stack;
    await openApp(stack);
    const text = await page.waitFor<string>(BANNER, "Telegram approvals banner", 15_000);
    expect(text).toBe("Telegram approvals are off: send /sethome to your Hermes bot in Telegram.");
    await stack.shot("telegram-off");

    hermes.telegramHome = TELEGRAM_HOME;
    expect((await health()).telegramApprovals).toBe("ready");
    await page.waitFor(`!(${BANNER})`, "banner hidden on the next health poll", 15_000);
  });

  it("backfill subscribes each open mandate exactly once and skips done mandates and non-mandates", async () => {
    await until(() => subscriptionsFor(open.id).length > 0 && subscriptionsFor(blocked.id).length > 0, "backfill subscriptions", 40_000);
    expect(subscriptionsFor(open.id)[0]).toEqual([
      "kanban", "--board", "zain-group", "notify-subscribe", open.id, "--platform", "telegram", "--chat-id", "12345",
      "--chat-type", "dm", "--notifier-profile", "default", "--delivery-mode", "wake",
    ]);

    // Let at least one more reconcile run (every 30s) go by, then check nothing was repeated.
    const firstRun = (await health()).reconciler?.lastRunAt;
    await until(async () => (await health()).reconciler?.lastRunAt !== firstRun, "another reconcile run", 40_000);
    await sleep(2_000);
    expect(subscriptionsFor(open.id)).toHaveLength(1);
    expect(subscriptionsFor(blocked.id)).toHaveLength(1);
    expect(subscriptionsFor(done.id)).toEqual([]);
    expect(subscriptionsFor(specialist.id)).toEqual([]);
    expect(stack.cliCalls()).toHaveLength(2);
  });

  it("a curl-style unblock (no Origin) is accepted for a blocked mandate and refused otherwise", async () => {
    const { hermes } = stack;
    const ok = await curlPost(`/api/tasks/${blocked.id}/unblock`, { instructions: "Use the staging API key" });
    expect(ok.status).toBe(200);
    expect(hermes.tasks.get(blocked.id)!.status).toBe("ready");
    expect(hermes.comments.get(blocked.id)).toEqual([expect.objectContaining({ author: "zain-hq-ui", body: "HQ: Use the staging API key" })]);

    expect((await curlPost(`/api/tasks/${open.id}/unblock`, { instructions: "x" })).status).toBe(409);
    expect((await curlPost(`/api/tasks/${specialist.id}/unblock`, { instructions: "x" })).status).toBe(409);
    expect((await curlPost(`/api/tasks/${blocked.id}/unblock`, {})).status).toBe(400);
  });
});
