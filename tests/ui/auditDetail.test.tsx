import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "@shared/api";
import { AUDITS_API, type ProspectAudit } from "@shared/audits";
import { useUiStore } from "../../src/state/store";
import { UiRoot } from "../../src/ui/UiRoot";
import { doneAudit, failedAudit, runningAudit } from "./auditFixtures";
import { board, mockFetch, renderUi, resetStore, rosterEntries } from "./helpers";

function open(audit: ProspectAudit, extra: Record<string, unknown> = {}) {
  const fetch = mockFetch({
    [API.board]: board([]),
    [API.roster]: { agents: rosterEntries },
    [API.health]: { ok: true, hermes: "reachable", telegram: "connected", reviewDispatch: "off", telegramApprovals: "ready", board: "zain-group" },
    [AUDITS_API.list]: { audits: [audit] },
    [AUDITS_API.one(audit.id)]: { audit },
    ...extra,
  });
  act(() => useUiStore.setState({ panel: { kind: "audits", id: audit.id } }));
  renderUi(<UiRoot />);
  return fetch;
}

const section = (name: string) => screen.getByRole("region", { name });

describe("Audit detail", () => {
  beforeEach(resetStore);
  afterEach(() => vi.unstubAllGlobals());

  it("renders the header with website link, score dial and grade", async () => {
    open(doneAudit);
    expect(await screen.findByRole("heading", { name: "Nakheel Dental" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "nakheeldental.com" })).toHaveAttribute("href", "https://nakheeldental.com");
    expect(screen.getByRole("img", { name: "Overall score 64 of 100, grade C" })).toHaveTextContent("64");
    expect(screen.getByRole("img", { name: "Grade C, average" })).toHaveTextContent("C");
    expect(screen.getByText("Dental clinic · Jeddah")).toBeInTheDocument();
    expect(screen.getByText("Apify $1.03")).toBeInTheDocument();
  });

  it("renders every section of a finished audit", async () => {
    open(doneAudit);
    await screen.findByRole("heading", { name: "Nakheel Dental" });

    expect(within(section("Executive summary")).getByText(/strong Instagram following/)).toBeInTheDocument();
    expect(screen.getByText(/Open with the implant keyword gap/)).toBeInTheDocument();

    const bars = within(section("Scores")).getAllByRole("meter");
    expect(bars.map((b) => [b.getAttribute("aria-label"), b.getAttribute("aria-valuenow")])).toEqual([
      ["Website & SEO score", "72"],
      ["Search visibility score", "48"],
      ["Social score", "81"],
      ["Paid ads score", "20"],
      ["Tracking score", "55"],
    ]);
    expect(within(section("Scores")).getByText("30% weight")).toBeInTheDocument();
    expect(within(section("Scores")).getByText("No schema markup")).toBeInTheDocument();

    const findings = section("Findings");
    const website = within(findings).getByRole("region", { name: "Website & SEO findings" });
    expect(within(website).getAllByRole("listitem").map((li) => li.querySelector("strong")!.textContent)).toEqual(["Thin service pages", "Missing schema"]);
    expect(within(website).getAllByText("high")).toHaveLength(1);
    expect(within(findings).getByRole("region", { name: "Tracking findings" })).toHaveTextContent("No Meta pixel");

    const opps = within(section("Opportunities")).getAllByRole("listitem");
    expect(opps[0]).toHaveTextContent("Launch implant search campaign");
    expect(opps[0]).toHaveTextContent("Google Ads");
    expect(opps[0]).toHaveTextContent("high impact");
    expect(opps[0]).toHaveTextContent("Small effort");

    const comps = within(section("Competitors")).getAllByRole("listitem");
    expect(comps[0]).toHaveTextContent("Smile Hub smilehub.sa");
    expect(comps[1]).toHaveTextContent("Pearl Clinic");

    const steps = within(section("Pipeline")).getAllByRole("listitem");
    expect(steps).toHaveLength(9);
    expect(steps[0]).toHaveTextContent("Website crawl");
    expect(steps[0]).toHaveTextContent("$0.42");
    expect(steps[0]).toHaveTextContent("15s");
    expect(steps[3]).toHaveTextContent("Skipped");
    expect(steps[3]).toHaveTextContent("No ads in Meta Ad Library");
  });

  it("links the PDF, CRM and Notion and offers neither retry nor cancel when done", async () => {
    open(doneAudit);
    await screen.findByRole("heading", { name: "Nakheel Dental" });
    const actions = screen.getByRole("group", { name: "Audit actions" });
    expect(within(actions).getByRole("link", { name: "Open PDF" })).toHaveAttribute("href", AUDITS_API.pdf(doneAudit.id));
    expect(within(actions).getByRole("link", { name: "Open PDF" })).toHaveAttribute("target", "_blank");
    expect(within(actions).getByRole("link", { name: "Open in CRM" })).toHaveAttribute("href", doneAudit.crmUrl);
    expect(within(actions).getByRole("link", { name: "Open in Notion" })).toHaveAttribute("href", doneAudit.notionPageUrl);
    expect(within(actions).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("disables the links that are not ready and cancels a running audit", async () => {
    const cancelled: ProspectAudit = { ...runningAudit, status: "cancelled" };
    const fetch = open(runningAudit, { [`POST ${AUDITS_API.cancel(runningAudit.id)}`]: { audit: cancelled } });
    await screen.findByRole("heading", { name: "Kahwa House" });
    const actions = screen.getByRole("group", { name: "Audit actions" });
    for (const name of ["Open PDF", "Open in CRM", "Open in Notion"]) expect(within(actions).getByRole("button", { name })).toBeDisabled();
    expect(within(actions).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Overall score/ })).not.toBeInTheDocument();
    expect(within(section("Pipeline")).getAllByRole("listitem")[2]).toHaveTextContent("Running");

    await userEvent.click(within(actions).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(fetch.calls("POST", AUDITS_API.cancel(runningAudit.id))).toHaveLength(1));
    expect(await screen.findByText("Cancelled", { selector: ".zui-audit-status" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("explains a missing Apify token and retries the failed audit", async () => {
    const retried: ProspectAudit = { ...failedAudit, status: "running", error: undefined, steps: failedAudit.steps.map((s) => ({ id: s.id, status: "pending" })) };
    const fetch = open(failedAudit, { [`POST ${AUDITS_API.retry(failedAudit.id)}`]: { audit: retried } });
    await screen.findByRole("heading", { name: "Desert Bloom" });
    const hint = screen.getByRole("note");
    expect(hint).toHaveTextContent("Apify is not connected. Add APIFY_TOKEN to ~/.hermes/.env, restart Zain HQ, then retry the audit.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch.calls("POST", AUDITS_API.retry(failedAudit.id))).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows other errors plainly, and a retry failure", async () => {
    const broken: ProspectAudit = { ...failedAudit, error: "PDF renderer crashed", steps: [{ id: "pdf", status: "failed", note: "Chromium exited" }] };
    open(broken, { [`POST ${AUDITS_API.retry(broken.id)}`]: () => new Response(JSON.stringify({ error: "Audit is already running" }), { status: 409 }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF renderer crashed");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Audit is already running")).toBeInTheDocument();
  });

  it("goes back to the list", async () => {
    open(doneAudit);
    await userEvent.click(await screen.findByRole("button", { name: "‹ All audits" }));
    expect(useUiStore.getState().panel).toEqual({ kind: "audits" });
  });
});
