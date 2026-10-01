import { guardOptions } from "../../server/src/app";
import type { GuardOptions } from "../../server/src/guard";
import { KANBAN, setup, task } from "./helpers";

const board = { columns: [], tenants: [], assignees: [], latest_event_id: 0, now: 1 };
const mandate = { division: "tech", title: "Ship it" };

function app(guard?: GuardOptions) {
  return setup(
    {
      [`GET ${KANBAN}/board`]: () => board,
      [`POST ${KANBAN}/tasks`]: () => ({ task: task({ id: "t_new", status: "triage" }) }),
      [`POST ${KANBAN}/tasks/t_new/home-subscribe/telegram`]: () => ({ ok: true }),
    },
    { guard },
  );
}

describe("local-only guard", () => {
  it.each(["attacker.com", "attacker.com:8787", "127.0.0.1.attacker.com", "0.0.0.0:8787", ""])(
    "refuses GET with Host %j (DNS rebinding)",
    async (host) => {
      const { send, hermesFetch } = app();
      const res = await send("GET", "/api/board", undefined, { Host: host });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden host" });
      expect(hermesFetch.calls).toHaveLength(0);
    },
  );

  it.each(["127.0.0.1", "localhost:5173", "localhost"])("serves GET with Host %j", async (host) => {
    const { send } = app();
    expect((await send("GET", "/api/board", undefined, { Host: host })).status).toBe(200);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""])(
    "refuses a write with Content-Type %j",
    async (type) => {
      const { send, hermesFetch } = app();
      const res = await send("POST", "/api/mandates", mandate, { "Content-Type": type });
      expect(res.status).toBe(415);
      expect((await res.json()).error).toContain("application/json");
      expect(hermesFetch.called(`POST ${KANBAN}/tasks`)).toHaveLength(0);
    },
  );

  it.each([
    "https://attacker.com",
    "http://localhost.attacker.com",
    "http://127.0.0.1.evil:8787",
    "null",
    "http://localhost:3000",
    "http://127.0.0.1",
    "https://localhost:5173",
    "http://localhost:5173/",
  ])(
    "refuses a write from Origin %j",
    async (origin) => {
      const { send, hermesFetch } = app();
      const res = await send("POST", "/api/mandates", mandate, { Origin: origin });
      expect(res.status).toBe(403);
      expect(hermesFetch.called(`POST ${KANBAN}/tasks`)).toHaveLength(0);
    },
  );

  it("refuses a cross-site write even without Origin", async () => {
    const { send, hermesFetch } = app();
    const res = await send("POST", "/api/mandates", mandate, { "Sec-Fetch-Site": "cross-site" });
    expect(res.status).toBe(403);
    expect(hermesFetch.called(`POST ${KANBAN}/tasks`)).toHaveLength(0);
  });

  it("accepts a same-origin localhost JSON write", async () => {
    const { send } = app();
    const res = await send("POST", "/api/mandates", mandate, {
      Host: "localhost:5173",
      Origin: "http://localhost:5173",
      "Content-Type": "application/json; charset=utf-8",
      "Sec-Fetch-Site": "same-origin",
    });
    expect(res.status).toBe(201);
  });

  it.each(["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8787", "http://localhost:8787"])(
    "accepts writes from the Vite and server origin %s",
    async (origin) => {
      expect((await app().send("POST", "/api/mandates", mandate, { Origin: origin })).status).toBe(201);
    },
  );

  it("follows the configured server port and ZAIN_ALLOWED_ORIGINS", async () => {
    const guard = guardOptions(9000, { ZAIN_ALLOWED_ORIGINS: " http://127.0.0.1:4173/ ,http://localhost:4174" });
    const { send } = app(guard);
    const post = async (origin: string) => (await send("POST", "/api/mandates", mandate, { Origin: origin })).status;
    expect(await post("http://localhost:9000")).toBe(201);
    expect(await post("http://localhost:5173")).toBe(201);
    expect(await post("http://127.0.0.1:4173")).toBe(201);
    expect(await post("http://localhost:4174")).toBe(201);
    expect(await post("http://localhost:8787")).toBe(403);
  });
});
