import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API, type TaskDetailResponse } from "@shared/api";
import { useUiStore } from "../../src/state/store";
import { TaskDrawer } from "../../src/ui/TaskDrawer";
import { mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const mandate: TaskDetailResponse = {
  task: task({ id: "m1", title: "Rebrand", status: "blocked", assignee: "zain-studio-vp", progress: { done: 0, total: 1 } }),
  comments: [],
  parents: ["s1", "s2"],
  children: ["x"],
  subtasks: [
    { id: "s1", title: "Logo concepts", status: "done", assignee: "zain-studio-art" },
    { id: "s2", title: "Tagline", status: "running", assignee: "zain-studio-copy" },
  ],
};

describe("TaskDrawer subtasks", () => {
  beforeEach(resetStore);

  it("lists a mandate's subtasks with progress from its dependencies, not Hermes progress", async () => {
    mockFetch({ [API.task("m1")]: mandate, [API.roster]: { agents: rosterEntries } });
    renderUi(<TaskDrawer id="m1" />);
    const list = await screen.findByRole("list", { name: "Subtasks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Art Director")).toBeInTheDocument();
    expect(screen.getByText("1/2 subtasks done")).toBeInTheDocument();
    expect(screen.queryByText(/0\/1/)).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "Tagline" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "s2" });
  });

  it("prefers the board's dependencyProgress and hides the section without subtasks", async () => {
    const plain = { ...mandate, task: { ...mandate.task, dependencyProgress: { done: 3, total: 4 } }, subtasks: [] };
    mockFetch({ [API.task("m1")]: plain, [API.roster]: { agents: rosterEntries } });
    renderUi(<TaskDrawer id="m1" />);
    expect(await screen.findByText("3/4 subtasks done")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Subtasks" })).not.toBeInTheDocument();
  });
});
