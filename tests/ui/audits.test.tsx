import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { AUDITS_API, type ProspectAudit } from "@shared/audits";
import { useUiStore } from "../../src/state/store";
import { UiRoot } from "../../src/ui/UiRoot";
import { T0, doneAudit, failedAudit, gradedAudits, runningAudit } from "./auditFixtures";
import { board, mockFetch, renderUi, resetStore, rosterEntries } from "./helpers";

function routes(audits: ProspectAudit[] = [runningAudit, doneAudit, failedAudit]) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [API.health]: { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "off", telegramApprovals: "ready", board: "zain-group" },
    [AUDITS_API.list]: { audits },
    [AUDITS_API.one(doneAudit.id)]: { audit: doneAudit },
  });
}

function openList() {
  act(() => useUiStore.setState({ panel: { kind: "audits" } }));
  renderUi(<UiRoot />);
}

describe("Prospect audits list", () => {
  beforeEach(resetStore);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists audits newest first with domain, status, grade, date and cost", async () => {
    vi.spyOn(Date, "now").mockReturnValue((T0 + 120) * 1000);
    routes();
    openList();
    const list = await screen.findByRole("list", { name: "Prospect audits" });
    const items = within(list).getAllByRole("listitem").filter((li) => li.classList.contains("zui-audit-item"));
    expect(items.map((li) => li.querySelector(".zui-audit-item__name")!.textContent)).toEqual(["Kahwa House", "Desert Bloom", "Nakheel Dental"]);
    expect(items.map((li) => li.querySelector(".zui-audit-item__domain")!.textContent)).toEqual(["kahwahouse.sa", "desertbloom.ae", "nakheeldental.com"]);
    expect(items.map((li) => li.querySelector(".zui-audit-status")!.textContent)).toEqual(["Running", "Failed", "Done"]);
    const done = items[2]!;
    expect(within(done).getByRole("img", { name: "Grade C, average, score 64 of 100" })).toHaveTextContent("C");
    expect(within(done).getByText("$1.03")).toBeInTheDocument();
    expect(within(done).getByText("1d ago")).toBeInTheDocument();
    expect(within(items[0]!).getByText("$0.60")).toBeInTheDocument();
    expect(within(items[1]!).queryByRole("img", { name: /Grade/ })).not.toBeInTheDocument();
  });

  it("colours each grade A to E", async () => {
    routes([doneAudit, ...gradedAudits]);
    openList();
    await screen.findByRole("list", { name: "Prospect audits" });
    for (const g of ["A", "B", "C", "D", "E"]) {
      const badge = screen.getAllByRole("img", { name: new RegExp(`^Grade ${g},`) })[0]!;
      expect(badge).toHaveClass(`zui-grade--${g}`);
    }
  });

  it("shows nine step dots with tooltips only while an audit is running", async () => {
    routes();
    openList();
    const progress = await screen.findByRole("list", { name: "Progress: 2 of 9 steps" });
    const dots = within(progress).getAllByRole("listitem");
    expect(dots).toHaveLength(9);
    expect(dots.map((d) => d.className.replace("zui-step-dot zui-step-dot--", ""))).toEqual([
      "done",
      "done",
      "running",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(dots[0]).toHaveAttribute("title", "Website crawl: Done. 38 pages crawled, 6 missing meta descriptions");
    expect(dots[0]).toHaveTextContent("Website crawl: Done.");
    expect(screen.getAllByRole("list", { name: /^Progress/ })).toHaveLength(1);
  });

  it("polls fast while an audit runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetch = routes();
      openList();
      await screen.findByRole("list", { name: "Prospect audits" });
      act(() => focusManager.setFocused(true));
      const before = fetch.calls("GET", AUDITS_API.list).length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_100);
      });
      expect(fetch.calls("GET", AUDITS_API.list).length).toBeGreaterThan(before);
    } finally {
      focusManager.setFocused(false);
      vi.useRealTimers();
    }
  });

  it("shows an empty state and opens the new-audit form", async () => {
    routes([]);
    openList();
    expect(await screen.findByText("No prospect audits yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New audit" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "audits", compose: true });
    expect(await screen.findByRole("heading", { name: "New prospect audit" })).toBeInTheDocument();
  });

  it("opens an audit from the list", async () => {
    routes();
    openList();
    await userEvent.click(await screen.findByRole("button", { name: /^Nakheel Dental/ }));
    expect(useUiStore.getState().panel).toEqual({ kind: "audits", id: doneAudit.id });
    expect(await screen.findByRole("heading", { name: "Nakheel Dental" })).toBeInTheDocument();
  });
});

describe("Prospect audits entry points", () => {
  beforeEach(resetStore);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("puts a Prospect audits CTA on the Growth floor only, with the running count", async () => {
    routes();
    act(() => useUiStore.getState().enterDivision("growth"));
    renderUi(<UiRoot />);
    const cta = await screen.findByRole("button", { name: /^Prospect audits/ });
    await waitFor(() => expect(cta).toHaveTextContent("1 running"));
    await userEvent.click(cta);
    expect(useUiStore.getState().panel).toEqual({ kind: "audits" });
  });

  it("has no audits CTA on other floors", async () => {
    const fetch = routes();
    act(() => useUiStore.getState().enterDivision("studio"));
    renderUi(<UiRoot />);
    await waitFor(() => expect(fetch.calls("GET", API.roster).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /^Prospect audits/ })).not.toBeInTheDocument();
  });

  it("adds a Prospect audits button to the Growth kanban only", async () => {
    routes();
    act(() => useUiStore.setState({ panel: { kind: "kanban", division: "growth" } }));
    const { unmount } = renderUi(<UiRoot />);
    await userEvent.click(await screen.findByRole("button", { name: "Prospect audits" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "audits" });
    unmount();

    act(() => useUiStore.setState({ panel: { kind: "kanban", division: "studio" } }));
    renderUi(<UiRoot />);
    await screen.findByRole("heading", { name: "Zain Studio · Kanban" });
    expect(screen.queryByRole("button", { name: "Prospect audits" })).not.toBeInTheDocument();
  });

  it("links Ahmad's agent card to the audits", async () => {
    routes();
    act(() => useUiStore.getState().selectAgent("zain-hq-accounts"));
    renderUi(<UiRoot />);
    await userEvent.click(await screen.findByRole("button", { name: "Audits" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "audits" });
  });
});
