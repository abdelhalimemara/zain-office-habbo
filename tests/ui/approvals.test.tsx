import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { ApprovalsInbox } from "../../src/ui/ApprovalsInbox";
import { board, mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const reviewTasks = [
  task({ id: "r1", title: "Studio rebrand", status: "review", assignee: "zain-studio-vp", latest_summary: "Delivered 3 concepts" }),
  task({ id: "r2", title: "Tech migration", status: "review", tenant: "zain-tech", assignee: "zain-tech-vp", result: "Migrated" }),
  task({ id: "x", title: "Still running", status: "running" }),
  task({ id: "s", title: "Specialist self-review", status: "review", assignee: "zain-studio-copy" }),
];

function setup(extra: Record<string, unknown> = {}) {
  const fetch = mockFetch({ [API.board]: board(reviewTasks), [API.roster]: { agents: rosterEntries }, ...extra });
  renderUi(<ApprovalsInbox />);
  return fetch;
}

async function itemFor(title: string) {
  return (await screen.findByText(title)).closest("article") as HTMLElement;
}

describe("ApprovalsInbox", () => {
  beforeEach(resetStore);

  it("groups review tasks by division with previews", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Approvals (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Zain Studio" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Zain Tech" })).toBeInTheDocument();
    expect(screen.getByText("Delivered 3 concepts")).toBeInTheDocument();
    expect(screen.getByText("Migrated")).toBeInTheDocument();
    expect(screen.queryByText("Still running")).not.toBeInTheDocument();
    const studio = screen.getByRole("heading", { name: "Zain Studio" }).closest("section")!;
    expect(within(studio).queryByText("Specialist self-review")).not.toBeInTheDocument();
  });

  it("lists specialists' review tasks in a collapsed secondary section with the same actions", async () => {
    const fetch = setup({ [`POST ${API.approve("s")}`]: { ok: true } });
    const summary = await screen.findByText("Subtasks waiting for review (1)");
    const section = summary.closest("details")!;
    expect(section).not.toHaveAttribute("open");
    await userEvent.click(summary);
    expect(section).toHaveAttribute("open");
    const item = within(section).getByText("Specialist self-review").closest("article")!;
    await userEvent.click(within(item).getByRole("button", { name: "Approve" }));
    expect(await within(item).findByText(/Approved/)).toBeInTheDocument();
    expect(fetch.calls("POST", API.approve("s"))).toEqual([{ body: {} }]);
    expect(screen.getByRole("heading", { name: "Approvals (2)" })).toBeInTheDocument();
  });

  it("asks for an inline confirmation before Approve & close marks the mandate done", async () => {
    const fetch = setup({ [`POST ${API.approve("r1")}`]: { ok: true } });
    const item = await itemFor("Studio rebrand");
    const close = within(item).getByRole("button", { name: "Approve & close" });
    expect(close).not.toHaveClass("zui-btn--primary");
    expect(close).toHaveAccessibleDescription("Marks the mandate done. Agents stop working on it.");
    await userEvent.click(close);
    const confirm = within(item).getByRole("group", { name: "Confirm close" });
    expect(confirm).toHaveTextContent("Close this mandate as done?");
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(within(item).queryByRole("group", { name: "Confirm close" })).not.toBeInTheDocument();
    expect(fetch.calls("POST", API.approve("r1"))).toHaveLength(0);

    await userEvent.click(within(item).getByRole("button", { name: "Approve & close" }));
    await userEvent.click(within(item).getByRole("button", { name: "Confirm" }));
    expect(await within(item).findByText("Closed — marked done.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.approve("r1"))).toEqual([{ body: {} }]);
  });

  it("Send back to VP is the primary action and requires instructions", async () => {
    const fetch = setup({ [`POST ${API.reject("r2")}`]: { ok: true } });
    const item = await itemFor("Tech migration");
    const send = within(item).getByRole("button", { name: "Send back to VP" });
    expect(send).toHaveClass("zui-btn--primary");
    expect(within(item).queryByRole("button", { name: /Request changes/ })).not.toBeInTheDocument();
    await userEvent.click(send);
    expect(within(item).getByText("Write instructions for VP Tech to send this back.")).toBeInTheDocument();
    expect(within(item).getByLabelText("Instructions for VP Tech")).toHaveAttribute("aria-invalid", "true");
    expect(fetch.calls("POST", API.reject("r2"))).toHaveLength(0);

    await userEvent.type(within(item).getByLabelText("Instructions for VP Tech"), "Add rollback plan");
    await userEvent.click(send);
    expect(await within(item).findByText("Sent back to VP Tech.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.reject("r2"))).toEqual([{ body: { reason: "Add rollback plan" } }]);
  });

  it("keeps the generic Approve / Send back wording for subtask reviews", async () => {
    const fetch = setup({ [`POST ${API.reject("s")}`]: { ok: true } });
    const section = (await screen.findByText("Subtasks waiting for review (1)")).closest("details")!;
    const item = within(section).getByText("Specialist self-review").closest("article")!;
    expect(within(item).queryByRole("button", { name: "Approve & close" })).not.toBeInTheDocument();
    await userEvent.click(within(item).getByRole("button", { name: "Send back" }));
    expect(within(item).getByText("A note is required to send this back.")).toBeInTheDocument();
    await userEvent.type(within(item).getByLabelText(/Note to assignee/), "Cite sources");
    await userEvent.click(within(item).getByRole("button", { name: "Send back" }));
    expect(await within(item).findByText("Sent back to the assignee.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.reject("s"))).toEqual([{ body: { reason: "Cite sources" } }]);
  });

  it("shows the server error message when closing fails", async () => {
    setup({ [`POST ${API.approve("r1")}`]: () => new Response(JSON.stringify({ error: "Hermes isn't reachable." }), { status: 502 }) });
    const item = await itemFor("Studio rebrand");
    await userEvent.click(within(item).getByRole("button", { name: "Approve & close" }));
    await userEvent.click(within(item).getByRole("button", { name: "Confirm" }));
    expect(await within(item).findByRole("alert")).toHaveTextContent("Hermes isn't reachable.");
  });
});
