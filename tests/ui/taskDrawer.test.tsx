import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API, type TaskDetailResponse } from "@shared/api";
import { COMMENT_HELP, TaskDrawer } from "../../src/ui/TaskDrawer";
import { mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const evil = '<script>window.__pwned = true</script><img src=x onerror="window.__pwned=true">';

function detail(status: "review" | "running" | "done", assignee = "zain-tech-vp"): TaskDetailResponse {
  return {
    task: task({ id: "t1", title: "Launch site", status, assignee, body: `Line one\n${evil}`, result: "Done\n  indented" }),
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

  it("explains that comments don't start work and posts them as notes", async () => {
    const fetch = mockFetch({
      [API.task("t1")]: detail("running"),
      [API.roster]: { agents: rosterEntries },
      [`POST ${API.taskComments("t1")}`]: { ok: true },
    });
    renderUi(<TaskDrawer id="t1" />);
    const box = await screen.findByLabelText("Comment");
    expect(box).toHaveAccessibleDescription(COMMENT_HELP);
    expect(screen.queryByRole("button", { name: "Send as instructions to VP" })).not.toBeInTheDocument();
    await userEvent.type(box, "Looks good");
    await userEvent.click(screen.getByRole("button", { name: "Add comment" }));
    expect(await screen.findByText("Comment posted.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.taskComments("t1"))).toEqual([{ body: { body: "Looks good" } }]);
  });

  it("offers mandate decisions in review and sends a comment as VP instructions in one click", async () => {
    const fetch = mockFetch({
      [API.task("t1")]: detail("review"),
      [API.roster]: { agents: rosterEntries },
      [`POST ${API.reject("t1")}`]: { ok: true },
    });
    renderUi(<TaskDrawer id="t1" />);
    expect(await screen.findByRole("button", { name: "Send back to VP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve & close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText("Want the VP to act on this? Use 'Send back to VP' above.")).toBeInTheDocument();
    expect(screen.getByLabelText("Comment")).toHaveAccessibleDescription(COMMENT_HELP);
    const send = screen.getByRole("button", { name: "Send as instructions to VP" });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Comment"), "Key is set, go ahead");
    await userEvent.click(send);
    expect(await screen.findByText("Sent to VP Tech as instructions.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.reject("t1"))).toEqual([{ body: { reason: "Key is set, go ahead" } }]);
  });

  it("offers Reopen with instructions on a done mandate, with Add note only as the secondary path", async () => {
    const fetch = mockFetch({
      [API.task("t1")]: detail("done"),
      [API.roster]: { agents: rosterEntries },
      [`POST ${API.reopen("t1")}`]: { task: {} },
      [`POST ${API.taskComments("t1")}`]: { ok: true },
    });
    renderUi(<TaskDrawer id="t1" />);
    const box = await screen.findByLabelText("Instructions or note");
    expect(box).toHaveAccessibleDescription(COMMENT_HELP);
    expect(screen.queryByRole("button", { name: "Add comment" })).not.toBeInTheDocument();
    const reopen = screen.getByRole("button", { name: "Reopen with instructions" });
    expect(reopen).toHaveClass("zui-btn--primary");
    await userEvent.type(box, "Lets reopen this, the key is set");
    await userEvent.click(reopen);
    expect(await screen.findByText("Reopened for VP Tech.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.reopen("t1"))).toEqual([{ body: { instructions: "Lets reopen this, the key is set" } }]);

    await userEvent.type(box, "FYI only");
    await userEvent.click(screen.getByRole("button", { name: "Add note only" }));
    expect(await screen.findByText("Comment posted.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.taskComments("t1"))).toEqual([{ body: { body: "FYI only" } }]);
  });

  it("keeps generic review actions and a plain comment box for non-mandates", async () => {
    mockFetch({ [API.task("t1")]: detail("review", "zain-tech-qa"), [API.roster]: { agents: rosterEntries } });
    renderUi(<TaskDrawer id="t1" />);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
    expect(screen.queryByText(/Want the VP to act/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send as instructions to VP" })).not.toBeInTheDocument();
  });

  function mandate(body: string): TaskDetailResponse {
    return { ...detail("running"), task: task({ id: "t1", title: "Rebrand", status: "running", assignee: "zain-studio-vp", body }), comments: [] };
  }

  it("shows HQ's brief and folds the VP instructions into a collapsed details", async () => {
    const body = `Refresh the logo\n  keep the gold\n\n---\n**Instructions for VP Studio (\`zain-studio-vp\`)**\n\n${evil}`;
    mockFetch({ [API.task("t1")]: mandate(body), [API.roster]: { agents: rosterEntries } });
    const { container } = renderUi(<TaskDrawer id="t1" />);
    const brief = await screen.findByText(/Refresh the logo/);
    expect(brief.textContent).toBe("Refresh the logo\n  keep the gold");
    const summary = screen.getByText("Instructions sent to VP Studio");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("**Instructions for VP Studio");
    expect(brief).not.toHaveTextContent("Instructions for");
    expect(container.querySelector("script, img")).toBeNull();
  });

  it("mutes the no-brief placeholder", async () => {
    mockFetch({
      [API.task("t1")]: mandate("(No further brief provided.)\n\n---\n**Instructions for VP Studio (`zain-studio-vp`)**"),
      [API.roster]: { agents: rosterEntries },
    });
    renderUi(<TaskDrawer id="t1" />);
    expect(await screen.findByText("(No further brief provided.)")).toHaveClass("zui-text--muted");
  });
});

