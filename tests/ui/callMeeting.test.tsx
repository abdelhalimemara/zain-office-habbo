import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { MEETING_BRIEF_MAX, MEETINGS_API, type BoardMeeting } from "@shared/meetings";
import { VOICE_API, type VoicesResponse } from "@shared/voice";
import { useUiStore } from "../../src/state/store";
import { UiRoot } from "../../src/ui/UiRoot";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const ALWALEED = "zain-board-alwaleed";
const BEZOS = "zain-board-bezos";
const BUFFETT = "zain-board-buffett";

const created: BoardMeeting = {
  id: "m-new",
  topic: "Hire a CFO?",
  brief: "",
  members: [HORMOZI],
  mode: "voice",
  boardOnly: false,
  discussionRounds: 1,
  status: "in-round",
  currentRound: 1,
  turns: [],
  votes: [],
  requestedBy: "hq",
  createdAt: NOW,
  updatedAt: NOW,
};

function routes(voices: VoicesResponse = { configured: true, voices: [{ profile: HORMOZI, voiceId: "abcdefghij12345", fallback: false }] }) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [MEETINGS_API.list]: { meetings: [] },
    [MEETINGS_API.one("m-new")]: { meeting: created },
    [VOICE_API.voices]: voices,
    [`POST ${MEETINGS_API.list}`]: { meeting: created },
  });
}

function onHqFloor() {
  act(() => useUiStore.setState({ view: { kind: "floor", division: "hq" } }));
}

