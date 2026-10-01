import { vi } from "vitest";
import { createApp } from "../../server/src/app";
import { HeadcountSource } from "../../server/src/headcount/catalog";
import { HermesClient } from "../../server/src/hermes/client";
import { CeoWake } from "../../server/src/telegram/ceoWake";
import { HERMES_DOWN, HERMES_SESSION_REJECTED } from "../../server/src/http";
import { memoryHireStore } from "../../server/src/org/hireStore";
import { KANBAN, NO_BRIEFS, TOKEN, dashboardHtml, json, setup } from "./helpers";

const get = (app: ReturnType<typeof createApp>, path: string) => app.request(path, { headers: { Host: "127.0.0.1:8787" } });

describe("user-facing Hermes errors", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it("says Hermes is not reachable, keeping the URL and error type in the server log", async () => {
    const hermes = new HermesClient({
      baseUrl: "http://127.0.0.1:9119",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const app = createApp({ hermes, headcount: new HeadcountSource(), hires: memoryHireStore(), ceoWake: new CeoWake({ hermes }), briefs: NO_BRIEFS });
    const res = await get(app, "/api/board");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: HERMES_DOWN });
    expect(text).not.toMatch(/9119|TypeError|127\.0\.0\.1/);
    expect(String(warn.mock.calls[0]?.[0])).toContain("127.0.0.1:9119");
  });

  it("asks for a server restart when Hermes rejects the session, never echoing the token", async () => {
    const { send } = setup({
      "GET /": () => dashboardHtml(),
      [`GET ${KANBAN}/boards`]: () => json({ detail: `bad token ${TOKEN}` }, 401),
    });
    const res = await send("GET", "/api/board");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: HERMES_SESSION_REJECTED });
    expect(text).not.toContain(TOKEN);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
  });
});
