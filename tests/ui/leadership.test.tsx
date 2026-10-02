import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { LEADERSHIP_API } from "@shared/leadership";
import { MEETINGS_API, type BoardMeeting } from "@shared/meetings";
import { VOICE_API } from "@shared/voice";
import { useUiStore } from "../../src/state/store";
import { PHONE_QUERY } from "../../src/ui/KanbanPanel";
import { defaultTopic } from "../../src/ui/leadershipModel";
import { MeetingsTab } from "../../src/ui/MeetingsTab";
import { UiRoot } from "../../src/ui/UiRoot";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

const base: BoardMeeting = {
  id: "x",
  topic: "x",
  brief: "",
  members: ["default", "zain-hq-coo"],
  mode: "voice",
  boardOnly: false,
  discussionRounds: 0,
  status: "live",
  currentRound: 1,
  turns: [],
  votes: [],
  requestedBy: "hq",
  createdAt: NOW,
  updatedAt: NOW,
};

const lead = (id: string, status: BoardMeeting["status"], updatedAt: number, extra: Partial<BoardMeeting> = {}): BoardMeeting => ({ ...base, id, kind: "leadership", topic: `VP ${id}`, status, updatedAt, ...extra });
const boardMeeting = (id: string, kind?: "board"): BoardMeeting => ({ ...base, id, ...(kind ? { kind } : {}), topic: `Board ${id}`, members: ["zain-board-hormozi"], mode: "chat", status: "concluded" });

const MEETINGS = [
  boardMeeting("b-legacy"),
  boardMeeting("b-new", "board"),
  lead("l-live", "live", NOW - 10),
  lead("l-draft", "drafting", NOW - 20),
  lead("l-review", "review", NOW - 30, {
    outcome: {
      priorities: "Ship Riyadh",
      actions: [
        { id: "a1", division: "studio", title: "Brand", detail: "", priority: "P1", status: "proposed" },
        { id: "a2", division: "tech", title: "Old", detail: "", priority: "P2", status: "dropped" },
      ],
    },
  }),
  lead("l-done", "assigned", NOW - 40),
];

const started = lead("l-new", "live", NOW);

function routes(meetings: BoardMeeting[] = MEETINGS, agents = rosterEntries) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents },
    [API.health]: { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "off", telegramApprovals: "ready", board: "zain-group" },
    [MEETINGS_API.list]: { meetings },
    [MEETINGS_API.one("l-new")]: { meeting: started },
    [VOICE_API.voices]: { configured: true, voices: [] },
    [`POST ${LEADERSHIP_API.start}`]: { meeting: started },
  });
}

