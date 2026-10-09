import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { AgentCard } from "../../src/ui/AgentCard";
import { KanbanPanel } from "../../src/ui/KanbanPanel";
import { board, mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const growthTasks = [
  task({ id: "a1", title: "Audit acme.com", tenant: "zain-growth", assignee: "zain-growth-audit", status: "running" }),
  task({ id: "p1", title: "Q4 Meta ads", tenant: "zain-growth", assignee: "zain-growth-paid", status: "todo" }),
  task({ id: "p2", title: "Old test", tenant: "zain-growth", assignee: "zain-growth-cro", status: "done", completed_at: 3 }),
];

beforeEach(() => {
  resetStore();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => vi.unstubAllGlobals());

describe("units in the UI", () => {
  it("shows a specialist's unit on their agent card", async () => {
    mockFetch({ [API.board]: board([]), [API.roster]: { agents: rosterEntries } });
    renderUi(<AgentCard profile="zain-growth-audit" />);
    expect(await screen.findByText("Unit")).toBeInTheDocument();
    expect(screen.getByText("Growth", { selector: "dd" })).toHaveAttribute("title", expect.stringMatching(/prospect audits/));
    expect(screen.getByText("Rami Saleh", { selector: "strong" })).toBeInTheDocument();
  });

  it("shows no unit row for a VP", async () => {
    mockFetch({ [API.board]: board([]), [API.roster]: { agents: rosterEntries } });
    renderUi(<AgentCard profile="zain-studio-vp" />);
    await screen.findByText("Rank");
    expect(screen.queryByText("Unit")).toBeNull();
  });

  it("groups the Growth kanban team by unit with each unit's open work, and tags cards with the unit", async () => {
    mockFetch({ [API.board]: board(growthTasks), [API.roster]: { agents: rosterEntries } });
    renderUi(<KanbanPanel division="growth" />);
    const card = (await screen.findByText("Audit acme.com")).closest("button")!;
    expect(within(card).getByTitle("Unit")).toHaveTextContent("Growth");
    const units = screen.getByRole("region", { name: "Units" });
    const performance = within(units).getByLabelText("Performance unit");
    expect(within(performance).getByTitle("Open tasks")).toHaveTextContent("1");
    expect(within(performance).getAllByRole("listitem")).toHaveLength(3);
    const growth = within(units).getByLabelText("Growth unit");
    expect(within(growth).getByText("Rami Saleh")).toBeInTheDocument();
    expect(within(growth).getByText("Hadi Nasser")).toBeInTheDocument();
    expect(within(growth).getByTitle("Open tasks")).toHaveTextContent("1");
  });

  it("lists Creative, Organic and Design on the Studio kanban", async () => {
    mockFetch({ [API.board]: board([]), [API.roster]: { agents: rosterEntries } });
    renderUi(<KanbanPanel division="studio" />);
    const units = await screen.findByRole("region", { name: "Units" });
    expect(within(units).getAllByRole("heading").map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(["Creative", "Organic", "Design"]);
    expect(within(within(units).getByLabelText("Organic unit")).getByText("Dana Al-Shammari")).toBeInTheDocument();
  });

  it("shows Claude in Design as an external Claude Code agent: lane status, no hire, no Hermes model", async () => {
    const agents = rosterEntries.map((a) => (a.profile === "zain-claude" ? { ...a, hired: true, model: null } : a));
    const tasks = [task({ id: "c1", title: "Ramadan ad set", tenant: "zain-studio", assignee: "zain-claude", status: "running" })];
    mockFetch({ [API.board]: board(tasks), [API.roster]: { agents } });
    renderUi(<AgentCard profile="zain-claude" />);
    expect(await screen.findByText("External · Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Design", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText(/Runs on Claude Code, not Hermes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ramadan ad set" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hire" })).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
  });

  it("shows no units on divisions without them", async () => {
    mockFetch({ [API.board]: board([]), [API.roster]: { agents: rosterEntries } });
    renderUi(<KanbanPanel division="labs" />);
    await screen.findByText("New mandate");
    expect(screen.queryByRole("region", { name: "Units" })).toBeNull();
  });
});
