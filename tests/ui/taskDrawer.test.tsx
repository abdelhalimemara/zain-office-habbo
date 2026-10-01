import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API, type TaskDetailResponse } from "@shared/api";
import { TaskDrawer } from "../../src/ui/TaskDrawer";
import { mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const evil = '<script>window.__pwned = true</script><img src=x onerror="window.__pwned=true">';

function detail(status: "review" | "running"): TaskDetailResponse {
  return {
    task: task({ id: "t1", title: "Launch site", status, assignee: "zain-tech-vp", body: `Line one\n${evil}`, result: "Done\n  indented" }),
    comments: [{ id: 1, task_id: "t1", author: "zain-tech-qa", body: evil, created_at: 0 }],
    parents: [],
    children: [],
    subtasks: [],
  };
}

describe("TaskDrawer", () => {
  beforeEach(resetStore);

  it("renders untrusted Hermes text inertly with whitespace preserved", async () => {
    mockFetch({ [API.task("t1")]: detail("running"), [API.roster]: { agents: rosterEntries } });
    const { container } = renderUi(<TaskDrawer id="t1" />);
    expect(await screen.findByText(/Line one/)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(/<script>window.__pwned = true<\/script>/)).toHaveLength(2);
    expect(screen.getByText(/Done/).textContent).toBe("Done\n  indented");
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows approval actions for review tasks and posts comments", async () => {
    const fetch = mockFetch({
      [API.task("t1")]: detail("review"),
      [API.roster]: { agents: rosterEntries },
      [`POST ${API.taskComments("t1")}`]: { ok: true },
    });
    renderUi(<TaskDrawer id="t1" />);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Add comment"), "Looks good");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByText("Comment posted.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.taskComments("t1"))).toEqual([{ body: { body: "Looks good" } }]);
  });
});
