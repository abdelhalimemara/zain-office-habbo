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
  });

  it("approve calls the approve endpoint with the optional note", async () => {
    const fetch = setup({ [`POST ${API.approve("r1")}`]: { ok: true } });
    const item = await itemFor("Studio rebrand");
    await userEvent.type(within(item).getByLabelText(/Note to manager/), "Great work");
    await userEvent.click(within(item).getByRole("button", { name: "Approve" }));
    expect(await within(item).findByText(/Approved/)).toBeInTheDocument();
    expect(fetch.calls("POST", API.approve("r1"))).toEqual([{ body: { note: "Great work" } }]);
  });

  it("request changes requires a reason before calling reject", async () => {
    const fetch = setup({ [`POST ${API.reject("r2")}`]: { ok: true } });
    const item = await itemFor("Tech migration");
    await userEvent.click(within(item).getByRole("button", { name: "Request changes" }));
    expect(within(item).getByText("A reason is required to request changes.")).toBeInTheDocument();
    expect(within(item).getByLabelText(/Note to manager/)).toHaveAttribute("aria-invalid", "true");
    expect(fetch.calls("POST", API.reject("r2"))).toHaveLength(0);

    await userEvent.type(within(item).getByLabelText(/Note to manager/), "Add rollback plan");
    await userEvent.click(within(item).getByRole("button", { name: "Request changes" }));
    expect(await within(item).findByText("Sent back to the manager.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.reject("r2"))).toEqual([{ body: { reason: "Add rollback plan" } }]);
  });

  it("shows the server error message when approval fails", async () => {
    setup({ [`POST ${API.approve("r1")}`]: () => new Response(JSON.stringify({ error: "Hermes unreachable" }), { status: 502 }) });
    const item = await itemFor("Studio rebrand");
    await userEvent.click(within(item).getByRole("button", { name: "Approve" }));
    expect(await within(item).findByRole("alert")).toHaveTextContent("Hermes unreachable");
  });
});
