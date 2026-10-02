import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { MEETINGS_API, type BoardMeeting, type MeetingTurn } from "@shared/meetings";
import { VOICE_API, type VoicesResponse } from "@shared/voice";
import { MeetingRoom } from "../../src/ui/MeetingRoom";
import { PLAYED_KEY_PREFIX } from "../../src/ui/voiceModel";
import { board, memoryStorage, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const ALWALEED = "zain-board-alwaleed";
const BEZOS = "zain-board-bezos";

const turn = (round: number, kind: MeetingTurn["kind"], speaker: string, text: string, at: number): MeetingTurn => ({ round, kind, speaker, text, at });

const voiceMeeting: BoardMeeting = {
  id: "m-voice",
  topic: "Open a Riyadh studio?",
  brief: "",
  members: [HORMOZI, ALWALEED, BEZOS],
  mode: "voice",
  boardOnly: false,
  discussionRounds: 1,
  status: "in-round",
  currentRound: 2,
  turns: [
    turn(1, "opening", HORMOZI, "Do it.", NOW - 900),
    turn(1, "opening", "founder", "Budget is tight.", NOW - 800),
    turn(1, "opening", ALWALEED, "Location matters.", NOW - 700),
    turn(2, "discussion", BEZOS, "Ask the customers.", NOW - 600),
  ],
  votes: [],
  requestedBy: "hq",
  createdAt: NOW - 1000,
  updatedAt: NOW - 600,
};

const CONFIGURED: VoicesResponse = { configured: true, voices: [] };

/** The one <audio> the queue plays through, with play/pause stubbed (jsdom has no media). */
let audio: HTMLMediaElement | null;
let playImpl: () => Promise<void>;

function audioOk() {
  return new Response(new Blob(["mp3"], { type: "audio/mpeg" }), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
}

function routes(meeting: BoardMeeting, voices: VoicesResponse = CONFIGURED, audioRoutes: Record<string, unknown> = {}) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [MEETINGS_API.one(meeting.id)]: { meeting },
    [VOICE_API.voices]: voices,
    ...Object.fromEntries([0, 2, 3].map((i) => [VOICE_API.turnAudio(meeting.id, i), () => audioOk()])),
    ...audioRoutes,
  });
}

const audioFetches = (fetch: ReturnType<typeof routes>) =>
  fetch.fn.mock.calls.map(([u]) => String(u)).filter((u) => u.endsWith("/audio")).map((u) => Number(u.split("/turns/")[1]!.split("/")[0]));

const bubble = (name: string) => screen.getByText(name, { selector: ".zui-turn__name" }).closest("li")!;

async function ended() {
  await act(async () => {
    audio!.onended?.(new Event("ended"));
  });
}

