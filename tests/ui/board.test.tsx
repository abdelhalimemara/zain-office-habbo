import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { findBoardMember } from "@shared/board";
import { useUiStore } from "../../src/state/store";
import { AgentCard } from "../../src/ui/AgentCard";
import { BoardPanel } from "../../src/ui/BoardPanel";
import { HireDialog } from "../../src/ui/HireDialog";
import { Hud } from "../../src/ui/Hud";
import { laneOf } from "../../src/ui/lanes";
import { UiRoot } from "../../src/ui/UiRoot";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries, task } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const ALWALEED = "zain-board-alwaleed";
const hormozi = findBoardMember(HORMOZI)!;
const vacantBoard = rosterEntries.map((a) => (a.rank === "board" ? { ...a, hired: false } : a));

const consultations = [
  task({ id: "b1", title: "Board consultation: Raise Labs share?", assignee: HORMOZI, tenant: "zain-hq", status: "done", created_at: NOW - 900, result: "Bottom line: yes, to 20%." }),
  task({ id: "b2", title: "Board consultation: Price Studio retainers?", assignee: HORMOZI, tenant: "zain-hq", status: "running", created_at: NOW - 60 }),
  task({ id: "m1", title: "Rebrand", assignee: "zain-studio-vp", status: "review" }),
];

function routes(agents = rosterEntries, extra: Record<string, unknown> = {}) {
  return mockFetch({
    [API.roster]: { agents },
    [API.board]: board(consultations),
    [API.health]: { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "off", telegramApprovals: "ready", board: "zain-group" },
    ...extra,
  });
}

describe("BoardPanel", () => {
  beforeEach(resetStore);

  it("shows each member with seat, hired state and activity", async () => {
    routes();
    renderUi(<BoardPanel />);
    const members = await screen.findByRole("list", { name: "Board members" });
    const card = within(members).getByRole("button", { name: "Alex Hormozi" }).closest("li")!;
    expect(await within(card).findByText("Hired")).toBeInTheDocument();
    expect(within(card).getByText(hormozi.seat)).toBeInTheDocument();
    expect(within(card).getByText("Working")).toBeInTheDocument();
  });

  it("consults the hired members by default with the question and related task", async () => {
    const fetch = routes(rosterEntries, { [`POST ${API.boardConsult}`]: { tasks: [task({ id: "b9" })], telegramSubscribed: true } });
    renderUi(<BoardPanel />);
    expect(await screen.findByRole("checkbox", { name: /Alex Hormozi/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Alwaleed bin Talal/ })).toBeChecked();
    await userEvent.type(screen.getByLabelText("Question"), "Should we raise prices 30%?");
    await userEvent.type(screen.getByLabelText(/Related task/), "t_2ce68fe1");
    await userEvent.click(screen.getByRole("button", { name: "Consult the board" }));
    expect(await screen.findByText(/Sent to 1 advisor. The CEO will relay the advice on Telegram./)).toBeInTheDocument();
    expect(fetch.calls("POST", API.boardConsult)).toEqual([
      { body: { question: "Should we raise prices 30%?", members: [HORMOZI, ALWALEED], relatedTaskId: "t_2ce68fe1" } },
    ]);
  });

  it("requires a question and at least one advisor", async () => {
    const fetch = routes();
    renderUi(<BoardPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Consult the board" }));
    expect(screen.getByText("Write a question for the board.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Question"), "x");
    await userEvent.click(screen.getByRole("checkbox", { name: /Alex Hormozi/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Alwaleed bin Talal/ }));
    await userEvent.click(screen.getByRole("button", { name: "Consult the board" }));
    expect(screen.getByText("Pick at least one hired advisor.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.boardConsult)).toEqual([]);
  });

  it("explains that nobody can be consulted while every seat is vacant", async () => {
    routes(vacantBoard);
    renderUi(<BoardPanel />);
    expect(await screen.findByText(/No board member is hired yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Consult the board" })).not.toBeInTheDocument();
  });

  it("lists recent consultations newest first with a result preview and opens them", async () => {
    routes();
    renderUi(<BoardPanel />);
    const list = await screen.findByRole("list", { name: "Recent consultations" });
    const items = await within(list).findAllByRole("listitem");
    expect(items.map((i) => within(i).getAllByRole("button")[0]!.textContent)).toEqual(["Price Studio retainers?", "Raise Labs share?"]);
    expect(within(items[1]!).getByText("Bottom line: yes, to 20%.")).toBeInTheDocument();
    expect(within(list).queryByText("Rebrand")).not.toBeInTheDocument();
    await userEvent.click(within(items[1]!).getByRole("button", { name: "Raise Labs share?" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "b1" });
  });

  it("opens from the HUD Board button", async () => {
    routes();
    renderUi(<UiRoot />);
    await userEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "board" });
    expect(await screen.findByRole("heading", { name: "Board of advisors" })).toBeInTheDocument();
  });
});

describe("AgentCard for a board member", () => {
  beforeEach(resetStore);

  it("shows the advisory role, seat, lens and skills grouped by source, and opens a preselected consultation", async () => {
    routes();
    renderUi(<AgentCard profile={HORMOZI} />);
    expect(await screen.findByText("Advises the CEO and founder")).toBeInTheDocument();
    expect(screen.queryByText("Reports to")).not.toBeInTheDocument();
    expect(screen.getByText(hormozi.seat)).toBeInTheDocument();
    expect(screen.getByText(hormozi.lens[0]!)).toBeInTheDocument();
    const group = screen.getByRole("region", { name: "hormozi · alexsmedile/hormozi-skills (MIT) skills" });
    expect(within(group).getAllByRole("listitem")).toHaveLength(17);
    expect(within(group).getByText("pricing-strategy")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Consult" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "board", members: [HORMOZI] });
  });

  it("offers Hire instead of Consult while the seat is vacant", async () => {
    routes(vacantBoard);
    renderUi(<AgentCard profile={HORMOZI} />);
    expect(await screen.findByRole("button", { name: "Hire" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Consult" })).not.toBeInTheDocument();
  });

  it("hires a board seat with reportsTo null from the prefill", async () => {
    const fetch = routes(vacantBoard, {
      [API.headcountCatalog]: { departments: [{ id: "hormozi", skills: ["pricing-strategy"] }] },
      [`POST ${API.hire}`]: { ok: true, profile: HORMOZI, steps: [] },
    });
    renderUi(
      <HireDialog division="hq" prefill={{ profile: HORMOZI, title: "Board · Alex Hormozi", rank: "board", reportsTo: null, skills: hormozi.skills }} />,
    );
    expect(screen.getByText(/advises the CEO and founder; reports to no one/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Reports to")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hire" }));
    await screen.findByRole("heading", { name: "Hired" });
    expect(fetch.calls("POST", API.hire)[0]!.body).toMatchObject({ profile: HORMOZI, rank: "board", reportsTo: null });
  });
});

describe("board tasks in the manager views", () => {
  it("are never in Awaiting HQ", () => {
    const parked = task({ id: "b", assignee: HORMOZI, status: "review", tenant: "zain-hq" });
    expect(laneOf(parked, rosterEntries)).toBe("blocked");
  });

  it("do not count as HQ approvals in the HUD", async () => {
    routes(rosterEntries, { [API.board]: board([task({ id: "b", assignee: HORMOZI, status: "review", tenant: "zain-hq" })]) });
    renderUi(<Hud />);
    expect(await screen.findByRole("button", { name: "Approvals, 0 pending" })).toBeInTheDocument();
  });
});
