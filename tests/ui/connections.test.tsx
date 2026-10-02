import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API, type Connection } from "@shared/api";
import { CONNECTIONS_POLL_MS } from "../../src/api/hooks";
import { checkedAgo, describeCounts, groupConnections, worstStatus } from "../../src/ui/connections";
import { Hud } from "../../src/ui/Hud";
import { PHONE_QUERY } from "../../src/ui/KanbanPanel";
import { board, mockFetch, renderUi, resetStore, rosterEntries } from "./helpers";

const NOW_S = Math.floor(Date.now() / 1000);

const conn = (id: string, kind: Connection["kind"], status: Connection["status"], extra: Partial<Connection> = {}): Connection => ({
  id,
  kind,
  status,
  name: id.split(":")[1]!,
  detail: `${id} detail`,
  checkedAt: NOW_S - 20,
  ...extra,
});

const connections: Connection[] = [
  conn("channel:telegram", "channel", "ok", { name: "Telegram" }),
  conn("channel:whatsapp", "channel", "warn", { name: "WhatsApp · Ahmad", profile: "zain-hq-accounts", detail: "Session expires in 2 days" }),
  conn("channel:email", "channel", "ok", { name: "Email · Ahmad", profile: "zain-hq-accounts" }),
  conn("channel:slack", "channel", "off", { name: "Slack" }),
  conn("mcp:adspirer", "mcp", "error", { name: "Adspirer", detail: '<img src=x onerror="window.__pwnedConn=1">token rejected' }),
  conn("mcp:notion", "mcp", "ok", { name: "Notion" }),
  conn("cli:ntn", "cli", "off", { name: "Notion CLI" }),
];

const health = { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "off", telegramApprovals: "ready", board: "zain-group" };

function stubPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query === PHONE_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function open(routes: Record<string, unknown> = {}) {
  const fetch = mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [API.health]: health,
    [API.connections]: { connections },
    ...routes,
  });
  renderUi(<Hud />);
  return fetch;
}

describe("connection status logic", () => {
  it("takes the worst status, grey only when everything is off", () => {
    expect(worstStatus([{ status: "ok" }, { status: "warn" }, { status: "off" }])).toBe("warn");
    expect(worstStatus([{ status: "ok" }, { status: "error" }, { status: "warn" }])).toBe("error");
    expect(worstStatus([{ status: "off" }, { status: "ok" }])).toBe("ok");
    expect(worstStatus([{ status: "off" }, { status: "off" }])).toBe("off");
    expect(worstStatus([])).toBe("off");
  });

  it("groups by kind with counts, worst first", () => {
    const [channels, mcp, cli] = groupConnections(connections);
    expect(channels).toMatchObject({ label: "Channels", status: "warn", counts: { ok: 2, warn: 1, error: 0, off: 1 } });
    expect(channels!.connections.map((c) => c.name)).toEqual(["WhatsApp · Ahmad", "Email · Ahmad", "Telegram", "Slack"]);
    expect(mcp).toMatchObject({ label: "MCP", status: "error" });
    expect(cli).toMatchObject({ label: "CLI", status: "off" });
    expect(describeCounts(channels!.counts)).toBe("1 needs attention, 2 OK, 1 off");
    expect(describeCounts({ ok: 0, warn: 2, error: 3, off: 0 })).toBe("3 errors, 2 need attention");
    expect(checkedAgo(NOW_S - 20, NOW_S)).toBe("checked 20s ago");
    expect(checkedAgo(NOW_S - 7200, NOW_S)).toBe("checked 2h ago");
  });
});

