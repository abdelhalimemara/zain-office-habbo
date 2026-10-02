import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { worldInsets } from "../../src/app/worldModel";
import { railVisible } from "../../src/state/rail";
import { loadRailCollapsed, RAIL_COLLAPSED_KEY, useUiStore } from "../../src/state/store";
import { PHONE_QUERY } from "../../src/ui/KanbanPanel";
import { FINISHED_PAGE, MandatesRail } from "../../src/ui/MandatesRail";
import { groupMandates } from "../../src/ui/mandates";
import { UiRoot } from "../../src/ui/UiRoot";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries, task } from "./helpers";

const BODY = "Shoot a 60s launch film.\nWarm, Riyadh-first.\n\n---\n**Instructions for VP Studio (`zain-studio-vp`)**\n\nProtocol…";

const mandates = [
  task({ id: "q1", title: "Queued mandate", status: "todo", assignee: "zain-growth-vp", tenant: "zain-growth", created_at: NOW - 100 }),
  task({ id: "w1", title: "Working older", status: "running", assignee: "zain-tech-vp", tenant: "zain-tech", created_at: NOW - 9000, started_at: NOW - 3600 }),
  task({ id: "w2", title: "Working newer", status: "running", assignee: "zain-labs-vp", tenant: "zain-labs", created_at: NOW - 500 }),
  task({ id: "b1", title: "Blocked mandate", status: "blocked", assignee: "zain-studio-vp", created_at: NOW - 20000 }),
  task({
    id: "a1",
    title: "Launch film",
    status: "review",
    assignee: "zain-studio-vp",
    body: BODY,
    created_at: NOW - 50000,
    dependencyProgress: { done: 2, total: 3 },
  }),
  task({ id: "d1", title: "Done earlier", status: "done", assignee: "zain-studio-vp", completed_at: NOW - 7200 }),
  task({ id: "d2", title: "Done latest", status: "done", assignee: "zain-tech-vp", tenant: "zain-tech", completed_at: NOW - 60 }),
  task({ id: "x1", title: "Archived", status: "archived", assignee: "zain-tech-vp", tenant: "zain-tech" }),
  task({ id: "s1", title: "Specialist subtask", status: "running", assignee: "zain-studio-art" }),
  task({ id: "s2", title: "Specialist review", status: "review", assignee: "zain-studio-copy" }),
];

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

function stubPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query === PHONE_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function open(list = mandates) {
  mockFetch({ [API.board]: board(list), [API.roster]: { agents: rosterEntries } });
  return renderUi(<MandatesRail />);
}

describe("groupMandates", () => {
  it("keeps only mandates, sorts ongoing by urgency then newest, finished by completion", () => {
    const { ongoing, finished } = groupMandates(board(mandates), rosterEntries);
    expect(ongoing.map((t) => t.id)).toEqual(["a1", "b1", "w2", "w1", "q1"]);
    expect(finished.map((t) => t.id)).toEqual(["d2", "d1"]);
  });
});

