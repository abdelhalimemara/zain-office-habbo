import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { ACTION_TITLE_MAX, LEADERSHIP_API, PRIORITIES_MAX, type ActionItem } from "@shared/leadership";
import { MEETINGS_API, type BoardMeeting } from "@shared/meetings";
import { useUiStore } from "../../src/state/store";
import { UiRoot } from "../../src/ui/UiRoot";
import { board, mockFetch, NOW, renderUi, resetStore, rosterEntries, task } from "./helpers";

const ACTIONS: ActionItem[] = [
  { id: "a1", division: "growth", title: "Launch the Ramadan campaign", detail: "Budget 40k", priority: "P2", status: "proposed" },
  { id: "a2", division: "studio", title: "Riyadh rebrand", detail: "", priority: "P1", due: "2026-10-09", status: "proposed" },
  { id: "a3", division: "tech", title: "Dropped idea", detail: "", priority: "P3", status: "dropped" },
];

const review: BoardMeeting = {
  id: "l1",
  kind: "leadership",
  topic: "Weekly priorities · week of 28 Sep 2026",
  brief: "",
  members: ["default", "zain-hq-coo", "zain-studio-vp", "zain-growth-vp"],
  mode: "voice",
  boardOnly: false,
  discussionRounds: 0,
  status: "review",
  currentRound: 1,
  turns: [{ round: 1, kind: "discussion", speaker: "zain-studio-vp", text: "Rebrand first.", at: NOW }],
  votes: [],
  requestedBy: "hq",
  createdAt: NOW,
  updatedAt: NOW,
  outcome: { priorities: "1. Riyadh launch\n2. Ramadan", actions: ACTIONS },
};

const withActions = (actions: ActionItem[], status: BoardMeeting["status"] = "review"): BoardMeeting => ({ ...review, status, outcome: { ...review.outcome!, actions } });
const assigned = (a: ActionItem, taskId: string): ActionItem => ({ ...a, status: "assigned", taskId });

type Handler = (init: RequestInit | undefined) => unknown;

function routes(extra: Record<string, Handler | unknown> = {}, meeting: BoardMeeting = review) {
  return mockFetch({
    [API.board]: board([task({ id: "t_100", status: "running", tenant: "zain-studio", assignee: "zain-studio-vp" })]),
    [API.roster]: { agents: rosterEntries },
    [MEETINGS_API.list]: { meetings: [meeting] },
    [MEETINGS_API.one("l1")]: { meeting },
    ...extra,
  });
}

function open() {
  act(() => useUiStore.setState({ panel: { kind: "leadership", id: "l1" } }));
  renderUi(<UiRoot />);
}

const editor = () => screen.findByRole("region", { name: "Review tasks" });
const rows = () => within(screen.getByRole("list", { name: "Actions" })).getAllByRole("listitem");