describe("Voice meeting room", () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal("localStorage", memoryStorage());
    audio = null;
    playImpl = () => Promise.resolve();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      audio = this;
      return playImpl();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => "blob:turn");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays each non-founder turn in order from the first unheard one, highlighting the speaker", async () => {
    localStorage.setItem(`${PLAYED_KEY_PREFIX}m-voice`, "[0]");
    const fetch = routes(voiceMeeting);
    renderUi(<MeetingRoom id="m-voice" />);
    const player = await screen.findByRole("region", { name: "Voice playback" });
    expect(await within(player).findByText("HRH Prince Alwaleed bin Talal is speaking")).toBeInTheDocument();
    expect(within(player).getByText("1 more to hear")).toBeInTheDocument();
    expect(bubble("HRH Prince Alwaleed bin Talal")).toHaveClass("zui-turn--speaking");
    expect(bubble("Alex Hormozi")).not.toHaveClass("zui-turn--speaking");
    expect(within(bubble("You")).queryByRole("button", { name: /Play/ })).not.toBeInTheDocument();
    await ended();
    expect(await within(player).findByText("Jeff Bezos is speaking")).toBeInTheDocument();
    expect(localStorage.getItem(`${PLAYED_KEY_PREFIX}m-voice`)).toBe("[0,2]");
    await ended();
    expect(await within(player).findByText("You're up to date.")).toBeInTheDocument();
    expect(audioFetches(fetch)).toEqual([2, 3]);
    expect(localStorage.getItem(`${PLAYED_KEY_PREFIX}m-voice`)).toBe("[0,2,3]");
  });

  it("pauses, resumes, skips, mutes and replays a turn", async () => {
    const fetch = routes(voiceMeeting);
    renderUi(<MeetingRoom id="m-voice" />);
    const player = await screen.findByRole("region", { name: "Voice playback" });
    await within(player).findByText("Alex Hormozi is speaking");
    await userEvent.click(within(player).getByRole("button", { name: "Pause" }));
    expect(within(player).getByText("Paused · Alex Hormozi")).toBeInTheDocument();
    await userEvent.click(within(player).getByRole("button", { name: "Play" }));
    expect(await within(player).findByText("Alex Hormozi is speaking")).toBeInTheDocument();
    await userEvent.click(within(player).getByRole("button", { name: "Skip" }));
    expect(await within(player).findByText("HRH Prince Alwaleed bin Talal is speaking")).toBeInTheDocument();
    const mute = within(player).getByRole("button", { name: "Mute" });
    await userEvent.click(mute);
    expect(within(player).getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
    expect(audio!.muted).toBe(true);
    expect(localStorage.getItem("zui.voice.muted")).toBe("1");
    await userEvent.click(within(bubble("Alex Hormozi")).getByRole("button", { name: "Play Alex Hormozi's turn" }));
    expect(await within(player).findByText(/Alex Hormozi/)).toBeInTheDocument();
    expect(audioFetches(fetch)).toEqual([0, 2, 0]);
    await ended();
    await waitFor(() => expect(audioFetches(fetch)).toEqual([0, 2, 0, 2]));
  });

  it("asks for a click when the browser blocks autoplay", async () => {
    playImpl = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
    routes(voiceMeeting);
    renderUi(<MeetingRoom id="m-voice" />);
    const start = await screen.findByRole("button", { name: "Start listening" });
    expect(screen.getByText("Your browser is waiting for a click to play the board.")).toBeInTheDocument();
    playImpl = () => Promise.resolve();
    await userEvent.click(start);
    expect(await screen.findByText("Alex Hormozi is speaking")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start listening" })).not.toBeInTheDocument();
  });

  it("falls back to text for a turn whose audio fails and moves on", async () => {
    const fetch = routes(voiceMeeting, CONFIGURED, {
      [VOICE_API.turnAudio("m-voice", 0)]: () => new Response(JSON.stringify({ error: "ElevenLabs down" }), { status: 503 }),
      [VOICE_API.turnAudio("m-voice", 2)]: () => new Response(JSON.stringify({ error: "no audio" }), { status: 404 }),
    });
    renderUi(<MeetingRoom id="m-voice" />);
    expect(await screen.findByText("Jeff Bezos is speaking")).toBeInTheDocument();
    expect(within(bubble("Alex Hormozi")).getByText("Voice unavailable · text only")).toBeInTheDocument();
    expect(within(bubble("HRH Prince Alwaleed bin Talal")).getByText("No audio for this turn · text only")).toBeInTheDocument();
    expect(within(bubble("Alex Hormozi")).getByText("Do it.")).toBeInTheDocument();
    expect(audioFetches(fetch)).toEqual([0, 2, 3]);
    expect(localStorage.getItem(`${PLAYED_KEY_PREFIX}m-voice`)).toBeNull();
  });

  it("reads as text with a notice when ElevenLabs isn't connected", async () => {
    const fetch = routes(voiceMeeting, { configured: false, voices: [] });
    renderUi(<MeetingRoom id="m-voice" />);
    expect(await screen.findByText(/ElevenLabs isn't connected/)).toBeInTheDocument();
    expect(screen.getByText("Voice", { selector: ".zui-voice-badge span" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Voice playback" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play .*'s turn/ })).not.toBeInTheDocument();
    expect(audioFetches(fetch)).toEqual([]);
  });

  it("leaves chat meetings silent", async () => {
    const fetch = routes({ ...voiceMeeting, mode: "chat" });
    renderUi(<MeetingRoom id="m-voice" />);
    await screen.findByText("Do it.");
    expect(screen.queryByRole("region", { name: "Voice playback" })).not.toBeInTheDocument();
    expect(fetch.calls("GET", VOICE_API.voices)).toHaveLength(0);
    expect(audioFetches(fetch)).toEqual([]);
  });
});