describe("MandatesRail", () => {
  beforeEach(() => {
    resetStore();
    stubPhone(false);
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("counts ongoing and finished mandates in segmented tabs", async () => {
    open();
    expect(await screen.findByRole("tab", { name: "Ongoing (5)" })).toHaveAttribute("aria-selected", "true");
    const list = screen.getByRole("list", { name: "Ongoing mandates" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector(".zui-mandate__title")!.textContent)).toEqual([
      "Launch film",
      "Blocked mandate",
      "Working newer",
      "Working older",
      "Queued mandate",
    ]);
    await userEvent.click(screen.getByRole("tab", { name: "Finished (2)" }));
    const finished = screen.getByRole("list", { name: "Finished mandates" });
    expect(within(finished).getAllByRole("listitem")).toHaveLength(2);
    expect(within(finished).getByText("Done latest")).toBeInTheDocument();
  });

  it("shows title, brief without the VP protocol, assignee, division, subtasks, status and age", async () => {
    open();
    const card = (await screen.findByText("Launch film")).closest("button")!;
    expect(within(card).getByText(/Shoot a 60s launch film\./)).toHaveTextContent("Shoot a 60s launch film. Warm, Riyadh-first.");
    expect(card).not.toHaveTextContent("Instructions for");
    expect(within(card).getByText("Lina Haddad")).toBeInTheDocument();
    expect(within(card).getByText("Zain Studio")).toBeInTheDocument();
    expect(within(card).getByText("2/3 subtasks")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(within(card).getByText("Awaiting HQ")).toHaveClass("zui-lane-chip--awaiting");
    expect(within(card).getByText("13h ago")).toBeInTheDocument();
    expect(card.querySelector(".zui-portrait img")).toHaveAttribute("alt", "");
    const queued = screen.getByText("Queued mandate").closest("button")!;
    expect(within(queued).getByText("No subtasks yet")).toBeInTheDocument();
    expect(within(queued).getByText("Inbox")).toBeInTheDocument();
    expect(within(screen.getByText("Blocked mandate").closest("button")!).getByText("Blocked")).toHaveClass("zui-lane-chip--blocked");
  });

  it("opens the mandate's division floor with its task overview", async () => {
    open();
    await userEvent.click((await screen.findByText("Working older")).closest("button")!);
    expect(useUiStore.getState().view).toEqual({ kind: "floor", division: "tech" });
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "w1" });
  });

  it("has empty states for both tabs", async () => {
    open([]);
    expect(await screen.findByText("No mandates in progress.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Finished (0)" }));
    expect(screen.getByText("No finished mandates yet.")).toBeInTheDocument();
  });

  it("caps finished mandates with show more", async () => {
    const many = Array.from({ length: FINISHED_PAGE + 5 }, (_, i) =>
      task({ id: `d${i}`, title: `Done ${i}`, status: "done", assignee: "zain-studio-vp", completed_at: NOW - i }),
    );
    open(many);
    await userEvent.click(await screen.findByRole("tab", { name: `Finished (${FINISHED_PAGE + 5})` }));
    expect(within(screen.getByRole("list", { name: "Finished mandates" })).getAllByRole("listitem")).toHaveLength(FINISHED_PAGE);
    await userEvent.click(screen.getByRole("button", { name: "Show more (5)" }));
    expect(within(screen.getByRole("list", { name: "Finished mandates" })).getAllByRole("listitem")).toHaveLength(FINISHED_PAGE + 5);
  });

  it("collapses to a button and remembers it", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Collapse mandates" }));
    expect(localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe("1");
    expect(loadRailCollapsed()).toBe(true);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const toggle = await screen.findByRole("button", { name: "Mandates 5" });
    await userEvent.click(toggle);
    expect(loadRailCollapsed()).toBe(false);
    expect(screen.getByRole("tab", { name: "Ongoing (5)" })).toBeInTheDocument();
  });

  it("survives storage that throws", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { ...memoryStorage(), getItem: blocked, setItem: blocked });
    expect(loadRailCollapsed()).toBe(false);
    expect(() => useUiStore.getState().setRailCollapsed(true)).not.toThrow();
    expect(useUiStore.getState().railCollapsed).toBe(true);
  });

  it("is a collapsed bottom sheet on a phone", async () => {
    stubPhone(true);
    open();
    const bar = await screen.findByRole("button", { name: "Mandates (5)" });
    expect(bar).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await userEvent.click(bar);
    expect(bar).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tab", { name: "Ongoing (5)" })).toBeInTheDocument();
  });
});

describe("rail placement", () => {
  beforeEach(() => {
    resetStore();
    stubPhone(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows only on the city overview while no side panel is open", async () => {
    mockFetch({ [API.board]: board(mandates), [API.roster]: { agents: rosterEntries }, [API.health]: { ok: true, hermes: "reachable", telegram: "connected", board: "zain-group" } });
    renderUi(<UiRoot />);
    expect(await screen.findByRole("region", { name: "Mandates" })).toBeInTheDocument();
    act(() => useUiStore.getState().openPanel({ kind: "approvals" }));
    expect(screen.queryByRole("region", { name: "Mandates" })).not.toBeInTheDocument();
    act(() => useUiStore.getState().closePanel());
    act(() => useUiStore.getState().enterDivision("studio"));
    expect(screen.queryByRole("region", { name: "Mandates" })).not.toBeInTheDocument();
    expect(railVisible({ kind: "city" }, "mandate")).toBe(true);
    expect(railVisible({ kind: "city" }, "task")).toBe(false);
  });

  it("reserves the rail's width (or the phone sheet bar) in the world insets", () => {
    const desktop = { width: 1400, height: 900 };
    const phone = { width: 390, height: 844 };
    expect(worldInsets(null, desktop, 56, { collapsed: false, sheetOpen: false })).toEqual({ top: 64, right: 380, bottom: 0, left: 0 });
    expect(worldInsets(null, desktop, 56, { collapsed: true, sheetOpen: false }).right).toBe(0);
    expect(worldInsets(null, desktop, 56, null).right).toBe(0);
    expect(worldInsets("kanban", desktop, 56, { collapsed: false, sheetOpen: false }).right).toBe(728);
    expect(worldInsets(null, phone, 120, { collapsed: false, sheetOpen: false })).toEqual({ top: 128, right: 0, bottom: 64, left: 0 });
    expect(worldInsets(null, phone, 120, { collapsed: false, sheetOpen: true }).bottom).toBe(506);
  });
});
