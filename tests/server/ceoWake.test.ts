import { memoryHireStore } from "../../server/src/org/hireStore";
import { Reconciler } from "../../server/src/org/reconcile";
import { CeoWake, ceoWakeArgs, telegramChatType } from "../../server/src/telegram/ceoWake";
import type { KanbanBoard, KanbanTask, TaskStatus } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";
import { KANBAN, TELEGRAM_HOME, json, mockExec, setup, task, type Handler } from "./helpers";

const homes = (list: unknown[]): Handler => () => ({ home_channels: list });

function boardOf(tasks: KanbanTask[]): KanbanBoard {
  const names: TaskStatus[] = ["triage", "todo", "ready", "running", "blocked", "review", "done"];
  return { columns: names.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })), tenants: [], assignees: [], latest_event_id: 1, now: 2 };
}

function wake(routes: Record<string, Handler>, exec = mockExec()) {
  const s = setup(routes, { exec });
  return { ...s, wake: new CeoWake({ hermes: s.hermes, execFile: exec.execFile, hermesBin: "/opt/hermes/bin/hermes", log: () => undefined }) };
}

describe("ceoWakeArgs", () => {
  it("builds the exact notify-subscribe command for the CEO's Telegram session", () => {
    expect(ceoWakeArgs("t_2ce68fe1", TELEGRAM_HOME)).toEqual([
      "kanban",
      "--board",
      "zain-group",
      "notify-subscribe",
      "t_2ce68fe1",
      "--platform",
      "telegram",
      "--chat-id",
      "6606232800",
      "--chat-type",
      "dm",
      "--notifier-profile",
      "default",
      "--delivery-mode",
      "wake",
    ]);
  });

  it("sends dm for a Telegram DM home whose chat_type is null, as the live home channel is", () => {
    const live = { ...TELEGRAM_HOME, chat_type: null };
    expect(telegramChatType(live)).toBe("dm");
    const args = ceoWakeArgs("t_2ce68fe1", live);
    expect(args.slice(args.indexOf("--chat-type"), args.indexOf("--chat-type") + 2)).toEqual(["--chat-type", "dm"]);
  });

  it("uses the home channel's chat_type when the CLI accepts it, otherwise infers it", () => {
    expect(telegramChatType({ ...TELEGRAM_HOME, chat_type: "group" })).toBe("group");
    expect(telegramChatType({ ...TELEGRAM_HOME, chat_type: " Channel " })).toBe("channel");
    expect(telegramChatType({ ...TELEGRAM_HOME, chat_type: "forum", chat_id: "-1001", thread_id: "7" })).toBe("thread");
    expect(telegramChatType({ ...TELEGRAM_HOME, chat_type: "private" })).toBe("dm");
    expect(telegramChatType({ ...TELEGRAM_HOME, chat_type: "" })).toBe("dm");
  });

  it("passes the topic thread and infers group or thread chat types", () => {
    const topic = { ...TELEGRAM_HOME, chat_id: "-1001234", thread_id: "42" };
    expect(ceoWakeArgs("t_1", topic)).toEqual(expect.arrayContaining(["--thread-id", "42", "--chat-type", "thread"]));
    expect(ceoWakeArgs("t_1", topic).indexOf("--thread-id")).toBe(9);
    expect(telegramChatType({ ...TELEGRAM_HOME, chat_id: "-1001234" })).toBe("group");
    expect(ceoWakeArgs("t_1", TELEGRAM_HOME)).not.toContain("--thread-id");
  });
});

