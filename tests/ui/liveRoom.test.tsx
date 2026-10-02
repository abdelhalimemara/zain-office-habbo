import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { MEETINGS_API, type BoardMeeting } from "@shared/meetings";
import { LIVE_API, type LiveSessionResponse } from "@shared/voice";
import { MeetingRoom } from "../../src/ui/MeetingRoom";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

/** What the room passes to Conversation.startSession, and the fake conversation it gets back. */
interface FakeSession {
  options: Record<string, (...args: never[]) => void> & { signedUrl: string; overrides: unknown; connectionType: string };
  endSession: ReturnType<typeof vi.fn>;
  setMicMuted: ReturnType<typeof vi.fn>;
}

const sdk = vi.hoisted(() => ({ sessions: [] as unknown[], startSession: vi.fn() }));
vi.mock("@elevenlabs/client", () => ({ Conversation: { startSession: sdk.startSession } }));

const HORMOZI = "zain-board-hormozi";
const BUFFETT = "zain-board-buffett";

const liveMeeting: BoardMeeting = {
  id: "m-live",
  topic: "Open a Riyadh studio?",
  brief: "1. Budget\n2. Hiring",
  members: [HORMOZI, BUFFETT],
  mode: "voice",
  boardOnly: false,
  discussionRounds: 1,
  status: "live",
  currentRound: 1,
  turns: [],
  votes: [],
  requestedBy: "hq",
  createdAt: NOW - 100,
  updatedAt: NOW - 100,
};

const voting: BoardMeeting = {
  ...liveMeeting,
  status: "voting",
  liveConversationIds: ["conv-1"],
  turns: [
    { round: 1, kind: "discussion", speaker: HORMOZI, text: "Raise it.", at: NOW },
    { round: 1, kind: "discussion", speaker: "founder", text: "Agreed.", at: NOW + 1 },
  ],
};

const SESSION: LiveSessionResponse = {
  signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?token=abc",
  overrides: { agent: { prompt: { prompt: "You are the board." }, firstMessage: "<Chair>The floor is open.</Chair>", language: "en" } },
  speakers: [
    { tag: "Hormozi", profile: HORMOZI, name: "Alex Hormozi" },
    { tag: "Buffett", profile: BUFFETT, name: "Warren Buffett" },
    { tag: "Chair", profile: "default", name: "The chair" },
  ],
};

let getUserMedia: ReturnType<typeof vi.fn>;
let stopTrack: ReturnType<typeof vi.fn>;

function routes(extra: Record<string, unknown> = {}) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [MEETINGS_API.one(liveMeeting.id)]: { meeting: liveMeeting },
    [`POST ${LIVE_API.session(liveMeeting.id)}`]: SESSION,
    [`POST ${LIVE_API.end(liveMeeting.id)}`]: { meeting: voting },
    ...extra,
  });
}

const session = (i = -1) => sdk.sessions.at(i) as FakeSession;
const fire = (name: string, arg?: unknown) => act(() => (session().options[name] as (a: unknown) => void)(arg));
const room = () => screen.getByRole("region", { name: "Live room" });
const seat = (name: string) => within(screen.getByRole("list", { name: "Seats" })).getByText(name).closest("li")!;

async function join() {
  await userEvent.click(await screen.findByRole("button", { name: "Join the room" }));
  await within(room()).findByText(/^Live · /);
}

