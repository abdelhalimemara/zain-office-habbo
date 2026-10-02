import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { AUDITS_API } from "@shared/audits";
import { PROSPECTS_API, type ProspectHit } from "../../src/api/client";
import { useUiStore } from "../../src/state/store";
import { UiRoot } from "../../src/ui/UiRoot";
import { runningAudit } from "./auditFixtures";
import { board, mockFetch, renderUi, resetStore, rosterEntries } from "./helpers";

const HITS: ProspectHit[] = [
  { id: "lead-1", kind: "lead", name: "Nakheel Dental", website: "nakheeldental.com", instagram: "@nakheel", city: "Jeddah" },
  { id: "co-2", kind: "company", name: "Sahara Motors" },
];

function open() {
  const fetch = mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [API.health]: { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "off", telegramApprovals: "ready", board: "zain-group" },
    [AUDITS_API.list]: { audits: [] },
    [AUDITS_API.one(runningAudit.id)]: { audit: runningAudit },
    [`POST ${AUDITS_API.list}`]: { audit: runningAudit },
    [PROSPECTS_API("")]: { prospects: HITS },
    [PROSPECTS_API("sahara")]: { prospects: [HITS[1]] },
    [PROSPECTS_API("zzz")]: { prospects: [] },
  });
  act(() => useUiStore.setState({ panel: { kind: "audits", compose: true } }));
  renderUi(<UiRoot />);
  return fetch;
}

const body = (fetch: ReturnType<typeof open>) => fetch.calls("POST", AUDITS_API.list).map((c) => c.body);

describe("New audit form", () => {
  beforeEach(resetStore);
  afterEach(() => vi.unstubAllGlobals());

  it("starts from a CRM lead picked by search and opens the audit", async () => {
    const fetch = open();
    await userEvent.click(await screen.findByRole("button", { name: /^Nakheel Dental/ }));
    expect(screen.getByText("nakheeldental.com · Instagram")).toBeInTheDocument();
    expect(screen.queryByLabelText("Website")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    await waitFor(() => expect(body(fetch)).toEqual([{ leadId: "lead-1" }]));
    await waitFor(() => expect(useUiStore.getState().panel).toEqual({ kind: "audits", id: runningAudit.id }));
  });

  it("searches the CRM as you type and asks for a website the record lacks", async () => {
    const fetch = open();
    await userEvent.type(await screen.findByLabelText("Search the CRM"), "sahara");
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Nakheel Dental/ })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^Sahara Motors/ }));
    expect(screen.getByText("No website on the CRM record")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the prospect's website.");
    await userEvent.type(screen.getByLabelText("Website"), "saharamotors.sa");
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    await waitFor(() => expect(body(fetch)).toEqual([{ companyId: "co-2", website: "https://saharamotors.sa" }]));
  });

  it("says when nothing matches, and requires a pick", async () => {
    const fetch = open();
    await userEvent.type(await screen.findByLabelText("Search the CRM"), "zzz");
    expect(await screen.findByText('No CRM prospects match "zzz".')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a prospect from the CRM.");
    expect(body(fetch)).toEqual([]);
  });

  it("validates a pasted website before sending it", async () => {
    const fetch = open();
    await userEvent.click(await screen.findByRole("radio", { name: "Website" }));
    const site = screen.getByLabelText("Website");
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the prospect's website.");

    await userEvent.type(site, "not a site");
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A website address has no spaces.");
    expect(site).toHaveAttribute("aria-invalid", "true");

    await userEvent.clear(site);
    await userEvent.type(site, "ftp://files.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use an http or https address.");
    expect(body(fetch)).toEqual([]);
  });

  it("sends a pasted website with name and optional socials", async () => {
    const fetch = open();
    await userEvent.click(await screen.findByRole("radio", { name: "Website" }));
    await userEvent.type(screen.getByLabelText(/Prospect name/), "Kahwa House");
    await userEvent.type(screen.getByLabelText("Website"), "www.kahwahouse.sa");
    await userEvent.click(screen.getByText("Socials (optional)"));
    await userEvent.type(screen.getByLabelText("Instagram"), "@kahwahouse");
    await userEvent.type(screen.getByLabelText("TikTok"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    await waitFor(() =>
      expect(body(fetch)).toEqual([{ website: "https://www.kahwahouse.sa", name: "Kahwa House", socials: { instagram: "@kahwahouse" } }]),
    );
    await waitFor(() => expect(useUiStore.getState().panel).toEqual({ kind: "audits", id: runningAudit.id }));
  });

  it("shows a server error from starting", async () => {
    mockFetch({
      [API.roster]: { agents: rosterEntries },
      [API.board]: board([]),
      [PROSPECTS_API("")]: { prospects: [] },
      [`POST ${AUDITS_API.list}`]: () => new Response(JSON.stringify({ error: "Audit spend cap reached" }), { status: 429 }),
    });
    act(() => useUiStore.setState({ panel: { kind: "audits", compose: true } }));
    renderUi(<UiRoot />);
    await userEvent.click(await screen.findByRole("radio", { name: "Website" }));
    await userEvent.type(screen.getByLabelText("Website"), "acme.com");
    await userEvent.click(screen.getByRole("button", { name: "Start audit" }));
    expect(await screen.findByText("Audit spend cap reached")).toBeInTheDocument();
    expect(useUiStore.getState().panel).toEqual({ kind: "audits", compose: true });
  });
});
