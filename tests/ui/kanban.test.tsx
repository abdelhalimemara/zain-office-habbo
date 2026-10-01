import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { useUiStore } from "../../src/state/store";
import { KanbanPanel } from "../../src/ui/KanbanPanel";
import { board, mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

describe("KanbanPanel", () => {
  beforeEach(resetStore);

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
    task({ id: "c3", title: "Approved deck", assignee: "zain-studio-vp", status: "done" }),
    task({ id: "g1", title: "Growth ads", tenant: "zain-growth", assignee: "zain-growth-paid", status: "running" }),
  ];

  it("shows only the division's tenant tasks grouped by column", async () => {
    mockFetch({ [API.board]: board(tasks), [API.roster]: { agents: rosterEntries } });
    renderUi(<KanbanPanel division="studio" />);

    const running = await screen.findByRole("region", { name: "running (2)" });
    expect(within(running).getByText("Rebrand Q4")).toBeInTheDocument();
    expect(within(running).getByText("Logo concepts")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "todo (1)" })).getByText("Tagline drafts")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "done (1)" })).getByText("Approved deck")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "review (0)" })).toBeInTheDocument();
    expect(screen.queryByText("Growth ads")).not.toBeInTheDocument();
  });

  it("renders card details and the manager header", async () => {
    mockFetch({ [API.board]: board(tasks), [API.roster]: { agents: rosterEntries } });
    renderUi(<KanbanPanel division="studio" />);

    const card = (await screen.findByText("Rebrand Q4")).closest("button")!;
    expect(within(card).getByText("Mandate")).toBeInTheDocument();
    expect(within(card).getByText("1/3 subtasks")).toBeInTheDocument();
    expect(within(card).getByText("2h")).toBeInTheDocument();
    expect(within(card).getByText("VP Studio")).toBeInTheDocument();
    const child = screen.getByText("Logo concepts").closest("button")!;
    expect(within(child).queryByText("Mandate")).not.toBeInTheDocument();
    expect(within(child).getByText(/⚠ 2/)).toBeInTheDocument();
    expect(within(child).queryByText(/subtasks|0\/1/)).not.toBeInTheDocument();
    expect(screen.getByText("zain-studio-vp")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("opens the task panel when a card is clicked", async () => {
    mockFetch({ [API.board]: board(tasks), [API.roster]: { agents: rosterEntries } });
    renderUi(<KanbanPanel division="studio" />);
    await userEvent.click(await screen.findByText("Tagline drafts"));
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "c2" });
  });
});