describe("Leadership review", () => {
  beforeEach(resetStore);

  it("opens with this week's priorities, then the proposed actions P1 first, each with its owner", async () => {
    routes();
    open();
    const region = await editor();
    expect(within(region).getByLabelText("This week's priorities")).toHaveValue("1. Riyadh launch\n2. Ramadan");
    expect(rows()).toHaveLength(2);
    expect(within(rows()[0]!).getByLabelText("Title, action 1")).toHaveValue("Riyadh rebrand");
    expect(within(rows()[0]!).getByLabelText("Division, action 1")).toHaveValue("studio");
    // The owner is named with their seat, and each division option names the exec who receives it.
    expect(within(rows()[0]!).getByRole("img", { name: "Lina Haddad · VP Studio" })).toBeInTheDocument();
    expect(rows()[0]!.querySelector("[data-sprite]")).toHaveAttribute("data-sprite", "people/female-4");
    expect(within(rows()[0]!).getByRole("option", { name: "Studio · Lina Haddad", selected: true })).toBeInTheDocument();
    expect(within(rows()[0]!).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "HQ · Faisal Al-Harbi",
      "Studio · Lina Haddad",
      "Growth · Omar Khalid",
      "Labs · Noura Al-Qahtani",
      "Tech · Yousef Al-Mutairi",
    ]);
    expect(within(rows()[0]!).getByRole("radio", { name: "P1" })).toHaveAttribute("aria-checked", "true");
    expect(within(rows()[0]!).getByLabelText("Due date, action 1")).toHaveValue("2026-10-09");
    expect(within(rows()[1]!).getByLabelText("Title, action 2")).toHaveValue("Launch the Ramadan campaign");
    expect(rows()[0]!.querySelector("[data-sprite], .zui-avatar")).not.toBeNull();
    expect(screen.queryByText("Dropped idea")).not.toBeInTheDocument();
    expect(screen.queryByText(/vote/i)).not.toBeInTheDocument();
  });

  it("edits, adds and removes rows, and saves the full list with a PUT", async () => {
    const fetch = routes({ [`PUT ${LEADERSHIP_API.actions("l1")}`]: { meeting: review } });
    open();
    await editor();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(within(rows()[1]!).getByRole("radio", { name: "P3" }));
    await userEvent.clear(screen.getByLabelText("Title, action 1"));
    await userEvent.type(screen.getByLabelText("Title, action 1"), "Riyadh rebrand v2");
    await userEvent.click(screen.getByRole("button", { name: "+ Add action" }));
    expect(rows()).toHaveLength(3);
    await userEvent.selectOptions(screen.getByLabelText("Division, action 3"), "labs");
    await userEvent.type(screen.getByLabelText("Title, action 3"), "Close the Labs partner");
    await userEvent.type(screen.getByLabelText("Detail, action 3"), "Signed by Thursday");
    await userEvent.click(within(rows()[2]!).getByRole("radio", { name: "P1" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove action 2" }));
    expect(rows()).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetch.calls("PUT", LEADERSHIP_API.actions("l1"))).toHaveLength(1));
    const body = fetch.calls("PUT", LEADERSHIP_API.actions("l1"))[0]!.body as { priorities: string; actions: Record<string, unknown>[] };
    expect(body.priorities).toBe("1. Riyadh launch\n2. Ramadan");
    expect(body.actions).toHaveLength(2);
    expect(body.actions[0]).toEqual({ id: "a2", division: "studio", title: "Riyadh rebrand v2", detail: "", priority: "P1", due: "2026-10-09" });
    expect(body.actions[1]).toMatchObject({ division: "labs", title: "Close the Labs partner", detail: "Signed by Thursday", priority: "P1" });
    expect(body.actions[1]).not.toHaveProperty("due");
  });

  it("sorts rows by priority on request", async () => {
    routes();
    open();
    await editor();
    await userEvent.click(within(rows()[0]!).getByRole("radio", { name: "P3" }));
    expect(screen.getByLabelText("Title, action 1")).toHaveValue("Riyadh rebrand");
    await userEvent.click(screen.getByRole("button", { name: "Sort by priority" }));
    expect(screen.getByLabelText("Title, action 1")).toHaveValue("Launch the Ramadan campaign");
    expect(screen.getByLabelText("Title, action 2")).toHaveValue("Riyadh rebrand");
  });

  it("validates titles and lengths against the shared limits before saving", async () => {
    const fetch = routes({ [`PUT ${LEADERSHIP_API.actions("l1")}`]: { meeting: review } });
    open();
    await editor();
    await userEvent.clear(screen.getByLabelText("Title, action 1"));
    await userEvent.click(screen.getByRole("button", { name: "+ Add action" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByText("Give the action a title.")).toHaveLength(2);
    await userEvent.type(screen.getByLabelText("Title, action 1"), "x");
    act(() => {
      const input = screen.getByLabelText("Title, action 3") as HTMLInputElement;
      input.removeAttribute("maxlength");
    });
    await userEvent.click(screen.getByLabelText("Title, action 3"));
    await userEvent.paste("y".repeat(ACTION_TITLE_MAX + 1));
    expect(screen.getByText(`Keep the title to ${ACTION_TITLE_MAX} characters.`)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("This week's priorities"));
    await userEvent.paste("z".repeat(PRIORITIES_MAX));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(`Keep the priorities to ${PRIORITIES_MAX} characters.`)).toBeInTheDocument();
    expect(fetch.calls("PUT", LEADERSHIP_API.actions("l1"))).toHaveLength(0);
  });

  it("assigns after a confirm, exactly once however often it is clicked, then shows the assigned summary", async () => {
    let release: () => void = () => undefined;
    const done = withActions([assigned(ACTIONS[0]!, "t_101"), assigned(ACTIONS[1]!, "t_100"), ACTIONS[2]!], "assigned");
    const fetch = routes({
      [`POST ${LEADERSHIP_API.assign("l1")}`]: () => new Promise((r) => (release = () => r({ meeting: done }))),
    });
    open();
    await editor();
    await userEvent.click(screen.getByRole("button", { name: "Assign & start" }));
    const confirm = screen.getByRole("group", { name: "Confirm assign" });
    expect(confirm).toHaveTextContent("Create 2 mandates for the divisions?");
    const go = within(confirm).getByRole("button", { name: "Create mandates" });
    await userEvent.click(go);
    await userEvent.click(go).catch(() => undefined);
    await waitFor(() => expect(fetch.calls("POST", LEADERSHIP_API.assign("l1"))).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Assigning…" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Assigning…" })).catch(() => undefined);
    expect(fetch.calls("PUT", LEADERSHIP_API.actions("l1"))).toHaveLength(0);
    expect(fetch.calls("POST", LEADERSHIP_API.assign("l1"))[0]!.body).toEqual({ ids: ["a1", "a2"] });
    await act(async () => release());
    expect(await screen.findByRole("region", { name: "This week's priorities" })).toHaveTextContent("1. Riyadh launch");
    expect(fetch.calls("POST", LEADERSHIP_API.assign("l1"))).toHaveLength(1);
    const link = screen.getByRole("button", { name: "Open task t_100" });
    expect(link.closest("li")).toHaveTextContent("Assigned · t_100");
    expect(link.closest("li")).toHaveTextContent("running");
    await userEvent.click(link);
    expect(useUiStore.getState().panel).toEqual({ kind: "task", id: "t_100" });
  });

  it("saves pending edits before assigning", async () => {
    const edited = withActions([{ ...ACTIONS[1]!, title: "Riyadh rebrand now" }, ACTIONS[0]!, ACTIONS[2]!]);
    const fetch = routes({
      [`PUT ${LEADERSHIP_API.actions("l1")}`]: { meeting: edited },
      [`POST ${LEADERSHIP_API.assign("l1")}`]: { meeting: withActions([assigned(ACTIONS[0]!, "t_101"), assigned(edited.outcome!.actions[0]!, "t_100")], "assigned") },
    });
    open();
    await editor();
    await userEvent.type(screen.getByLabelText("Title, action 1"), " now");
    await userEvent.click(screen.getByRole("button", { name: "Assign & start" }));
    await userEvent.click(screen.getByRole("button", { name: "Create mandates" }));
    await screen.findByRole("region", { name: "This week's priorities" });
    const order = fetch.fn.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u)}`).filter((k) => !k.startsWith("GET"));
    expect(order).toEqual([`PUT ${LEADERSHIP_API.actions("l1")}`, `POST ${LEADERSHIP_API.assign("l1")}`]);
  });

  it("shows partial failures per row and retries just that row", async () => {
    const partial = withActions([ACTIONS[0]!, assigned(ACTIONS[1]!, "t_100"), ACTIONS[2]!]);
    const all = withActions([assigned(ACTIONS[0]!, "t_101"), assigned(ACTIONS[1]!, "t_100"), ACTIONS[2]!], "assigned");
    let call = 0;
    const fetch = routes({ [`POST ${LEADERSHIP_API.assign("l1")}`]: () => ({ meeting: ++call === 1 ? partial : all }) });
    open();
    await editor();
    await userEvent.click(screen.getByRole("button", { name: "Assign & start" }));
    await userEvent.click(screen.getByRole("button", { name: "Create mandates" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't assign: The mandate wasn't created.");
    expect(alert.closest("li")).toHaveAccessibleName("Action 2");
    expect(screen.getByRole("button", { name: "Open task t_100" }).closest("li")).toHaveTextContent("Assigned · t_100");
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByRole("region", { name: "This week's priorities" });
    expect(fetch.calls("POST", LEADERSHIP_API.assign("l1")).map((c) => c.body)).toEqual([{ ids: ["a1", "a2"] }, { ids: ["a1"] }]);
  });

  it("marks every row failed when the server could assign none", async () => {
    routes({ [`POST ${LEADERSHIP_API.assign("l1")}`]: () => new Response(JSON.stringify({ error: "no action could be assigned (hermes down)" }), { status: 502 }) });
    open();
    await editor();
    await userEvent.click(screen.getByRole("button", { name: "Assign & start" }));
    await userEvent.click(screen.getByRole("button", { name: "Create mandates" }));
    await waitFor(() => expect(screen.getAllByText("Couldn't assign: no action could be assigned (hermes down)")).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
  });
});

describe("Leadership drafting and assigned", () => {
  beforeEach(resetStore);

  it("shows Susu drafting with the transcript, labelled by name and seat", async () => {
    routes({}, { ...review, status: "drafting", outcome: undefined });
    open();
    expect(await screen.findByText("Susu is turning the meeting into tasks…")).toBeInTheDocument();
    const transcript = screen.getByRole("list", { name: "Transcript" });
    expect(within(transcript).getByText("Lina Haddad · VP Studio")).toBeInTheDocument();
    expect(within(transcript).getByText("Rebrand first.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Review tasks" })).not.toBeInTheDocument();
  });

  it("shows assigned meetings read-only, with the transcript collapsed", async () => {
    routes({}, withActions([assigned(ACTIONS[1]!, "t_100"), ACTIONS[2]!], "assigned"));
    open();
    expect(await screen.findByRole("region", { name: "This week's priorities" })).toHaveTextContent("2. Ramadan");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Transcript").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Riyadh rebrand")).toBeInTheDocument();
  });
});
