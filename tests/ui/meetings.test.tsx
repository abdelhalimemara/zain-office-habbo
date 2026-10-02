import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { MEETINGS_API, type BoardMeeting, type MeetingTurn } from "@shared/meetings";
import { MEETING_POLL_ACTIVE_MS, MEETING_POLL_IDLE_MS, meetingsPollInterval } from "../../src/api/meetingHooks";
import { useUiStore } from "../../src/state/store";
import { BoardPanel } from "../../src/ui/BoardPanel";
import { Hud } from "../../src/ui/Hud";
import { DEFAULT_REMARK, MeetingRoom } from "../../src/ui/MeetingRoom";
import { groupTurns, phaseLabel, tallyVotes, waitingFor } from "../../src/ui/meetingModel";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const ALWALEED = "zain-board-alwaleed";
const BEZOS = "zain-board-bezos";
const BUFFETT = "zain-board-buffett";
const JOBS = "zain-board-jobs";
const MEMBERS = [HORMOZI, ALWALEED, BEZOS, BUFFETT, JOBS];
const EVIL = '<img src=x onerror="window.__pwnedMeeting=1"><b>bold</b>';

const turn = (round: number, kind: MeetingTurn["kind"], speaker: string, text: string, at: number): MeetingTurn => ({ round, kind, speaker, text, at });

function meeting(partial: Partial<BoardMeeting> & { id: string }): BoardMeeting {
  return {
    topic: `Topic ${partial.id}`,
    brief: "",
    members: MEMBERS,
    boardOnly: false,
    discussionRounds: 1,
    status: "in-round",
    currentRound: 1,
    turns: [],
    votes: [],
    requestedBy: "hq",
    createdAt: NOW - 3600,
    updatedAt: NOW - 60,
    ...partial,
  };
}

const live = meeting({
  id: "m-live",
  topic: "Raise retainer prices 30%?",
  status: "in-round",
  currentRound: 2,
  discussionRounds: 2,
  turns: [
    turn(2, "discussion", BEZOS, "Customers first: survey the top ten.", NOW - 300),
    turn(1, "opening", HORMOZI, `Raise them. ${EVIL}`, NOW - 900),
    turn(1, "opening", ALWALEED, "Protect the brand.", NOW - 880),
    turn(1, "opening", "founder", "We lose two clients a year on price.", NOW - 600),
    turn(2, "discussion", JOBS, "Fewer, better clients.", NOW - 200),
  ],
});

const awaiting = meeting({ id: "m-wait", topic: "Open a Dubai office?", status: "awaiting-founder", currentRound: 2, discussionRounds: 1, updatedAt: NOW - 30 });

const concluded = meeting({
  id: "m-done",
  topic: "Launch the Labs fund",
  status: "concluded",
  currentRound: 3,
  decision: "approved-with-conditions",
  conclusion: "Proceed with a capped first tranche.",
  notionPageUrl: "https://www.notion.so/minutes-123",
  turns: [
    turn(1, "opening", HORMOZI, "Do it.", NOW - 5000),
    turn(2, "discussion", BUFFETT, "Cap the downside.", NOW - 4000),
    turn(3, "vote", HORMOZI, "VOTE: approve\nUpside is large.", NOW - 3500),
    turn(3, "vote", "default", "Minutes: approved with a SAR 500k cap.", NOW - 3000),
  ],
  votes: [
    { member: HORMOZI, vote: "approve", rationale: "Upside is large." },
    { member: ALWALEED, vote: "approve", rationale: "Brand fit." },
    { member: BEZOS, vote: "approve-with-conditions", rationale: "Measure it.", conditions: "Quarterly review." },
    { member: BUFFETT, vote: "reject", rationale: "Too early." },
    { member: JOBS, vote: "abstain", rationale: "Not my area." },
  ],
  updatedAt: NOW - 3000,
});

function routes(meetings: BoardMeeting[], extra: Record<string, unknown> = {}) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [MEETINGS_API.list]: { meetings },
    ...Object.fromEntries(meetings.map((m) => [MEETINGS_API.one(m.id), { meeting: m }])),
    ...extra,
  });
}