describe("Connections in the HUD", () => {
  beforeEach(() => {
    resetStore();
    stubPhone(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows one pill per group with its worst status and count", async () => {
    open();
    const cluster = await screen.findByRole("group", { name: "Connections" });
    expect(await within(cluster).findByRole("button", { name: "Channels: Needs attention, 1 needs attention, 2 OK, 1 off" })).toHaveTextContent("Channels!4");
    expect(within(cluster).getByRole("button", { name: "MCP: Error, 1 error, 1 OK" })).toHaveTextContent("MCP✕2");
    expect(within(cluster).getByRole("button", { name: "CLI: Off, 1 off" })).toHaveTextContent("CLI–1");
  });

  it("opens a popover listing the group with status, profile, detail and check time, as plain text", async () => {
    open();
    const channels = await screen.findByRole("button", { name: /^Channels: Needs attention/ });
    await userEvent.click(channels);
    expect(channels).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "Connections" });
    const list = within(dialog).getByRole("list", { name: "Channels connections" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("WhatsApp · Ahmad");
    expect(rows[0]).toHaveTextContent("zain-hq-accounts");
    expect(rows[0]).toHaveTextContent("Session expires in 2 days");
    expect(rows[0]).toHaveTextContent(/checked 2\ds ago/);
    expect(within(rows[0]!).getByText(": Needs attention")).toHaveClass("zui-sr-only");
    await userEvent.click(within(dialog).getByRole("tab", { name: /MCP/ }));
    const mcp = within(dialog).getByRole("list", { name: "MCP connections" });
    expect(within(mcp).getByText('<img src=x onerror="window.__pwnedConn=1">token rejected')).toBeInTheDocument();
    expect(dialog.querySelector("img")).toBeNull();
  });

  it("closes on Escape and returns focus to the pill", async () => {
    open();
    const mcp = await screen.findByRole("button", { name: /^MCP: Error/ });
    await userEvent.click(mcp);
    expect(screen.getByRole("dialog", { name: "Connections" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mcp).toHaveFocus();
  });

  it("keeps the Hermes and Telegram status hooks, showing the Hermes dot only when it is not reachable", async () => {
    open();
    expect(await screen.findByTitle("Hermes: reachable")).toHaveClass("zui-sr-only");
    expect(screen.getByTitle("Telegram: connected")).toBeInTheDocument();
  });

  it("shows the Hermes dot when Hermes is unreachable", async () => {
    open({ [API.health]: { ...health, hermes: "unreachable" } });
    expect(await screen.findByTitle("Hermes: unreachable")).not.toHaveClass("zui-sr-only");
  });

  it("falls back to the Telegram dot when the connections endpoint is missing", async () => {
    open({ [API.connections]: () => new Response(JSON.stringify({ error: "not found" }), { status: 404 }) });
    expect(await screen.findByTitle("Telegram: connected")).not.toHaveClass("zui-sr-only");
    expect(screen.queryByRole("group", { name: "Connections" })).not.toBeInTheDocument();
  });

  it("does not poll in tests", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = open();
    await screen.findByRole("button", { name: /^MCP: Error/ });
    const calls = () => fetch.fn.mock.calls.filter(([u]) => String(u) === API.connections).length;
    expect(calls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTIONS_POLL_MS * 2);
    });
    expect(calls()).toBe(1);
    vi.useRealTimers();
  });
});

describe("Connections on a phone", () => {
  beforeEach(() => {
    resetStore();
    stubPhone(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is one summary dot that opens every group as a sheet", async () => {
    open();
    const dot = await screen.findByRole("button", { name: "Connections: Error, 1 error, 1 needs attention, 3 OK, 2 off" });
    expect(screen.queryByRole("group", { name: "Connections" })).not.toBeInTheDocument();
    await userEvent.click(dot);
    const sheet = screen.getByRole("dialog", { name: "Connections" });
    expect(within(sheet).getByRole("list", { name: "Channels connections" })).toBeInTheDocument();
    expect(within(sheet).getByRole("list", { name: "MCP connections" })).toBeInTheDocument();
    expect(within(sheet).getByRole("list", { name: "CLI connections" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("tablist")).not.toBeInTheDocument();
  });
});