describe("CeoWake.subscribe", () => {
  it("runs the hermes binary directly (no shell) with a 20s timeout", async () => {
    const { wake: w, exec } = wake({ [`GET ${KANBAN}/home-channels`]: homes([TELEGRAM_HOME]) });
    expect(await w.subscribe("t_abc")).toEqual({ subscribed: true });
    expect(exec.calls).toEqual([{ file: "/opt/hermes/bin/hermes", args: ceoWakeArgs("t_abc", TELEGRAM_HOME), timeout: 20_000 }]);
  });

  it.each(["", "-rf", "--board", "t abc", "t;rm -rf /", "x".repeat(65), "t/../x"])("refuses task id %j without running anything", async (id) => {
    const { wake: w, exec, hermesFetch } = wake({ [`GET ${KANBAN}/home-channels`]: homes([TELEGRAM_HOME]) });
    expect(await w.subscribe(id)).toEqual({ subscribed: false, reason: "invalid-task-id" });
    expect(exec.calls).toEqual([]);
    expect(hermesFetch.called(`GET ${KANBAN}/home-channels`)).toEqual([]);
  });

  it("subscribes from a live-shaped home channel with chat_type null", async () => {
    const live = { ...TELEGRAM_HOME, chat_type: null, subscribed: false };
    const { wake: w, exec } = wake({ [`GET ${KANBAN}/home-channels`]: homes([live]) });
    expect(await w.subscribe("t_abc")).toEqual({ subscribed: true });
    expect(exec.calls[0]!.args).toContain("dm");
    expect(exec.calls[0]!.args).not.toContain("null");
  });

  it("does not exec without a Telegram home channel", async () => {
    const { wake: w, exec } = wake({ [`GET ${KANBAN}/home-channels`]: homes([{ ...TELEGRAM_HOME, platform: "discord" }]) });
    expect(await w.subscribe("t_abc")).toEqual({ subscribed: false, reason: "no-home-channel" });
    expect(exec.calls).toEqual([]);
  });

  it("reports Hermes or CLI failures without throwing", async () => {
    const down = wake({ [`GET ${KANBAN}/home-channels`]: () => json({ detail: "x" }, 500) });
    expect(await down.wake.subscribe("t_abc")).toEqual({ subscribed: false, reason: "hermes-unavailable" });
    const failing = wake({ [`GET ${KANBAN}/home-channels`]: homes([TELEGRAM_HOME]) }, mockExec(() => true));
    expect(await failing.wake.subscribe("t_abc")).toEqual({ subscribed: false, reason: "cli-failed" });
  });

  it("is what mandate creation uses, reporting a CLI failure on the response", async () => {
    const exec = mockExec(() => true);
    const { send } = setup(
      {
        [`POST ${KANBAN}/tasks`]: () => ({ task: task({ id: "t_new", status: "ready" }) }),
        [`GET ${KANBAN}/home-channels`]: homes([TELEGRAM_HOME]),
      },
      { exec },
    );
    const res = await send("POST", "/api/mandates", { division: "tech", title: "Ship" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ telegramSubscribed: false, telegramReason: "cli-failed" });
    expect(exec.calls.map((c) => c.args)).toEqual([ceoWakeArgs("t_new", TELEGRAM_HOME)]);
  });
});

describe("CeoWake.backfill", () => {
  const open = [
    task({ id: "t_m1", status: "blocked", assignee: "zain-hq-coo", tenant: "zain-hq" }),
    task({ id: "t_m2", status: "review", assignee: "zain-tech-vp", tenant: "zain-tech" }),
  ];
  const ignored = [
    task({ id: "t_done", status: "done", assignee: "zain-tech-vp" }),
    task({ id: "t_sub", status: "running", assignee: "zain-tech-qa" }),
  ];

  it("subscribes each open mandate once per process and skips done mandates and subtasks", async () => {
    const { wake: w, exec } = wake({ [`GET ${KANBAN}/home-channels`]: homes([TELEGRAM_HOME]) });
    const board = boardOf([...open, ...ignored]);
    expect(await w.backfill(board, ROSTER)).toBe(2);
    expect(await w.backfill(board, ROSTER)).toBe(0);
    expect(exec.calls.map((c) => c.args[4])).toEqual(["t_m1", "t_m2"]);
  });

  it("retries a failed subscription on the next run", async () => {
    let failing = true;
    const exec = mockExec((args) => failing && args[4] === "t_m2");
    const { wake: w } = wake({ [`GET ${KANBAN}/home-channels`]: homes([TELEGRAM_HOME]) }, exec);
    expect(await w.backfill(boardOf(open), ROSTER)).toBe(1);
    failing = false;
    expect(await w.backfill(boardOf(open), ROSTER)).toBe(1);
    expect(exec.calls.map((c) => c.args[4])).toEqual(["t_m1", "t_m2", "t_m2"]);
  });

  it("skips everything without a home channel and does not mark tasks done", async () => {
    let list: unknown[] = [];
    const { wake: w, exec } = wake({ [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: list }) });
    expect(await w.backfill(boardOf(open), ROSTER)).toBe(0);
    expect(exec.calls).toEqual([]);
    list = [TELEGRAM_HOME];
    expect(await w.backfill(boardOf(open), ROSTER)).toBe(2);
  });

  it("runs as part of each reconciler run", async () => {
    const exec = mockExec();
    const { hermes, wake: w } = wake(
      { [`GET ${KANBAN}/home-channels`]: homes([TELEGRAM_HOME]), [`GET ${KANBAN}/board`]: () => boardOf(open) },
      exec,
    );
    const r = new Reconciler({ hermes, hires: memoryHireStore(), ceoWake: w, log: () => undefined });
    await r.run();
    expect(exec.calls.map((c) => c.args[4])).toEqual(["t_m1", "t_m2"]);
    expect(r.status().lastRunAt).not.toBeNull();
  });
});