describe("meeting model", () => {
  it("groups the transcript by round in order, founder remarks inside their round, minutes last", () => {
    const groups = groupTurns(live);
    expect(groups.map((g) => g.label)).toEqual(["Opening", "Discussion 1"]);
    expect(groups[0]!.turns.map((t) => t.speaker)).toEqual([HORMOZI, ALWALEED, "founder"]);
    expect(groups[1]!.turns.map((t) => t.speaker)).toEqual([BEZOS, JOBS]);
    expect(groupTurns(concluded).map((g) => g.label)).toEqual(["Opening", "Discussion 1", "Minutes"]);
    const unparsed = { ...concluded, votes: concluded.votes.filter((v) => v.member !== HORMOZI) };
    expect(groupTurns(unparsed).find((g) => g.label === "Vote")!.turns.map((t) => t.speaker)).toEqual([HORMOZI]);
  });

  it("knows who the current step is waiting for", () => {
    expect(waitingFor(live)).toEqual([HORMOZI, ALWALEED, BUFFETT]);
    expect(waitingFor({ ...concluded, status: "voting", votes: concluded.votes.slice(0, 2) })).toEqual([BEZOS, BUFFETT, JOBS]);
    expect(waitingFor({ ...concluded, status: "minutes" })).toEqual(["default"]);
    expect(waitingFor(awaiting)).toEqual([]);
  });

  it("labels the phase", () => {
    expect(phaseLabel(live)).toBe("Discussion 1/2");
    expect(phaseLabel(meeting({ id: "x", currentRound: 1 }))).toBe("Opening");
    expect(phaseLabel(meeting({ id: "x", status: "voting", currentRound: 3 }))).toBe("Vote");
    expect(phaseLabel(concluded)).toBe("Concluded");
  });

  it("tallies votes with shares that add up to 100", () => {
    const t = tallyVotes(concluded.votes);
    expect(t.map((r) => [r.label, r.count, r.percent])).toEqual([
      ["Approve", 2, 40],
      ["Conditions", 1, 20],
      ["Reject", 1, 20],
      ["Abstain", 1, 20],
    ]);
    const thirds = tallyVotes([{ vote: "approve" }, { vote: "reject" }, { vote: "abstain" }]);
    expect(thirds.reduce((s, r) => s + r.percent, 0)).toBe(100);
    expect(tallyVotes([]).every((r) => r.percent === 0)).toBe(true);
  });

  it("polls fast while a meeting is active and slowly otherwise", () => {
    expect(meetingsPollInterval([concluded, live])).toBe(MEETING_POLL_ACTIVE_MS);
    expect(meetingsPollInterval([concluded, { status: "cancelled" }])).toBe(MEETING_POLL_IDLE_MS);
    expect(meetingsPollInterval(undefined)).toBe(MEETING_POLL_IDLE_MS);
  });
});

