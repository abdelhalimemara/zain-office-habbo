import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { MEETINGS_API, type BoardMeeting } from "@shared/meetings";
import { VOICE_API } from "@shared/voice";
import { MeetingRoom } from "../../src/ui/MeetingRoom";
import { board, memoryStorage, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

const awaiting: BoardMeeting = {
  id: "m-wait",
  topic: "Open a Dubai office?",
  brief: "",
  members: ["zain-board-hormozi"],
  mode: "voice",
  boardOnly: false,
  discussionRounds: 1,
  status: "awaiting-founder",
  currentRound: 2,
  turns: [],
  votes: [],
  requestedBy: "hq",
  createdAt: NOW - 3600,
  updatedAt: NOW - 60,
};

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "";
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["spoken words"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
let getUserMedia: ReturnType<typeof vi.fn>;

function routes(meeting: BoardMeeting, transcribe: unknown = { text: "Let's open in Q3." }) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [MEETINGS_API.one(meeting.id)]: { meeting },
    [VOICE_API.voices]: { configured: true, voices: [] },
    [`POST ${VOICE_API.transcribe}`]: transcribe,
  });
}

async function composer() {
  renderUi(<MeetingRoom id="m-wait" />);
  return screen.findByRole("region", { name: "Your remarks" });
}

describe("Founder mic in voice meetings", () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    stopTrack.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });

  it("records with a timer, transcribes with the recording's type, and puts the text in the remark box", async () => {
    let finish: (r: Response) => void = () => undefined;
    const fetch = routes(awaiting, () => new Promise<Response>((r) => (finish = r)));
    const box = await composer();
    const remarks = within(box).getByLabelText(/Your remarks to the board/);
    await userEvent.type(remarks, "Two points.");
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    await userEvent.click(within(box).getByRole("button", { name: "Speak" }));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(within(box).getByRole("button", { name: "Stop" })).toHaveAttribute("aria-pressed", "true");
    expect(within(box).getByText(/Recording 0:00/)).toBeInTheDocument();
    now.mockReturnValue(t0 + 65_000);
    expect(await within(box).findByText(/Recording 1:05/)).toBeInTheDocument();
    now.mockRestore();
    await userEvent.click(within(box).getByRole("button", { name: "Stop" }));
    expect(stopTrack).toHaveBeenCalled();
    expect(within(box).getByText("Transcribing…")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Speak" })).toBeDisabled();
    const upload = fetch.fn.mock.calls.find(([u]) => String(u) === VOICE_API.transcribe)!;
    const init = upload[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("audio/webm");
    expect(init.body).toBeInstanceOf(Blob);
    expect((init.body as Blob).type).toBe("audio/webm;codecs=opus");
    finish(new Response(JSON.stringify({ text: " Let's open in Q3. " }), { status: 200 }));
    await waitFor(() => expect(remarks).toHaveValue("Two points. Let's open in Q3."));
    expect(within(box).queryByText("Transcribing…")).not.toBeInTheDocument();
    expect(fetch.calls("POST", MEETINGS_API.remark("m-wait"))).toHaveLength(0);
  });

  it("explains a blocked microphone", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    routes(awaiting);
    const box = await composer();
    await userEvent.click(within(box).getByRole("button", { name: "Speak" }));
    expect(await within(box).findByRole("alert")).toHaveTextContent("Microphone access is blocked");
    expect(within(box).getByRole("button", { name: "Speak" })).toBeEnabled();
  });

  it("shows transcription errors and keeps what was typed", async () => {
    routes(awaiting, () => new Response(JSON.stringify({ error: "ElevenLabs isn't configured" }), { status: 503 }));
    const box = await composer();
    const remarks = within(box).getByLabelText(/Your remarks to the board/);
    await userEvent.type(remarks, "Typed.");
    await userEvent.click(within(box).getByRole("button", { name: "Speak" }));
    await userEvent.click(within(box).getByRole("button", { name: "Stop" }));
    expect(await within(box).findByRole("alert")).toHaveTextContent("Couldn't transcribe: ElevenLabs isn't configured");
    expect(remarks).toHaveValue("Typed.");
  });

  it("says when nothing was heard", async () => {
    routes(awaiting, { text: "  " });
    const box = await composer();
    await userEvent.click(within(box).getByRole("button", { name: "Speak" }));
    await userEvent.click(within(box).getByRole("button", { name: "Stop" }));
    expect(await within(box).findByRole("alert")).toHaveTextContent("No words were heard");
  });

  it("disables the mic where the browser can't record", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    routes(awaiting);
    const box = await composer();
    expect(within(box).getByRole("button", { name: "Speak" })).toBeDisabled();
    expect(within(box).getByRole("button", { name: "Speak" })).toHaveAttribute("title", "Voice input isn't supported in this browser");
  });

  it("has no mic in chat meetings", async () => {
    routes({ ...awaiting, mode: "chat" });
    const box = await composer();
    expect(within(box).queryByRole("button", { name: "Speak" })).not.toBeInTheDocument();
  });
});
