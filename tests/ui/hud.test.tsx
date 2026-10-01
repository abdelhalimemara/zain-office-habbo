import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { useUiStore } from "../../src/state/store";
import { Hud } from "../../src/ui/Hud";
import { UiRoot } from "../../src/ui/UiRoot";
import { board, mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const routes = {
  [API.board]: board([
    task({ id: "a", status: "review", assignee: "zain-studio-vp" }),
    task({ id: "b", status: "review", tenant: "zain-tech", assignee: "zain-tech-vp" }),
    task({ id: "s", status: "review", tenant: "zain-tech", assignee: "zain-tech-qa" }),
    task({ id: "c", status: "running" }),
  ]),
  [API.health]: { ok: true, hermes: "reachable", telegram: "disconnected", reviewDispatch: "off", telegramApprovals: "ready", board: "zain-group" },
  [API.roster]: { agents: rosterEntries },
};

describe("Hud", () => {
  beforeEach(resetStore);

  it("shows the pending approval count and connection states", async () => {
    mockFetch(routes);
    renderUi(<Hud />);
    expect(await screen.findByRole("button", { name: "Approvals, 2 pending" })).toBeInTheDocument();
    expect(await screen.findByTitle("Hermes: reachable")).toBeInTheDocument();
    expect(screen.getByTitle("Telegram: disconnected")).toBeInTheDocument();
    expect(screen.getByText("ZAIN GROUP")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("counts mandates of locally hired VPs from the merged roster", async () => {
    const hiredVp = { profile: "zain-tech-vp2", title: "VP Platform", division: "tech" as const, rank: "vp" as const, reportsTo: "default", skills: [], hired: true, model: null };
    mockFetch({
      ...routes,
      [API.board]: board([task({ id: "h", status: "review", tenant: "zain-tech", assignee: "zain-tech-vp2" })]),
      [API.roster]: { agents: [...rosterEntries, hiredVp] },
    });
    renderUi(<Hud />);
    expect(await screen.findByRole("button", { name: "Approvals, 1 pending" })).toBeInTheDocument();
  });

  it("asks for /sethome when Telegram approvals are off, and hides it when ready", async () => {
    mockFetch({ ...routes, [API.health]: { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "off", telegramApprovals: "needs-sethome", board: "zain-group" } });
    renderUi(<Hud />);
    expect(await screen.findByText(/Telegram approvals are off: send/)).toHaveTextContent(
      "Telegram approvals are off: send /sethome to your Hermes bot in Telegram.",
    );
  });

  it("shows no Telegram banner when approvals are ready", async () => {
    mockFetch(routes);
    renderUi(<Hud />);
    expect(await screen.findByTitle("Hermes: reachable")).toBeInTheDocument();
    expect(screen.queryByText(/Telegram approvals are off/)).not.toBeInTheDocument();
  });

  it("warns when the Hermes review agent can approve mandates", async () => {
    mockFetch({ ...routes, [API.health]: { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "on", board: "zain-group" } });
    renderUi(<Hud />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Hermes review agent is on: it can approve mandates before HQ sees them.",
    );
  });

  it("shows the breadcrumb on a floor and navigates back to the city", async () => {
    mockFetch(routes);
    useUiStore.getState().enterDivision("studio");
    renderUi(<Hud />);
    expect(screen.getByText("Zain Studio")).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "New mandate" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "mandate", division: "studio" });
    await userEvent.click(screen.getByRole("button", { name: "‹ City" }));
    expect(useUiStore.getState().view).toEqual({ kind: "city" });
  });
});

describe("UiRoot", () => {
  beforeEach(resetStore);

  it("renders the open panel and closes it on Escape", async () => {
    mockFetch(routes);
    renderUi(<UiRoot />);
    await userEvent.click(screen.getByRole("button", { name: /Approvals/ }));
    expect(await screen.findByRole("heading", { name: "Approvals (2)" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "Approvals (2)" })).not.toBeInTheDocument();
  });

  it("traps focus inside dialogs", async () => {
    mockFetch(routes);
    renderUi(<UiRoot />);
    act(() => useUiStore.getState().openPanel({ kind: "mandate" }));
    const dialog = await screen.findByRole("dialog", { name: "New mandate" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 10; i++) await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});