describe("Meetings tab", () => {
  beforeEach(resetStore);

  it("opens on Meetings and lists meetings newest first with status, phase, faces, decision and Notion link", async () => {
    routes([concluded, live, awaiting]);
    renderUi(<BoardPanel />);
    expect(screen.getByRole("tab", { name: "Meetings" })).toHaveAttribute("aria-selected", "true");
    const list = await screen.findByRole("list", { name: "Board meetings" });
    const items = await within(list).findAllByRole("listitem");
    expect(items.map((i) => i.querySelector(".zui-meeting-item__topic")!.textContent)).toEqual([
      "Open a Dubai office?",
      "Raise retainer prices 30%?",
      "Launch the Labs fund",
    ]);
    expect(within(items[0]!).getByText("Your turn")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Discussion 1/2")).toBeInTheDocument();
    expect(within(items[1]!).getAllByRole("img")).toHaveLength(5);
    expect(within(items[2]!).getByText("Approved with conditions")).toBeInTheDocument();
    expect(within(items[2]!).getByRole("link", { name: "Open the minutes in Notion" })).toHaveAttribute("href", "https://www.notion.so/minutes-123");
    await userEvent.click(within(items[1]!).getByText("Raise retainer prices 30%?"));
    expect(useUiStore.getState().panel).toEqual({ kind: "meeting", id: "m-live" });
  });

  it("opens the call-a-meeting modal from the Meetings tab", async () => {
    routes([]);
    renderUi(<BoardPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Call a meeting" }));
    expect(useUiStore.getState().callMeetingOpen).toBe(true);
  });

  it("badges voice meetings in the list", async () => {
    routes([{ ...live, mode: "voice" }, concluded]);
    renderUi(<BoardPanel />);
    const items = await within(await screen.findByRole("list", { name: "Board meetings" })).findAllByRole("listitem");
    expect(within(items[0]!).getByTitle("Voice meeting")).toHaveTextContent("Voice");
    expect(within(items[1]!).queryByTitle("Voice meeting")).not.toBeInTheDocument();
  });

  it("shows a live voice meeting with a Live chip and Join as the action", async () => {
    routes([{ ...live, mode: "voice", status: "live" }, concluded]);
    renderUi(<BoardPanel />);
    const items = await within(await screen.findByRole("list", { name: "Board meetings" })).findAllByRole("listitem");
    expect(within(items[0]!).getByText("Live")).toHaveClass("zui-meeting-status--live");
    expect(within(items[0]!).getByText("Join")).toBeInTheDocument();
    expect(within(items[0]!).queryByText("Discussion 1/2")).not.toBeInTheDocument();
    expect(within(items[1]!).queryByText("Join")).not.toBeInTheDocument();
    await userEvent.click(within(items[0]!).getByRole("button", { name: "Join Raise retainer prices 30%?" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "meeting", id: "m-live" });
  });
});

describe("Meeting room", () => {
  beforeEach(resetStore);

  it("shows the transcript by round with inert text, founder bubbles and who it is waiting for", async () => {
    routes([live]);
    const { container } = renderUi(<MeetingRoom id="m-live" />);
    const opening = await screen.findByRole("region", { name: "Opening" });
    const bubbles = within(opening).getAllByRole("listitem");
    expect(bubbles.map((b) => b.querySelector(".zui-turn__name")!.textContent)).toEqual(["Alex Hormozi", "HRH Prince Alwaleed bin Talal", "You"]);
    expect(bubbles[2]).toHaveClass("zui-turn--founder");
    expect(within(bubbles[0]!).getByText(`Raise them. ${EVIL}`)).toHaveAttribute("dir", "auto");
    expect(container.querySelector("b, img[src=x]")).toBeNull();
    expect((window as unknown as { __pwnedMeeting?: number }).__pwnedMeeting).toBeUndefined();
    expect(screen.getByRole("region", { name: "Discussion 1" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for Hormozi, Alwaleed, Buffett…")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your remarks" })).not.toBeInTheDocument();
  });

  it("shows the vote tally, per-member votes, minutes and the decision", async () => {
    routes([concluded]);
    renderUi(<MeetingRoom id="m-done" />);
    const votes = await screen.findByRole("region", { name: "Votes" });
    expect(within(votes).getByRole("img", { name: "Approve 2, Conditions 1, Reject 1, Abstain 1" })).toBeInTheDocument();
    const rows = within(within(votes).getByRole("list", { name: "Votes by member" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[2]).toHaveTextContent("Conditions: Quarterly review.");
    expect(screen.getByRole("region", { name: "Minutes" })).toHaveTextContent("Minutes: approved with a SAR 500k cap.");
    expect(within(screen.getByRole("region", { name: "Decision" })).getByText("Approved with conditions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel meeting" })).not.toBeInTheDocument();
    expect(screen.queryByText(/VOTE: approve/)).not.toBeInTheDocument();
  });

  it("flags a failed Notion sync", async () => {
    routes([{ ...concluded, notionSyncError: "Notion API 401" }]);
    renderUi(<MeetingRoom id="m-done" />);
    expect(await screen.findByText("Notion sync failed: Notion API 401")).toBeInTheDocument();
  });

  it.each([
    ["Continue", "continue", "Keep it lean."],
    ["Add another round", "extra-round", ""],
    ["Go to vote", "to-vote", "Enough, vote."],
  ] as const)("%s sends the founder's remarks with next=%s", async (button, next, text) => {
    const fetch = routes([awaiting], { [`POST ${MEETINGS_API.remark("m-wait")}`]: { meeting: awaiting } });
    renderUi(<MeetingRoom id="m-wait" />);
    const composer = await screen.findByRole("region", { name: "Your remarks" });
    if (text) await userEvent.type(within(composer).getByLabelText(/Your remarks to the board/), text);
    await userEvent.click(within(composer).getByRole("button", { name: button }));
    expect(await within(composer).findByText("Sent — the board is back in session.")).toBeInTheDocument();
    expect(fetch.calls("POST", MEETINGS_API.remark("m-wait"))).toEqual([{ body: { text: text || DEFAULT_REMARK[next], next } }]);
  });

  it("can't add a round past the maximum", async () => {
    routes([{ ...awaiting, discussionRounds: 3 }]);
    renderUi(<MeetingRoom id="m-wait" />);
    expect(await screen.findByRole("button", { name: "Add another round" })).toBeDisabled();
  });

  it("shows composer errors", async () => {
    routes([awaiting], { [`POST ${MEETINGS_API.remark("m-wait")}`]: () => new Response(JSON.stringify({ error: "meeting moved on" }), { status: 409 }) });
    renderUi(<MeetingRoom id="m-wait" />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("meeting moved on");
  });

  it("cancels after an inline confirm", async () => {
    const fetch = routes([live], { [`POST ${MEETINGS_API.cancel("m-live")}`]: { meeting: { ...live, status: "cancelled" } } });
    renderUi(<MeetingRoom id="m-live" />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel meeting" }));
    const confirm = screen.getByRole("group", { name: "Confirm cancel" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Keep meeting" }));
    expect(fetch.calls("POST", MEETINGS_API.cancel("m-live"))).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Cancel meeting" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm cancel" })).getByRole("button", { name: "Cancel meeting" }));
    expect(fetch.calls("POST", MEETINGS_API.cancel("m-live"))).toEqual([{ body: {} }]);
  });
});

describe("HUD Board badge", () => {
  beforeEach(resetStore);

  it("counts meetings awaiting the founder", async () => {
    routes([awaiting, { ...awaiting, id: "m-wait2" }, live], { [API.health]: { ok: true, hermes: "reachable", telegram: "connected", board: "zain-group" } });
    renderUi(<Hud />);
    const button = await screen.findByRole("button", { name: "Board, 2 meetings need you" });
    expect(button).toHaveTextContent("Board2");
    await userEvent.click(button);
    expect(useUiStore.getState().panel).toEqual({ kind: "board", tab: "meetings" });
  });

  it("shows no badge when nothing waits for the founder", async () => {
    routes([live, concluded], { [API.health]: { ok: true, hermes: "reachable", telegram: "connected", board: "zain-group" } });
    renderUi(<Hud />);
    expect(await screen.findByRole("button", { name: "Board" })).toHaveTextContent(/^Board$/);
  });
});