describe("Leadership meetings list", () => {
  beforeEach(resetStore);

  it("shows only leadership meetings, newest first, with their status chips and action counts", async () => {
    routes();
    act(() => useUiStore.setState({ panel: { kind: "leadership" } }));
    renderUi(<UiRoot />);
    const list = await screen.findByRole("list", { name: "VP meetings" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(4));
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".zui-meeting-item__topic")!.textContent)).toEqual(["VP l-live", "VP l-draft", "VP l-review", "VP l-done"]);
    expect(items.map((li) => li.querySelector(".zui-meeting-status")!.textContent)).toEqual(["Live", "Drafting tasks", "Review tasks", "Assigned"]);
    expect(within(items[2]!).getByText("1 action")).toBeInTheDocument();
    expect(screen.queryByText("Board b-legacy")).not.toBeInTheDocument();
  });

  it("opens a meeting in the VP room", async () => {
    routes();
    act(() => useUiStore.setState({ panel: { kind: "leadership" } }));
    renderUi(<UiRoot />);
    await userEvent.click(await screen.findByRole("button", { name: "Join VP l-live" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "leadership", id: "l-live" });
  });

  it("keeps leadership meetings out of the board's list, and treats a missing kind as board", async () => {
    routes();
    renderUi(<MeetingsTab advisors={rosterEntries.filter((a) => a.rank === "board")} agents={rosterEntries} />);
    const list = await screen.findByRole("list", { name: "Board meetings" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(within(list).getByText("Board b-legacy")).toBeInTheDocument();
    expect(within(list).getByText("Board b-new")).toBeInTheDocument();
    expect(within(list).queryByText(/^VP /)).not.toBeInTheDocument();
  });
});

describe("Start a VP meeting", () => {
  beforeEach(resetStore);

  async function openDialog() {
    act(() => useUiStore.setState({ panel: { kind: "leadership" } }));
    renderUi(<UiRoot />);
    await userEvent.click(await screen.findByRole("button", { name: "Start a VP meeting" }));
    return screen.findByRole("dialog", { name: "Call a VP meeting" });
  }

  it("prefills the weekly topic and every hired seat, and disables unhired seats", async () => {
    const agents = rosterEntries.map((a) => (a.profile === "zain-labs-vp" ? { ...a, hired: false } : a));
    routes(MEETINGS, agents);
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText("Topic")).toHaveValue(defaultTopic());
    expect(defaultTopic(new Date(2026, 9, 2))).toBe("Weekly priorities · week of 28 Sep 2026");
    expect(defaultTopic(new Date(2026, 9, 4))).toMatch(/week of 28 Sep/);
    expect(defaultTopic(new Date(2026, 9, 5))).toMatch(/week of 5 Oct/);
    expect(within(dialog).getByText("Add numbered points to go item by item.")).toBeInTheDocument();
    const seat = (name: RegExp) => within(dialog).getByRole("checkbox", { name });
    await waitFor(() => expect(seat(/^VP Labs/)).toBeDisabled());
    for (const name of [/^CEO/, /^COO/, /^VP Studio/, /^VP Growth/, /^VP Tech/]) expect(seat(name)).toBeChecked();
    expect(seat(/^VP Labs/)).not.toBeChecked();
    expect(within(dialog).getByText("Not hired")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Chat meeting|Voice meeting/)).not.toBeInTheDocument();
  });

  it("starts with the chosen seats in seat order and opens the room", async () => {
    const fetch = routes();
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/Agenda or brief/), "1. Riyadh");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^VP Growth/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the meeting" }));
    await waitFor(() => expect(useUiStore.getState().panel).toEqual({ kind: "leadership", id: "l-new" }));
    expect(fetch.calls("POST", LEADERSHIP_API.start)[0]!.body).toEqual({
      topic: defaultTopic(),
      brief: "1. Riyadh",
      members: ["default", "zain-hq-coo", "zain-studio-vp", "zain-labs-vp", "zain-tech-vp"],
    });
    expect(useUiStore.getState().leadershipDialogOpen).toBe(false);
  });

  it("validates the topic and attendees, and closes on Escape", async () => {
    const fetch = routes();
    const dialog = await openDialog();
    await userEvent.clear(within(dialog).getByLabelText("Topic"));
    for (const cb of within(dialog).getAllByRole("checkbox")) await userEvent.click(cb);
    await userEvent.click(within(dialog).getByRole("button", { name: "Start the meeting" }));
    expect(within(dialog).getByText("Give the meeting a topic.")).toBeInTheDocument();
    expect(within(dialog).getByText("Invite at least one hired exec.")).toBeInTheDocument();
    expect(fetch.calls("POST", LEADERSHIP_API.start)).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("VP meeting entry points", () => {
  beforeEach(resetStore);
  afterEach(() => vi.unstubAllGlobals());

  it("has a VP meeting button next to Board in the HUD, badged by meetings waiting for review", async () => {
    routes();
    renderUi(<UiRoot />);
    const button = await screen.findByRole("button", { name: "VP meeting, 1 task list needs your review" });
    await userEvent.click(button);
    expect(useUiStore.getState().panel).toEqual({ kind: "leadership" });
  });

  it("puts VP meeting in the More menu on phones", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === PHONE_QUERY, addEventListener: () => undefined, removeEventListener: () => undefined }));
    routes([]);
    renderUi(<UiRoot />);
    expect(screen.queryByRole("button", { name: "VP meeting" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: "VP meeting" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "leadership" });
  });

  it("shows Call a VP meeting on the HQ floor only, and it opens the Leadership panel", async () => {
    routes([]);
    renderUi(<UiRoot />);
    expect(screen.queryByRole("button", { name: "Call a VP meeting" })).not.toBeInTheDocument();
    act(() => useUiStore.setState({ view: { kind: "floor", division: "growth" } }));
    expect(screen.queryByRole("button", { name: "Call a VP meeting" })).not.toBeInTheDocument();
    act(() => useUiStore.setState({ view: { kind: "floor", division: "hq" } }));
    await userEvent.click(await screen.findByRole("button", { name: "Call a VP meeting" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "leadership" });
    expect(await screen.findByRole("heading", { name: "Leadership" })).toBeInTheDocument();
  });
});
