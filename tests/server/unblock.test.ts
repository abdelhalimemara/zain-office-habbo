import type { TaskStatus } from "../../shared/hermes";
import { KANBAN, json, setup, task } from "./helpers";

const TASK = `${KANBAN}/tasks/t_abc`;

function unblockSetup(status: TaskStatus, assignee = "zain-growth-vp") {
  return setup({
    [`GET ${TASK}`]: () => ({ task: task({ status, assignee }), comments: [], links: { parents: [], children: [] } }),
    [`POST ${TASK}/comments`]: () => ({ ok: true }),
    [`PATCH ${TASK}`]: () => ({ task: task({ status: "todo", assignee }) }),
  });
}

describe("POST /api/tasks/:id/unblock", () => {
  it("comments HQ's instructions, then moves the blocked mandate to ready for Hermes to re-gate", async () => {
    const { send, hermesFetch } = unblockSetup("blocked");
    const res = await send("POST", "/api/tasks/t_abc/unblock", { instructions: "  Use the staging key  " });
    expect(res.status).toBe(200);
    expect((await res.json()).task.status).toBe("todo");
    const writes = hermesFetch.calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${TASK}/comments`, `PATCH ${TASK}`]);
    expect(writes[0]!.body).toEqual({ body: "HQ: Use the staging key", author: "zain-hq-ui" });
    expect(writes[1]!.body).toEqual({ status: "ready" });
  });

  it.each<TaskStatus>(["review", "done", "running", "todo", "ready"])("refuses a %s mandate with 409 and writes nothing", async (status) => {
    const { send, hermesFetch } = unblockSetup(status);
    expect((await send("POST", "/api/tasks/t_abc/unblock", { instructions: "x" })).status).toBe(409);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("refuses blocked non-mandates", async () => {
    const { send } = unblockSetup("blocked", "zain-growth-seo");
    expect((await send("POST", "/api/tasks/t_abc/unblock", { instructions: "x" })).status).toBe(409);
  });

  it.each([{}, { instructions: " " }, { instructions: "x".repeat(4001) }])("requires 1..4000 chars of instructions: %j", async (body) => {
    const { send, hermesFetch } = unblockSetup("blocked");
    expect((await send("POST", "/api/tasks/t_abc/unblock", body)).status).toBe(400);
    expect(hermesFetch.called(`GET ${TASK}`)).toEqual([]);
  });

  it("accepts curl-style requests (no Origin) but keeps the write guard", async () => {
    const { send } = unblockSetup("blocked");
    expect((await send("POST", "/api/tasks/t_abc/unblock", { instructions: "x" }, { "User-Agent": "curl/8.4.0" })).status).toBe(200);
    expect((await send("POST", "/api/tasks/t_abc/unblock", { instructions: "x" }, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send("POST", "/api/tasks/t_abc/unblock", { instructions: "x" }, { Host: "evil.test" })).status).toBe(403);
    expect((await send("POST", "/api/tasks/t_abc/unblock", { instructions: "x" }, { Origin: "https://evil.test" })).status).toBe(403);
  });

  it("surfaces Hermes refusing the transition", async () => {
    const { send } = setup({
      [`GET ${TASK}`]: () => ({ task: task({ status: "blocked" }), comments: [], links: { parents: [], children: [] } }),
      [`POST ${TASK}/comments`]: () => ({ ok: true }),
      [`PATCH ${TASK}`]: () => json({ detail: "status transition to 'ready' not valid from current state" }, 409),
    });
    expect((await send("POST", "/api/tasks/t_abc/unblock", { instructions: "x" })).status).toBe(409);
  });
});
