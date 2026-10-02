import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API, type TaskDetailResponse, type TaskHistoryEntry, type TaskHistoryKind } from "@shared/api";
import { useUiStore } from "../../src/state/store";
import { HISTORY_KINDS, HistoryTimeline } from "../../src/ui/HistoryTimeline";
import { TaskDrawer } from "../../src/ui/TaskDrawer";
import { mockFetch, NOW, renderUi, resetStore, rosterEntries, task } from "./helpers";

const EVIL = '<img src=x onerror="window.__pwnedHistory=true"><b>bold</b>';
const KINDS = Object.keys(HISTORY_KINDS) as TaskHistoryKind[];

const entries: TaskHistoryEntry[] = KINDS.map((kind, i) => ({
  id: i + 1,
  kind,
  at: NOW - (KINDS.length - i) * 600,
  actor: i === 2 ? "zain-hq-ui" : i % 3 === 0 ? "zain-studio-vp" : i % 3 === 1 ? "zain-studio-art" : null,
  text: `${kind}: ${EVIL}`,
  ...(kind === "subtask-linked" ? { relatedTaskId: "s9" } : {}),
}));

describe("HistoryTimeline", () => {
  beforeEach(resetStore);

  it("renders every kind in order with its label, actor and time, all text inert", () => {
    const { container } = renderUi(<HistoryTimeline entries={[...entries].reverse()} agents={rosterEntries} now={NOW} />);
    const items = within(screen.getByRole("list", { name: "History" })).getAllByRole("listitem");
    expect(items).toHaveLength(KINDS.length);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(HISTORY_KINDS[KINDS[i]!].label);
      expect(within(item).getByText(`${KINDS[i]}: ${EVIL}`)).toBeInTheDocument();
    });
    expect(container.querySelector("b, img:not(.zui-portrait__img), img[src=x]")).toBeNull();
    expect((window as unknown as { __pwnedHistory?: boolean }).__pwnedHistory).toBeUndefined();
    expect(within(items[0]!).getByText("Lina Haddad")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Art Director")).toBeInTheDocument();
    expect(within(items[2]!).getByText("HQ (you)")).toBeInTheDocument();
    const time = items[0]!.querySelector("time")!;
    expect(time).toHaveTextContent("1h ago");
    expect(time.getAttribute("title")).toBe(new Date((NOW - KINDS.length * 600) * 1000).toLocaleString());
  });

  it("opens a linked subtask", async () => {
    renderUi(<HistoryTimeline entries={entries} agents={rosterEntries} now={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: "Open subtask" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "s9" });
  });

  it("is empty-safe", () => {
    renderUi(<HistoryTimeline entries={[]} agents={rosterEntries} now={NOW} />);
    expect(screen.getByText("No history recorded for this task yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
  });
});

describe("TaskDrawer overview", () => {
  beforeEach(resetStore);

  function detail(history: TaskHistoryEntry[] | undefined): TaskDetailResponse {
    return {
      task: task({ id: "m1", title: "Launch film", status: "review", assignee: "zain-studio-vp", dependencyProgress: { done: 1, total: 2 } }),
      comments: [],
      parents: ["s1", "s2"],
      children: [],
      subtasks: [
        { id: "s1", title: "Storyboard", status: "done", assignee: "zain-studio-art" },
        { id: "s2", title: "Edit cuts", status: "running", assignee: "zain-studio-video" },
      ],
      history: history as TaskHistoryEntry[],
    };
  }

  it("shows the lane status, division, assignee, progress, subtask rows and history", async () => {
    mockFetch({ [API.task("m1")]: detail(entries.slice(0, 3)), [API.roster]: { agents: rosterEntries } });
    renderUi(<TaskDrawer id="m1" />);
    const overview = await screen.findByRole("region", { name: "Overview" });
    expect(within(overview).getByText("Awaiting HQ")).toBeInTheDocument();
    expect(within(overview).getByText("Zain Studio")).toBeInTheDocument();
    expect(within(overview).getByText("Lina Haddad")).toBeInTheDocument();
    expect(within(overview).getByText("1/2 subtasks done")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Subtasks" })).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Done")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Working")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Video Producer")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "History" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("copes with a server that has no history yet", async () => {
    mockFetch({ [API.task("m1")]: detail(undefined), [API.roster]: { agents: rosterEntries } });
    renderUi(<TaskDrawer id="m1" />);
    expect(await screen.findByText("No history recorded for this task yet.")).toBeInTheDocument();
  });
});
