import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { useUiStore } from "../../src/state/store";
import { KanbanPanel, PHONE_QUERY } from "../../src/ui/KanbanPanel";
import { defaultLane, groupByLane, LANES } from "../../src/ui/lanes";
import { board, mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const tasks = [
  task({ id: "m1", title: "Rebrand Q4", assignee: "zain-studio-vp", status: "running", dependencyProgress: { done: 1, total: 3 }, comment_count: 2 }),
  task({
    id: "c1",
    title: "Logo concepts",
    assignee: "zain-studio-art",
    status: "running",
    warnings: { count: 2, highest_severity: "high" },
    progress: { done: 0, total: 1 },
  }),
  task({ id: "c2", title: "Tagline drafts", assignee: "zain-studio-copy", status: "todo" }),
  task({ id: "c4", title: "Moodboard", assignee: "zain-studio-art", status: "triage" }),
  task({ id: "r1", title: "Rebrand review", assignee: "zain-studio-vp", status: "review" }),
  task({ id: "s1", title: "Copy self-review", assignee: "zain-studio-copy", status: "review" }),
  task({ id: "c3", title: "Approved deck", assignee: "zain-studio-vp", status: "done", completed_at: 5 }),
  task({ id: "g1", title: "Growth ads", tenant: "zain-growth", assignee: "zain-growth-paid", status: "running" }),
];

function stubPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query === PHONE_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function open(list = tasks) {
  const fetch = mockFetch({ [API.board]: board(list), [API.roster]: { agents: rosterEntries } });
  renderUi(<KanbanPanel division="studio" />);
  return fetch;
}

describe("lanes", () => {
  it("maps Hermes' statuses onto six manager lanes", () => {
    expect(LANES.map((l) => l.label)).toEqual(["Inbox", "Ready", "Working", "Blocked", "Awaiting HQ", "Done"]);
    expect(LANES.flatMap((l) => l.statuses).sort()).toEqual(["blocked", "done", "ready", "review", "running", "scheduled", "todo", "triage"]);
  });

  it("orders done newest first and opens phones on the lane most needing HQ", () => {
    const g = groupByLane([
      task({ id: "a", status: "done", completed_at: 1 }),
      task({ id: "b", status: "done", completed_at: 9 }),
      task({ id: "x", status: "archived" }),
    ]);
    expect(g.done.map((t) => t.id)).toEqual(["b", "a"]);
    expect(defaultLane(g)).toBe("done");
    expect(defaultLane(groupByLane(tasks))).toBe("awaiting");
    expect(defaultLane(groupByLane([]))).toBe("inbox");
  });

  it("keeps Awaiting HQ for mandates; a specialist's review task reads as blocked", () => {
    const g = groupByLane(tasks, rosterEntries);
    expect(g.awaiting.map((t) => t.id)).toEqual(["r1"]);
    expect(g.blocked.map((t) => t.id)).toEqual(["s1"]);
    expect(defaultLane(groupByLane([task({ id: "s", status: "review", assignee: "zain-studio-copy" })]))).toBe("blocked");
    const hiredVp = { ...rosterEntries[0]!, profile: "zain-studio-vp2", division: "studio" as const, rank: "vp" as const };
    expect(groupByLane([task({ id: "m", status: "review", assignee: "zain-studio-vp2" })], [hiredVp]).awaiting).toHaveLength(1);
  });
});

describe("KanbanPanel on desktop", () => {
  beforeEach(() => {
    resetStore();
    stubPhone(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows only the division's tasks in lanes, collapsing empty ones", async () => {
    open();
    const working = await screen.findByRole("region", { name: "Working (2)" });
    expect(within(working).getByText("Rebrand Q4")).toBeInTheDocument();
    expect(within(working).getByText("Logo concepts")).toBeInTheDocument();
    const inbox = screen.getByRole("region", { name: "Inbox (2)" });
    expect(within(inbox).getByText("Tagline drafts")).toBeInTheDocument();
    expect(within(inbox).getByText("Moodboard")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Awaiting HQ (1)" })).toHaveClass("zui-lane--hq");
    expect(within(screen.getByRole("region", { name: "Done (1)" })).getByText("Approved deck")).toBeInTheDocument();
    const ready = screen.getByRole("region", { name: "Ready (0)" });
    expect(ready).toHaveClass("zui-lane--collapsed");
    expect(within(ready).queryByRole("list")).not.toBeInTheDocument();
    const blocked = screen.getByRole("region", { name: "Blocked (1)" });
    expect(within(blocked).getByText("Copy self-review")).toBeInTheDocument();
    expect(within(blocked).getByText("review")).toHaveClass("zui-tag");
    expect(within(screen.getByRole("region", { name: "Awaiting HQ (1)" })).queryByText("Copy self-review")).not.toBeInTheDocument();
    expect(screen.queryByText("Growth ads")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("shows an empty state instead of lanes when the division has no work", async () => {
    open(tasks.filter((t) => t.tenant === "zain-growth"));
    expect(await screen.findByText("No work in Zain Studio yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Inbox/ })).not.toBeInTheDocument();
  });

  it("tags cards with their raw status only in multi-status lanes", async () => {
    open();
    const inbox = await screen.findByRole("region", { name: "Inbox (2)" });
    expect(within(inbox).getByText("todo")).toHaveClass("zui-tag");
    expect(within(inbox).getByText("triage")).toHaveClass("zui-tag");
    const working = screen.getByRole("region", { name: "Working (2)" });
    expect(within(working).queryByText("running")).not.toBeInTheDocument();
  });

  it("renders card details and the manager header", async () => {
    open();
    const card = (await screen.findByText("Rebrand Q4")).closest("button")!;
    expect(within(card).getByText("Mandate")).toBeInTheDocument();
    expect(within(card).getByText("1/3 subtasks")).toBeInTheDocument();
    expect(within(card).getByText("2h")).toBeInTheDocument();
    expect(within(card).getByText("Lina Haddad")).toBeInTheDocument();
    const child = screen.getByText("Logo concepts").closest("button")!;
    expect(within(child).queryByText("Mandate")).not.toBeInTheDocument();
    expect(within(child).getByText(/⚠ 2/)).toBeInTheDocument();
    expect(within(child).queryByText(/subtasks|0\/1/)).not.toBeInTheDocument();
    expect(screen.getByText("zain-studio-vp")).toBeInTheDocument();
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
  });

  it("shows the latest 10 done tasks with a show-all control", async () => {
    const done = Array.from({ length: 13 }, (_, i) => task({ id: `d${i}`, title: `Done ${i}`, status: "done", completed_at: i }));
    open(done);
    const lane = await screen.findByRole("region", { name: "Done (13)" });
    expect(within(lane).getAllByRole("listitem")).toHaveLength(10);
    expect(within(lane).getByText("Done 12")).toBeInTheDocument();
    expect(within(lane).queryByText("Done 2")).not.toBeInTheDocument();
    await userEvent.click(within(lane).getByRole("button", { name: "Show all 13" }));
    expect(within(lane).getAllByRole("listitem")).toHaveLength(13);
  });

  it("opens the task panel when a card is clicked", async () => {
    open();
    await userEvent.click(await screen.findByText("Tagline drafts"));
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "c2" });
  });
});

describe("KanbanPanel on a phone", () => {
  beforeEach(() => {
    resetStore();
    stubPhone(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows one lane at a time behind tabs with counts, starting on Awaiting HQ", async () => {
    open();
    await screen.findByText("Rebrand review");
    const tabs = screen.getByRole("tablist", { name: "Lanes" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Inbox 2",
      "Ready 0",
      "Working 2",
      "Blocked 1",
      "Awaiting HQ 1",
      "Done 1",
    ]);
    expect(within(tabs).getByRole("tab", { name: "Awaiting HQ 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByText("Rebrand Q4")).not.toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole("tab", { name: "Working 2" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Rebrand Q4");
    expect(screen.queryByText("Rebrand review")).not.toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole("tab", { name: "Ready 0" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Nothing here.");
  });
});
