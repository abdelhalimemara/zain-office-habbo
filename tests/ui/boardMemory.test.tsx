import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { BOARD_MEMORY_API, type BoardMemoryResponse } from "@shared/boardMemory";
import { useUiStore } from "../../src/state/store";
import { BoardPanel } from "../../src/ui/BoardPanel";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries } from "./helpers";

const HORMOZI = "zain-board-hormozi";
const BUFFETT = "zain-board-buffett";

const MEMORY: BoardMemoryResponse = {
  members: [
    {
      profile: HORMOZI,
      notes: [
        { id: "note_aaaaaaaaaa", text: "Founder wants Studio priced as a premium brand.", at: NOW - 3600, meetingId: "mtg_0000000001", meetingTopic: "Price Zain Studio" },
        { id: "note_bbbbbbbbbb", text: "Retainers start at SAR 40k a month.", at: NOW - 7200 },
      ],
    },
    { profile: BUFFETT, notes: [] },
  ],
};

function routes(onDelete?: () => void) {
  let memory = MEMORY;
  return mockFetch({
    [API.roster]: { agents: rosterEntries },
    [API.board]: board([]),
    [BOARD_MEMORY_API.list]: () => memory,
    [`DELETE ${BOARD_MEMORY_API.note(HORMOZI, "note_bbbbbbbbbb")}`]: () => {
      onDelete?.();
      memory = { members: [{ profile: HORMOZI, notes: [MEMORY.members[0]!.notes[0]!] }, MEMORY.members[1]!] };
      return new Response(null, { status: 204 });
    },
  });
}

describe("the Memory tab", () => {
  beforeEach(resetStore);

  it("lists each member's notes with their date and meeting", async () => {
    routes();
    renderUi(<BoardPanel tab="memory" />);
    expect(screen.getByRole("tab", { name: "Memory" })).toHaveAttribute("aria-selected", "true");
    const notes = await screen.findByRole("list", { name: "Alex Hormozi's notes" });
    const items = within(notes).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".zui-memory-note__text")!.textContent)).toEqual([
      "Founder wants Studio priced as a premium brand.",
      "Retainers start at SAR 40k a month.",
    ]);
    expect(items[0]!.querySelector("time")).toHaveAttribute("datetime", new Date((NOW - 3600) * 1000).toISOString());
    await userEvent.click(within(items[0]!).getByRole("button", { name: "Price Zain Studio" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "meeting", id: "mtg_0000000001" });
  });

  it("shows an empty member and forgets a note after confirming", async () => {
    let deleted = 0;
    const fetch = routes(() => deleted++);
    renderUi(<BoardPanel tab="memory" />);
    const buffett = (await screen.findByRole("heading", { name: "Warren Buffett" })).closest("li")!;
    expect(within(buffett).getByText("Nothing remembered yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Forget: Retainers start at SAR 40k a month." }));
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm forget" })).getByRole("button", { name: "Keep" }));
    expect(deleted).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "Forget: Retainers start at SAR 40k a month." }));
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm forget" })).getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(screen.queryByText("Retainers start at SAR 40k a month.")).not.toBeInTheDocument());
    expect(deleted).toBe(1);
    expect(fetch.calls("DELETE", BOARD_MEMORY_API.note(HORMOZI, "note_bbbbbbbbbb"))).toEqual([{ body: {} }]);
  });
});
