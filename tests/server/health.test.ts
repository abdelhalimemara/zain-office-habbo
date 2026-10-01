import { KANBAN, TOKEN, dashboardHtml, json, setup } from "./helpers";

const status = (telegram?: string) => ({
  version: "1",
  gateway_platforms: telegram ? { telegram: { state: telegram } } : {},
});

describe("GET /api/health", () => {
  it("is ok when Hermes is reachable and authorized", async () => {
    const { send } = setup({
      "GET /api/status": () => status("connected"),
      "GET /api/config": () => ({ kanban: { review_dispatch: false } }),
    });
    expect(await (await send("GET", "/api/health")).json()).toEqual({
      ok: true,
      hermes: "reachable",
      telegram: "connected",
      reviewDispatch: "off",
      board: "zain-group",
    });
  });

  it.each([
    [{ kanban: { review_dispatch: true } }, "on"],
    [{ kanban: { auto_decompose: true } }, "on"],
    [{}, "on"],
    [{ kanban: { review_dispatch: 0 } }, "off"],
  ])("reads review dispatch from Hermes config %j as %s, without writing", async (config, expected) => {
    const { send, hermesFetch } = setup({ "GET /api/status": () => status("connected"), "GET /api/config": () => config });
    expect((await (await send("GET", "/api/health")).json()).reviewDispatch).toBe(expected);
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("reports review dispatch unknown when the config cannot be read", async () => {
    const { send } = setup({ "GET /api/status": () => status("connected"), "GET /api/config": () => json({ detail: "x" }, 500) });
    expect(await (await send("GET", "/api/health")).json()).toMatchObject({ ok: true, reviewDispatch: "unknown" });
  });

  it("reports telegram disconnected or unknown", async () => {
    const down = setup({ "GET /api/status": () => status("retrying") });
    expect((await (await down.send("GET", "/api/health")).json()).telegram).toBe("disconnected");
    const missing = setup({ "GET /api/status": () => status() });
    expect((await (await missing.send("GET", "/api/health")).json()).telegram).toBe("unknown");
  });

  it("reports unauthorized when the token is rejected", async () => {
    const { send } = setup({
      "GET /api/status": () => status("connected"),
      "GET /": () => dashboardHtml("bad"),
      [`GET ${KANBAN}/boards`]: () => json({ detail: "Unauthorized" }, 401),
    });
    const body = await (await send("GET", "/api/health")).json();
    expect(body).toMatchObject({ ok: false, hermes: "unauthorized", telegram: "connected" });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("reports unreachable when Hermes is down", async () => {
    const { send } = setup({ "GET /api/status": () => json({ detail: "bad gateway" }, 502) });
    expect(await (await send("GET", "/api/health")).json()).toEqual({
      ok: false,
      hermes: "unreachable",
      telegram: "unknown",
      reviewDispatch: "unknown",
      board: "zain-group",
    });
  });

  it("maps a Hermes outage on other routes to 502 JSON", async () => {
    const { send } = setup({ [`GET ${KANBAN}/boards`]: () => json({ detail: "db locked" }, 500) });
    const res = await send("GET", "/api/board");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "db locked" });
  });
});
