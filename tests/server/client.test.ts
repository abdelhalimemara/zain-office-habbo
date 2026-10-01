import { HermesClient, HermesError, HermesUnreachableError } from "../../server/src/hermes/client";
import { KANBAN, TOKEN, dashboardHtml, hermesBase, json, mockFetch } from "./helpers";

const client = (fetchImpl: ReturnType<typeof mockFetch>["fetchImpl"], token?: string) =>
  new HermesClient({ baseUrl: "http://hermes.test/", fetchImpl, token });

describe("HermesClient auth", () => {
  it("scrapes the session token from the dashboard once and reuses it", async () => {
    const m = mockFetch({ ...hermesBase, "GET /api/profiles": () => ({ profiles: [] }) });
    const hermes = client(m.fetchImpl);
    await hermes.listProfiles();
    await hermes.listProfiles();
    expect(m.called("GET /")).toHaveLength(1);
    expect(m.called("GET /api/profiles").map((c) => c.auth)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

  it("refreshes the token once on 401 and retries", async () => {
    const m = mockFetch({
      "GET /": (_c, n) => dashboardHtml(n === 1 ? "stale" : TOKEN),
      "GET /api/profiles": (c) => (c.auth === `Bearer ${TOKEN}` ? { profiles: [] } : json({ detail: "Unauthorized" }, 401)),
    });
    await expect(client(m.fetchImpl).listProfiles()).resolves.toEqual([]);
    expect(m.called("GET /")).toHaveLength(2);
    expect(m.called("GET /api/profiles")).toHaveLength(2);
  });

  it("gives up after one refresh and never leaks the token in the error", async () => {
    const m = mockFetch({ "GET /": () => dashboardHtml(), "GET /api/profiles": () => json({ detail: "Unauthorized" }, 401) });
    const err = await client(m.fetchImpl).listProfiles().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HermesError);
    expect((err as HermesError).status).toBe(401);
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect(m.called("GET /api/profiles")).toHaveLength(2);
  });

  it("uses HERMES_SESSION_TOKEN without scraping", async () => {
    const m = mockFetch({ "GET /api/profiles": () => ({ profiles: [] }) });
    await client(m.fetchImpl, "env-token").listProfiles();
    expect(m.called("GET /")).toHaveLength(0);
    expect(m.calls[0]!.auth).toBe("Bearer env-token");
  });

  it("reports an unauthorized error when the dashboard exposes no token", async () => {
    const m = mockFetch({ "GET /": () => new Response("<html></html>") });
    await expect(client(m.fetchImpl).listProfiles()).rejects.toMatchObject({ status: 401 });
  });

  it("wraps network failures as unreachable", async () => {
    const hermes = client(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(hermes.status()).rejects.toBeInstanceOf(HermesUnreachableError);
  });
});

describe("HermesClient board", () => {
  it("creates the zain-group board once when missing, then pins every kanban call to it", async () => {
    const m = mockFetch({
      "GET /": () => dashboardHtml(),
      [`GET ${KANBAN}/boards`]: () => ({ boards: [{ slug: "default" }] }),
      [`POST ${KANBAN}/boards`]: () => ({ board: { slug: "zain-group" } }),
      [`GET ${KANBAN}/board`]: () => ({ columns: [], tenants: [], assignees: [], latest_event_id: 0, now: 1 }),
    });
    const hermes = client(m.fetchImpl);
    await Promise.all([hermes.board(), hermes.board()]);
    await hermes.board();
    expect(m.called(`GET ${KANBAN}/boards`)).toHaveLength(1);
    const creates = m.called(`POST ${KANBAN}/boards`);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body).toMatchObject({ slug: "zain-group", name: "Zain Group", switch: false });
    expect(m.called(`GET ${KANBAN}/board`).every((c) => c.query.get("board") === "zain-group")).toBe(true);
  });

  it("does not create the board when it already exists", async () => {
    const m = mockFetch({ ...hermesBase });
    await client(m.fetchImpl).ensureBoard();
    expect(m.called(`POST ${KANBAN}/boards`)).toHaveLength(0);
  });

  it("retries ensureBoard after a failure", async () => {
    const m = mockFetch({
      "GET /": () => dashboardHtml(),
      [`GET ${KANBAN}/boards`]: (_c, n) => (n === 1 ? json({ detail: "boom" }, 500) : { boards: [{ slug: "zain-group" }] }),
    });
    const hermes = client(m.fetchImpl);
    await expect(hermes.ensureBoard()).rejects.toBeInstanceOf(HermesError);
    await expect(hermes.ensureBoard()).resolves.toBeUndefined();
  });
});