describe("Live board room", () => {
  beforeEach(() => {
    resetStore();
    sdk.sessions.length = 0;
    sdk.startSession.mockReset();
    sdk.startSession.mockImplementation(async (options: FakeSession["options"]) => {
      const n = sdk.sessions.length + 1;
      const fake: FakeSession = {
        options,
        endSession: vi.fn(async () => undefined),
        setMicMuted: vi.fn(),
      };
      sdk.sessions.push(fake);
      options.onStatusChange!({ status: "connected" } as never);
      options.onConnect!({ conversationId: `conv-${n}` } as never);
      return { ...fake, getId: () => `conv-${n}`, getInputVolume: () => 0.42 };
    });
    stopTrack = vi.fn();
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the live view with a Join button instead of the written transcript", async () => {
    routes();
    renderUi(<MeetingRoom id="m-live" />);
    expect(await screen.findByRole("button", { name: "Join the room" })).toBeEnabled();
    expect(within(room()).getByText("Not in the room")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Seats" })).getAllByRole("listitem").map((li) => li.querySelector(".zui-seat__name")!.textContent)).toEqual(["Alex Hormozi", "Warren Buffett", "You"]);
    expect(screen.queryByLabelText("Your remarks")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /End meeting/ })).not.toBeInTheDocument();
    expect(sdk.startSession).not.toHaveBeenCalled();
  });

  it("joins: asks for the mic, opens a session and starts the conversation with its signed URL and overrides, mic on", async () => {
    const fetch = routes();
    renderUi(<MeetingRoom id="m-live" />);
    await join();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalled();
    expect(fetch.calls("POST", LIVE_API.session("m-live"))).toHaveLength(1);
    expect(session().options).toMatchObject({ signedUrl: SESSION.signedUrl, overrides: SESSION.overrides, connectionType: "websocket" });
    expect(session().setMicMuted).toHaveBeenCalledWith(false);
    expect(within(room()).getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(within(room()).getByRole("meter", { name: "Mic level" })).toHaveAttribute("aria-valuenow", "42"));
    expect(within(screen.getByRole("list", { name: "Seats" })).getAllByRole("listitem").map((li) => li.querySelector(".zui-seat__name")!.textContent)).toEqual([
      "Alex Hormozi",
      "Warren Buffett",
      "The chair",
      "You",
    ]);
  });

  it("captions each speaker in their own bubble and lights whoever is talking", async () => {
    routes();
    renderUi(<MeetingRoom id="m-live" />);
    await join();
    fire("onMessage", { role: "agent", source: "ai", event_id: 1, message: "<Chair>The floor is open.</Chair>" });
    fire("onMessage", { role: "agent", source: "ai", event_id: 2, message: "<Hormozi>Raise prices.</Hormozi><Buffett>Mind the moat.</Buffett>" });
    fire("onMessage", { role: "user", source: "user", event_id: 3, message: "What about hiring?" });
    const captions = screen.getByRole("list", { name: "Live captions" });
    const bubbles = within(captions).getAllByRole("listitem").filter((li) => li.querySelector(".zui-turn__name"));
    expect(bubbles.map((b) => [b.querySelector(".zui-turn__name")!.textContent, b.querySelector(".zui-turn__text")!.textContent])).toEqual([
      ["The chair", "The floor is open."],
      ["Alex Hormozi", "Raise prices."],
      ["Warren Buffett", "Mind the moat."],
      ["You", "What about hiring?"],
    ]);
    expect(bubbles[3]).toHaveClass("zui-turn--founder");

    fire("onMessage", { role: "agent", source: "ai", event_id: 4, message: "<Buffett>Hire slowly.</Buffett>" });
    fire("onModeChange", { mode: "speaking" });
    await waitFor(() => expect(seat("Warren Buffett")).toHaveAttribute("aria-current", "true"));
    expect(seat("Warren Buffett")).toHaveClass("zui-seat--speaking");
    expect(seat("Alex Hormozi")).not.toHaveAttribute("aria-current");
    expect(within(room()).getByText("The board is speaking. Jump in any time.")).toBeInTheDocument();

    fire("onVadScore", { vadScore: 0.9 });
    await waitFor(() => expect(seat("You")).toHaveAttribute("aria-current", "true"));
    expect(seat("Warren Buffett")).not.toHaveAttribute("aria-current");
    fire("onVadScore", { vadScore: 0.05 });
    fire("onModeChange", { mode: "listening" });
    await waitFor(() => expect(screen.getByRole("list", { name: "Seats" }).querySelector("[aria-current]")).toBeNull());
  });

  it("mutes and unmutes the mic", async () => {
    routes();
    renderUi(<MeetingRoom id="m-live" />);
    await join();
    await userEvent.click(within(room()).getByRole("button", { name: "Mute" }));
    expect(session().setMicMuted).toHaveBeenLastCalledWith(true);
    expect(within(room()).getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
    expect(within(seat("You")).getByText("Muted")).toBeInTheDocument();
    await waitFor(() => expect(within(room()).getByRole("meter")).toHaveAttribute("aria-valuenow", "0"));
    fire("onVadScore", { vadScore: 0.9 });
    expect(seat("You")).not.toHaveAttribute("aria-current");
    await userEvent.click(within(room()).getByRole("button", { name: "Unmute" }));
    expect(session().setMicMuted).toHaveBeenLastCalledWith(false);
  });

  it("ends after a confirm: closes the call, posts the conversation id, hands over, then shows the board's vote", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = routes({
      [`POST ${LIVE_API.end("m-live")}`]: async () => {
        await gate;
        return { meeting: voting };
      },
    });
    renderUi(<MeetingRoom id="m-live" />);
    await join();
    await userEvent.click(within(room()).getByRole("button", { name: "End meeting & vote" }));
    const confirm = within(room()).getByRole("group", { name: "Confirm end meeting" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Keep talking" }));
    expect(session().endSession).not.toHaveBeenCalled();
    await userEvent.click(within(room()).getByRole("button", { name: "End meeting & vote" }));
    await userEvent.click(within(room()).getByRole("button", { name: "End & vote" }));
    expect(await within(room()).findAllByText("Handing over to the board for the vote…")).not.toHaveLength(0);
    expect(session().endSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetch.calls("POST", LIVE_API.end("m-live"))).toEqual([{ body: { conversationId: "conv-1" } }]));
    release();
    expect(await screen.findByText("Raise it.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Live room" })).not.toBeInTheDocument();
    expect(screen.getByText("Voting")).toBeInTheDocument();
  });

  it("explains a blocked mic and retries", async () => {
    routes();
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    renderUi(<MeetingRoom id="m-live" />);
    await userEvent.click(await screen.findByRole("button", { name: "Join the room" }));
    const alert = await within(room()).findByRole("alert");
    expect(alert).toHaveTextContent("Microphone access is blocked");
    expect(sdk.startSession).not.toHaveBeenCalled();
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await within(room()).findByText(/^Live · /);
    expect(within(room()).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says when ElevenLabs isn't configured (503)", async () => {
    routes({ [`POST ${LIVE_API.session("m-live")}`]: () => new Response(JSON.stringify({ error: "ElevenLabs is not configured" }), { status: 503 }) });
    renderUi(<MeetingRoom id="m-live" />);
    await userEvent.click(await screen.findByRole("button", { name: "Join the room" }));
    const alert = await within(room()).findByRole("alert");
    expect(alert).toHaveTextContent("ElevenLabs isn't connected. Add ELEVENLABS_API_KEY");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(sdk.startSession).not.toHaveBeenCalled();
  });

  it("reports a session that fails to start", async () => {
    routes();
    sdk.startSession.mockRejectedValueOnce(new Error("socket refused"));
    renderUi(<MeetingRoom id="m-live" />);
    await userEvent.click(await screen.findByRole("button", { name: "Join the room" }));
    expect(await within(room()).findByRole("alert")).toHaveTextContent("Couldn't connect to the room: socket refused");
    expect(within(room()).getByText("Not in the room")).toBeInTheDocument();
  });

  it("offers Rejoin after a dropped connection; rejoining opens a new session and End hands over the latest", async () => {
    const fetch = routes();
    renderUi(<MeetingRoom id="m-live" />);
    await join();
    fire("onMessage", { role: "agent", source: "ai", event_id: 1, message: "<Hormozi>Before the drop.</Hormozi>" });
    fire("onDisconnect", { reason: "error", message: "socket closed", context: { type: "close" } });
    const alert = await within(room()).findByRole("alert");
    expect(alert).toHaveTextContent("The connection dropped: socket closed");
    expect(within(room()).getByText("Disconnected")).toBeInTheDocument();
    expect(within(room()).getByText("Before the drop.")).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Rejoin" }));
    await within(room()).findByText(/^Live · /);
    expect(sdk.startSession).toHaveBeenCalledTimes(2);
    expect(fetch.calls("POST", LIVE_API.session("m-live"))).toHaveLength(2);
    // The old session's late callbacks are ignored.
    act(() => (session(0).options.onMessage as (m: unknown) => void)({ role: "agent", event_id: 9, message: "<Hormozi>Ghost</Hormozi>" }));
    expect(within(room()).queryByText("Ghost")).not.toBeInTheDocument();
    await userEvent.click(within(room()).getByRole("button", { name: "End meeting & vote" }));
    await userEvent.click(within(room()).getByRole("button", { name: "End & vote" }));
    await waitFor(() => expect(fetch.calls("POST", LIVE_API.end("m-live"))).toEqual([{ body: { conversationId: "conv-2" } }]));
  });

  it("leaving, or closing the panel, ends the session cleanly", async () => {
    routes();
    const { unmount } = renderUi(<MeetingRoom id="m-live" />);
    await join();
    await userEvent.click(within(room()).getByRole("button", { name: "Leave" }));
    expect(session().endSession).toHaveBeenCalledTimes(1);
    expect(within(room()).getByText("Not in the room")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Join the room" }));
    await within(room()).findByText(/^Live · /);
    unmount();
    expect(session().endSession).toHaveBeenCalledTimes(1);
    expect(session(0).endSession).toHaveBeenCalledTimes(1);
  });

  it("can hand over a past session after a reload without rejoining, and retries a failed hand-over", async () => {
    let fail = true;
    const fetch = routes({
      [MEETINGS_API.one("m-live")]: { meeting: { ...liveMeeting, liveConversationIds: ["conv-old"] } },
      [`POST ${LIVE_API.end("m-live")}`]: () => (fail ? new Response(JSON.stringify({ error: "transcript not ready" }), { status: 502 }) : { meeting: voting }),
    });
    renderUi(<MeetingRoom id="m-live" />);
    await userEvent.click(await screen.findByRole("button", { name: "End meeting & vote" }));
    await userEvent.click(screen.getByRole("button", { name: "End & vote" }));
    const alert = await within(room()).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't hand the meeting to the board: transcript not ready");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Raise it.")).toBeInTheDocument();
    expect(fetch.calls("POST", LIVE_API.end("m-live"))).toEqual([{ body: { conversationId: "conv-old" } }, { body: { conversationId: "conv-old" } }]);
    expect(sdk.startSession).not.toHaveBeenCalled();
  });
});
