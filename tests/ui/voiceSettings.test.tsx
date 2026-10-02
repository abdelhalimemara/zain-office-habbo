import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { VOICE_API, type VoicesResponse } from "@shared/voice";
import { BoardPanel } from "../../src/ui/BoardPanel";
import { board, mockFetch, renderUi, resetStore, rosterEntries } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const OWN = "abcdefghij1234567890";

function routes(voices: VoicesResponse) {
  return mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [VOICE_API.voices]: voices,
    [`PUT ${VOICE_API.voice(HORMOZI)}`]: { ok: true },
    [`PUT ${VOICE_API.voice("default")}`]: () => new Response(JSON.stringify({ error: "unknown voice" }), { status: 400 }),
  });
}

const configured: VoicesResponse = {
  configured: true,
  voices: [
    { profile: "default", voiceId: "stockchairvoice00", fallback: true },
    { profile: HORMOZI, voiceId: OWN, fallback: false },
  ],
};

async function voicesSection() {
  renderUi(<BoardPanel tab="consult" />);
  const section = await screen.findByRole("region", { name: "Voices" });
  await within(section).findAllByText("Own voice");
  return section;
}

describe("Voice settings", () => {
  beforeEach(resetStore);

  it("lists the chair as the CEO and every board member with own or stock voice", async () => {
    routes(configured);
    const section = await voicesSection();
    const rows = within(section).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".zui-voice-row__name")!.textContent)).toEqual([
      "CEO",
      "Alex Hormozi",
      "HRH Prince Alwaleed bin Talal",
      "Jeff Bezos",
      "Warren Buffett",
      "Steve Jobs",
    ]);
    expect(within(rows[0]!).getByText("Stock voice")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Own voice")).toBeInTheDocument();
    expect(within(rows[1]!).getByLabelText("ElevenLabs voice id for Alex Hormozi")).toHaveAttribute("placeholder", OWN);
    expect(within(rows[2]!).getByText("Stock voice")).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("button", { name: "Use stock" })).not.toBeInTheDocument();
  });

  it("validates the pasted id, then saves it", async () => {
    const fetch = routes(configured);
    const section = await voicesSection();
    const row = within(section).getAllByRole("listitem")[1]!;
    const input = within(row).getByLabelText("ElevenLabs voice id for Alex Hormozi");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(within(row).getByText("Paste an ElevenLabs voice id.")).toBeInTheDocument();
    await userEvent.type(input, "not a voice!");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/10–40 letters and digits/);
    expect(fetch.calls("PUT", VOICE_API.voice(HORMOZI))).toHaveLength(0);
    await userEvent.clear(input);
    await userEvent.type(input, " 21m00Tcm4TlvDq8ikWAM ");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(fetch.calls("PUT", VOICE_API.voice(HORMOZI))).toEqual([{ body: { voiceId: "21m00Tcm4TlvDq8ikWAM" } }]);
    await waitFor(() => expect(input).toHaveValue(""));
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(fetch.calls("GET", VOICE_API.voices).length).toBeGreaterThan(1);
  });

  it("goes back to the stock voice", async () => {
    const fetch = routes(configured);
    const section = await voicesSection();
    const row = within(section).getAllByRole("listitem")[1]!;
    await userEvent.click(within(row).getByRole("button", { name: "Use stock" }));
    expect(fetch.calls("PUT", VOICE_API.voice(HORMOZI))).toEqual([{ body: { voiceId: null } }]);
  });

  it("shows server errors per row", async () => {
    routes(configured);
    const section = await voicesSection();
    const row = within(section).getAllByRole("listitem")[0]!;
    await userEvent.type(within(row).getByRole("textbox"), "21m00Tcm4TlvDq8ikWAM");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("unknown voice");
  });

  it("explains that ElevenLabs isn't connected", async () => {
    routes({ configured: false, voices: [] });
    renderUi(<BoardPanel tab="consult" />);
    const section = await screen.findByRole("region", { name: "Voices" });
    expect(await within(section).findByText(/ElevenLabs isn't connected/)).toBeInTheDocument();
    expect(within(section).getByText(/ElevenLabs isn't connected/).closest("p")).toHaveTextContent("ELEVENLABS_API_KEY");
  });
});

