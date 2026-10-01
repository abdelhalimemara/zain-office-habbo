import { CONSULTATION_PREFIX } from "../../server/src/org/boardPersona";
import { consultationTitle } from "../../server/src/org/consult";
import { ceoWakeArgs } from "../../server/src/telegram/ceoWake";
import { KANBAN, TELEGRAM_HOME, json, mockExec, setup, task, type Handler } from "./helpers";

const HORMOZI = "zain-board-hormozi";

function consultSetup(hired: string[], extra: Record<string, Handler> = {}, exec = mockExec()) {
  let n = 0;
  return setup(
    {
      "GET /api/profiles": () => ({ profiles: [{ name: "default" }, ...hired.map((name) => ({ name }))] }),
      [`POST ${KANBAN}/tasks`]: (c) => ({ task: task({ id: `t_c${++n}`, status: "ready", ...(c.body as object) }) }),
      [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [TELEGRAM_HOME] }),
      ...extra,
    },
    { exec },
  );
}

describe("POST /api/board/consult", () => {
  it("asks every hired board member by default, one zain-hq task each, waking the CEO per task", async () => {
    const { send, hermesFetch, exec } = consultSetup([HORMOZI, "zain-hq-coo"]);
    const res = await send("POST", "/api/board/consult", { question: "Should Labs raise its revenue share to 20%?", relatedTaskId: "t_2ce68fe1" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.telegramSubscribed).toBe(true);
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(["t_c1"]);
    const created = hermesFetch.called(`POST ${KANBAN}/tasks`);
    expect(created).toHaveLength(1);
    expect(created[0]!.query.get("board")).toBe("zain-group");
    expect(created[0]!.body).toEqual({
      title: "Board consultation: Should Labs raise its revenue share to 20%?",
      body: "Should Labs raise its revenue share to 20%?\n\nRelated task: t_2ce68fe1\n\nAnswer per your board charter.",
      assignee: HORMOZI,
      tenant: "zain-hq",
      triage: false,
    });
    expect(exec.calls.map((c) => c.args)).toEqual([ceoWakeArgs("t_c1", TELEGRAM_HOME)]);
  });

  it("titles with the first 80 characters on one line", () => {
    const title = consultationTitle(`${"a".repeat(70)}\n\n${"b".repeat(40)}`);
    expect(title.startsWith(CONSULTATION_PREFIX)).toBe(true);
    expect(title).toBe(`${CONSULTATION_PREFIX}${"a".repeat(70)} ${"b".repeat(9)}…`);
    expect(consultationTitle("Short?")).toBe("Board consultation: Short?");
  });

  it("refuses when no board member is hired, and names unhired or unknown members", async () => {
    const none = consultSetup([]);
    expect((await none.send("POST", "/api/board/consult", { question: "x" })).status).toBe(409);
    const vacant = consultSetup([]);
    const res = await vacant.send("POST", "/api/board/consult", { question: "x", members: [HORMOZI] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(`not hired yet: ${HORMOZI}`);
    const unknown = consultSetup([HORMOZI]);
    const bad = await unknown.send("POST", "/api/board/consult", { question: "x", members: ["zain-hq-coo"] });
    expect(bad.status).toBe(400);
    expect(unknown.hermesFetch.called(`POST ${KANBAN}/tasks`)).toEqual([]);
  });

  it.each([
    [{}, "question"],
    [{ question: "  " }, "question"],
    [{ question: "x".repeat(8001) }, "question"],
    [{ question: "x", members: [] }, "members"],
    [{ question: "x", members: "zain-board-hormozi" }, "members"],
    [{ question: "x", relatedTaskId: "../boards" }, "relatedTaskId"],
  ])("validates %j", async (input, field) => {
    const { send, hermesFetch } = consultSetup([HORMOZI]);
    const res = await send("POST", "/api/board/consult", input);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(field);
    expect(hermesFetch.called(`POST ${KANBAN}/tasks`)).toEqual([]);
  });

  it("still creates the task when the CEO wake cannot subscribe", async () => {
    const { send } = consultSetup([HORMOZI], { [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [] }) });
    const res = await send("POST", "/api/board/consult", { question: "x" });
    expect(res.status).toBe(201);
    expect((await res.json()).telegramSubscribed).toBe(false);
  });

  it("is behind the write guard but accepts the CEO's curl", async () => {
    const { send } = consultSetup([HORMOZI]);
    expect((await send("POST", "/api/board/consult", { question: "x" }, { "User-Agent": "curl/8" })).status).toBe(201);
    expect((await send("POST", "/api/board/consult", { question: "x" }, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send("POST", "/api/board/consult", { question: "x" }, { Origin: "https://evil.test" })).status).toBe(403);
  });

  it("surfaces Hermes failures as errors", async () => {
    const { send } = consultSetup([HORMOZI], { [`POST ${KANBAN}/tasks`]: () => json({ detail: "db locked" }, 500) });
    expect((await send("POST", "/api/board/consult", { question: "x" })).status).toBe(502);
  });
});