describe("Call a meeting", () => {
  beforeEach(resetStore);

  it("shows the CTA on the HQ floor only", async () => {
    routes();
    renderUi(<UiRoot />);
    expect(screen.queryByRole("button", { name: "Call a meeting" })).not.toBeInTheDocument();
    act(() => useUiStore.setState({ view: { kind: "floor", division: "studio" } }));
    expect(screen.queryByRole("button", { name: "Call a meeting" })).not.toBeInTheDocument();
    onHqFloor();
    expect(await screen.findByRole("button", { name: "Call a meeting" })).toBeEnabled();
  });

  it("opens a labelled modal on the type choice, traps focus, and closes on Esc back to the CTA", async () => {
    routes();
    renderUi(<UiRoot />);
    onHqFloor();
    const cta = await screen.findByRole("button", { name: "Call a meeting" });
    await userEvent.click(cta);
    const dialog = screen.getByRole("dialog", { name: "Call a board meeting" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const cards = within(within(dialog).getByRole("group", { name: "Meeting type" })).getAllByRole("button");
    expect(cards.map((c) => c.querySelector(".zui-mode-card__title")!.textContent)).toEqual(["Chat meeting", "Voice meeting"]);
    expect(cards[0]).toHaveFocus();
    await userEvent.tab();
    expect(cards[1]).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(cards[1]).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useUiStore.getState().callMeetingOpen).toBe(false);
    expect(cta).toHaveFocus();
  });

  it("Esc closes only the modal when a panel is open beneath it", async () => {
    routes();
    act(() => useUiStore.setState({ panel: { kind: "board", tab: "meetings" } }));
    renderUi(<UiRoot />);
    await userEvent.click(await screen.findByRole("button", { name: "Call a meeting" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useUiStore.getState().panel).toEqual({ kind: "board", tab: "meetings" });
  });

  it("validates and starts a chat meeting with the chosen members and rounds, then opens the room", async () => {
    const fetch = routes();
    renderUi(<UiRoot />);
    onHqFloor();
    await userEvent.click(await screen.findByRole("button", { name: "Call a meeting" }));
    await userEvent.click(screen.getByRole("button", { name: /Chat meeting/ }));
    const form = screen.getByRole("form", { name: "Chat meeting details" });
    expect(within(form).getByLabelText(/Topic/)).toHaveFocus();
    expect(within(form).queryByText(/Own voice|Stock voice/)).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Convene" }));
    expect(within(form).getByText("Give the meeting a topic.")).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/Topic/), "x".repeat(161));
    await userEvent.click(within(form).getByRole("button", { name: "Convene" }));
    expect(within(form).getByText("Keep the topic to 160 characters.")).toBeInTheDocument();
    await userEvent.clear(within(form).getByLabelText(/Topic/));
    await userEvent.type(within(form).getByLabelText(/Topic/), "Hire a CFO?");
    const brief = within(form).getByLabelText(/Brief/);
    await userEvent.click(brief);
    await userEvent.paste("y".repeat(MEETING_BRIEF_MAX + 1));
    await userEvent.click(within(form).getByRole("button", { name: "Convene" }));
    expect(within(form).getByText("Keep the brief to 8000 characters.")).toBeInTheDocument();
    await userEvent.clear(brief);
    await userEvent.type(brief, "Runway 18 months.");
    await userEvent.click(within(form).getByRole("checkbox", { name: /Steve Jobs/ }));
    await userEvent.click(within(form).getByRole("checkbox", { name: /Board discusses on its own/ }));
    await userEvent.selectOptions(within(form).getByLabelText("Discussion rounds"), "2");
    await userEvent.click(within(form).getByRole("button", { name: "Convene" }));
    await screen.findByRole("heading", { name: "Hire a CFO?" });
    expect(fetch.calls("POST", MEETINGS_API.list)).toEqual([
      { body: { topic: "Hire a CFO?", brief: "Runway 18 months.", members: [HORMOZI, ALWALEED, BEZOS, BUFFETT], boardOnly: true, mode: "chat", discussionRounds: 2 } },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useUiStore.getState().panel).toEqual({ kind: "meeting", id: "m-new" });
  });

  it("voice mode is a live room: no rounds or board-only toggle, an agenda hint, each selected member's voice", async () => {
    const fetch = routes();
    renderUi(<UiRoot />);
    onHqFloor();
    await userEvent.click(await screen.findByRole("button", { name: "Call a meeting" }));
    expect(screen.getByRole("button", { name: /Voice meeting/ })).toHaveTextContent(
      "Live room: talk with the board in real time, everyone hears you, anyone can jump in. Open floor unless your brief has an agenda.",
    );
    await userEvent.click(screen.getByRole("button", { name: /Voice meeting/ }));
    const form = screen.getByRole("form", { name: "Voice meeting details" });
    expect(within(form).queryByLabelText("Discussion rounds")).not.toBeInTheDocument();
    expect(within(form).queryByRole("checkbox", { name: /Board discusses on its own/ })).not.toBeInTheDocument();
    expect(within(form).getByText("Add an agenda (numbered points) if you want them to go item by item.")).toBeInTheDocument();
    const hormozi = within(form).getByRole("checkbox", { name: /Alex Hormozi/ }).closest("label")!;
    expect(await within(hormozi).findByText("Own voice")).toBeInTheDocument();
    expect(within(within(form).getByRole("checkbox", { name: /Jeff Bezos/ }).closest("label")!).getByText("Stock voice")).toBeInTheDocument();
    expect(within(form).queryByText(/ElevenLabs isn't connected/)).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("checkbox", { name: /Jeff Bezos/ }));
    expect(within(within(form).getByRole("checkbox", { name: /Jeff Bezos/ }).closest("label")!).queryByText(/voice/)).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Voice meeting/ })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: /Voice meeting/ }));
    await userEvent.type(screen.getByLabelText(/Topic/), "Hire a CFO?");
    await userEvent.click(screen.getByRole("button", { name: "Convene" }));
    await screen.findByRole("heading", { name: "Hire a CFO?" });
    const body = fetch.calls("POST", MEETINGS_API.list)[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ mode: "voice", topic: "Hire a CFO?", brief: "" });
    expect(body).not.toHaveProperty("discussionRounds");
    expect(body).not.toHaveProperty("boardOnly");
  });

  it("warns when ElevenLabs isn't connected but still lets a voice meeting start", async () => {
    const fetch = routes({ configured: false, voices: [] });
    renderUi(<UiRoot />);
    onHqFloor();
    await userEvent.click(await screen.findByRole("button", { name: "Call a meeting" }));
    expect(await screen.findByText("ElevenLabs not connected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Voice meeting/ }));
    const notice = await screen.findByText(/ElevenLabs isn't connected/);
    expect(notice.closest("p")).toHaveTextContent("ELEVENLABS_API_KEY");
    await userEvent.type(screen.getByLabelText(/Topic/), "Hire a CFO?");
    await userEvent.click(screen.getByRole("button", { name: "Convene" }));
    await screen.findByRole("heading", { name: "Hire a CFO?" });
    expect(fetch.calls("POST", MEETINGS_API.list)).toHaveLength(1);
  });
});
