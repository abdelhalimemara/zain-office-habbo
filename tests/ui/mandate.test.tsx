import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { NewMandateDialog } from "../../src/ui/NewMandateDialog";
import { mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

function setup(telegramSubscribed: boolean) {
  const fetch = mockFetch({
    [API.roster]: { agents: rosterEntries },
    [`POST ${API.mandates}`]: (init: RequestInit | undefined) => {
      const body = JSON.parse(String(init?.body));
      return { task: task({ id: "m9", title: body.title, status: "triage" }), telegramSubscribed };
    },
  });
  renderUi(<NewMandateDialog division="growth" />);
  return fetch;
}

describe("NewMandateDialog", () => {
  beforeEach(resetStore);

  it("prefills the division and validates the title", async () => {
    const fetch = setup(true);
    expect(screen.getByLabelText("Division")).toHaveValue("growth");
    expect(screen.getByText(/Assigned to VP Growth/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send mandate" }));
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Title"), "x".repeat(201));
    await userEvent.click(screen.getByRole("button", { name: "Send mandate" }));
    expect(screen.getByText(/200 characters or fewer/)).toBeInTheDocument();
    expect(fetch.calls("POST", API.mandates)).toHaveLength(0);
  });

  it("posts the mandate payload and reports the telegram result", async () => {
    const fetch = setup(false);
    await userEvent.selectOptions(screen.getByLabelText("Division"), "labs");
    await userEvent.type(screen.getByLabelText("Title"), "  Launch referral program ");
    await userEvent.type(screen.getByLabelText(/Brief/), "Target 50 partners");
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Send mandate" }));

    expect(await screen.findByRole("heading", { name: "Mandate sent" })).toBeInTheDocument();
    expect(screen.getByText(/Telegram updates are off/)).toBeInTheDocument();
    expect(fetch.calls("POST", API.mandates)).toEqual([
      { body: { division: "labs", title: "Launch referral program", body: "Target 50 partners", priority: 2 } },
    ]);
  });

  it("confirms telegram subscription when available", async () => {
    setup(true);
    await userEvent.type(screen.getByLabelText("Title"), "Q4 plan");
    await userEvent.click(screen.getByRole("button", { name: "Send mandate" }));
    expect(await screen.findByText(/You'll get Telegram updates/)).toBeInTheDocument();
  });
});
