import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { MEETINGS_API, type BoardMeeting } from "@shared/meetings";
import { LIVE_API, type EndLiveRequest, type LiveSessionResponse } from "@shared/voice";
import { useUiStore } from "../../src/state/store";
import { UiRoot } from "../../src/ui/UiRoot";
import { board, memoryStorage, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

const sdk = vi.hoisted(() => ({ options: [] as Record<string, (arg: unknown) => void>[], startSession: vi.fn() }));
vi.mock("@elevenlabs/client", () => ({ Conversation: { startSession: sdk.startSession } }));

const live: BoardMeeting = {
  id: "l-live",
  kind: "leadership",
  topic: "Weekly priorities · week of 28 Sep 2026",
  brief: "",
  members: ["default", "zain-hq-coo", "zain-studio-vp", "zain-tech-vp"],
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
  liveConversationIds: [],
};
const drafting: BoardMeeting = { ...live, status: "drafting", liveConversationIds: ["conv-1"], turns: [{ round: 1, kind: "discussion", speaker: "zain-hq-coo", text: "Delivery is green.", at: NOW }] };

const SESSION: LiveSessionResponse = {
  signedUrl: "wss://example/convai?token=x",
  overrides: { agent: { prompt: { prompt: "p" }, firstMessage: "", language: "en" } },
  speakers: [
    { tag: "CEO", profile: "default", name: "CEO" },
    { tag: "COO", profile: "zain-hq-coo", name: "COO" },
    { tag: "Studio", profile: "zain-studio-vp", name: "VP Studio" },
    { tag: "Tech", profile: "zain-tech-vp", name: "VP Tech" },
  ],
};

const seatNames = () => within(screen.getByRole("list", { name: "Seats" })).getAllByRole("listitem").map((li) => li.querySelector(".zui-seat__name")!.textContent);

function routes() {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [MEETINGS_API.list]: { meetings: [live] },
    [MEETINGS_API.one(live.id)]: { meeting: live },
    [`POST ${LIVE_API.session(live.id)}`]: SESSION,
    [`POST ${LIVE_API.end(live.id)}`]: (init: RequestInit | undefined) => ({ meeting: (JSON.parse(String(init?.body)) as EndLiveRequest).final === false ? live : drafting }),
  });
}

describe("Leadership live room", () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal("sessionStorage", memoryStorage());
    sdk.options.length = 0;
    sdk.startSession.mockReset();
    sdk.startSession.mockImplementation(async (options: Record<string, (arg: unknown) => void>) => {
      sdk.options.push(options);
      options.onStatusChange!({ status: "connected" });
      options.onConnect!({ conversationId: "conv-1" });
      return { endSession: vi.fn(async () => undefined), setMicMuted: vi.fn(), getId: () => "conv-1", getInputVolume: () => 0.2 };
    });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => undefined }] })) } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("labels the seats CEO, COO and VPs, before and after joining, and never mentions a vote", async () => {
    routes();
    act(() => useUiStore.setState({ panel: { kind: "leadership", id: live.id } }));
    renderUi(<UiRoot />);
    await screen.findByRole("button", { name: "Join the room" });
    expect(seatNames()).toEqual(["CEO", "COO", "VP Studio", "VP Tech", "You"]);
    expect(screen.getByText(/so your execs wait for you to open/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Join the room" }));
    await screen.findByText(/^Live · /);
    expect(seatNames()).toEqual(["CEO", "COO", "VP Studio", "VP Tech", "You"]);
    expect(screen.getByText("Your execs are waiting for you to open.")).toBeInTheDocument();
    act(() => sdk.options[0]!.onMessage!({ role: "agent", event_id: 1, message: "<COO>Delivery is green.</COO>" }));
    const captions = screen.getByRole("list", { name: "Live captions" });
    expect(within(captions).getByText("COO")).toBeInTheDocument();
    expect(screen.queryByText(/vote/i)).not.toBeInTheDocument();
  });

  it("ends with a confirm, posts final:true, and moves to drafting", async () => {
    const fetch = routes();
    act(() => useUiStore.setState({ panel: { kind: "leadership", id: live.id } }));
    renderUi(<UiRoot />);
    await userEvent.click(await screen.findByRole("button", { name: "Join the room" }));
    await screen.findByText(/^Live · /);
    await userEvent.click(screen.getByRole("button", { name: "End meeting & draft tasks" }));
    const confirm = screen.getByRole("group", { name: "Confirm end meeting" });
    expect(confirm).toHaveTextContent("End the meeting? The CEO agent turns it into tasks for you to review.");
    await userEvent.click(within(confirm).getByRole("button", { name: "End & draft tasks" }));
    await waitFor(() => expect(fetch.calls("POST", LIVE_API.end(live.id)).map((c) => c.body)).toContainEqual({ conversationId: "conv-1", final: true }));
    expect(await screen.findByText("The CEO agent is turning the meeting into tasks…")).toBeInTheDocument();
  });
});
