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

    const summary = section("Executive summary");
    expect(within(summary).getByText(/paid search is empty/)).toBeInTheDocument();
    expect(within(summary).getByText(/strong Instagram following/)).toBeInTheDocument();
    const tiles = Object.fromEntries(
      within(summary)
        .getAllByRole("term")
        .map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]),
    );
    expect(tiles).toEqual({ "Gaps identified": "4", "Rated critical": "1", "Areas measured": "5 of 7", "Est. monthly visits": "~2,042" });
    expect(within(summary).getByText("2 not measurable this pass")).toBeInTheDocument();
    expect(within(within(summary).getByRole("list", { name: "Key points" })).getAllByRole("listitem")).toHaveLength(3);
    expect(within(summary).getByText(/Bottom line: findable/)).toBeInTheDocument();
    expect(screen.getByText(/Open with the implant keyword gap/)).toBeInTheDocument();

    const rows = within(within(section("The seven areas, at a glance")).getByRole("list", { name: "Seven areas" })).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("strong")!.textContent)).toEqual([
      "Website and Infrastructure",
      "Brand and Local Presence",
      "Non-brand Search Demand",
      "Social and Content",
      "Performance Media and Measurement",
      "Conversion and CRM",
      "Reputation and Compliance",
    ]);
    expect(rows.map((r) => r.querySelectorAll(".zui-gap-pill")[0]!.textContent)).toEqual(["Fair", "Fair", "Weak", "Fair", "Weak", "Not measured", "Not measured"]);
    expect(within(rows[4]!).getByText("Critical")).toHaveClass("zui-gap-pill--critical");
    expect(rows[4]).toHaveTextContent("quoted (research_tech)");
    expect(rows[5]!.querySelectorAll(".zui-gap-pill")).toHaveLength(1);

    const bench = within(section("The competitive gap")).getByRole("table");
    const benchRows = within(bench).getAllByRole("row").slice(1);
    expect(benchRows[0]).toHaveClass("zui-gap-table__prospect");
    expect(benchRows[0]).toHaveTextContent("Nakheel Dental");
    expect(benchRows[0]).toHaveTextContent("12,040");
    expect(benchRows[1]).toHaveTextContent("20 active, text/image, since 13 Aug 2022");
    expect(benchRows[1]).toHaveTextContent("~10,628 (est.)");
    expect(benchRows[2]).toHaveTextContent("not measured");
    const benchHead = within(bench).getAllByRole("columnheader").map((h) => h.textContent);
    expect(benchHead.slice(-2)).toEqual(["Authority (est.)", "Organic traffic (est.)"]);
    expect(within(benchRows[0]!).getAllByRole("cell").slice(-2).map((c) => c.textContent)).toEqual(["18 (est.)", "~1,450 (est.)"]);
    expect(within(benchRows[2]!).getAllByRole("cell").slice(-2).map((c) => c.textContent)).toEqual(["not measured", "not measured"]);
    expect(within(section("The competitive gap")).getByText(/5x the traffic/)).toBeInTheDocument();

    const gaps = section("The gaps");
    const cards = within(within(gaps).getByRole("list", { name: "Gaps" })).getAllByRole("listitem");
    expect(cards.map((c) => c.querySelector("strong")!.textContent)).toEqual(["No measurement", "Thin service pages", "Outranked on implants", "Low engagement"]);
    expect(cards[0]).toHaveTextContent("Critical");
    expect(cards[0]).toHaveTextContent("Performance Media and Measurement · quoted (research_tech)");
    expect(within(gaps).getByText("Not measured this pass: Conversion and CRM, Reputation and Compliance.")).toBeInTheDocument();

    const fix = section("The fix");
    const phases = within(within(fix).getByRole("list", { name: "Fix phases" })).getAllByRole("listitem");
    expect(phases.map((p) => p.querySelector(".zui-gap-eyebrow")!.textContent)).toEqual(["Phase 1 · Foundation", "Phase 2 · Demand Capture", "Phase 3 · Demand Generation"]);
    expect(within(fix).getByText("Booked implant consultations per month.")).toBeInTheDocument();
    expect(within(fix).getByText("A 30-minute walkthrough with the clinic manager.")).toBeInTheDocument();

    const opps = within(section("Opportunities")).getAllByRole("listitem");
    expect(opps[0]).toHaveTextContent("Launch implant search campaign");
    expect(opps[0]).toHaveTextContent("Google Ads");
    expect(opps[0]).toHaveTextContent("high impact");
    expect(opps[0]).toHaveTextContent("Small effort");

    const steps = within(section("Pipeline")).getAllByRole("listitem");
    expect(steps).toHaveLength(9);
    expect(steps[0]).toHaveTextContent("Website crawl");
    expect(steps[0]).toHaveTextContent("$0.42");
    expect(steps[0]).toHaveTextContent("15s");
    expect(steps[3]).toHaveTextContent("Skipped");
    expect(steps[3]).toHaveTextContent("No ads in Meta Ad Library");
  });

  it("renders the Semrush SEO block with every figure labelled as an estimate", async () => {
    open(doneAudit);
    await screen.findByRole("heading", { name: "Nakheel Dental" });
    const seo = section("SEO (Semrush)");
    expect(within(seo).getByText("All figures are estimates. Source: Semrush via Apify, Sep 2026")).toBeInTheDocument();
    const tiles = Object.fromEntries(
      within(seo)
        .getAllByRole("term")
        .map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]),
    );
    expect(tiles).toEqual({
      "Authority score": "18/100 est.",
      "Organic keywords": "~312 est.",
      "Organic traffic / mo": "~1,450 est.",
      Backlinks: "~2,380 est.",
      "Referring domains": "~96 est.",
    });

    const keywords = within(seo).getByRole("table", { name: "Top keywords" });
    const kwRows = within(keywords).getAllByRole("row").slice(1);
    expect(kwRows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual(["nakheel dental", "dental clinic jeddah", "teeth whitening jeddah"]);
    expect(kwRows.map((r) => r.querySelector(".zui-seo-pos")!.className.includes("--top"))).toEqual([true, false, true]);
    expect(kwRows[1]).toHaveTextContent("#14");
    expect(kwRows[1]).toHaveTextContent("6,600");
    expect(kwRows[1]).toHaveTextContent("/en/clinics/jeddah-al-rawdah-branch?utm=1");
    expect(kwRows[2]).toHaveTextContent("—");

    const pages = within(within(seo).getByRole("region", { name: "Top pages" })).getAllByRole("listitem");
    expect(pages.map((p) => p.textContent)).toEqual(["/~980 est.", "/en/services/implants~210 est."]);

    const issues = within(within(seo).getByRole("region", { name: "Technical issues" })).getAllByRole("listitem");
    expect(issues.map((i) => i.querySelector(".zui-gap-pill")!.textContent)).toEqual(["Critical", "High", "Medium", "Medium"]);
    expect(issues[0]).toHaveTextContent("Broken internal links");
    expect(issues[2]).toHaveTextContent("Duplicate titles52");

    const comps = within(within(seo).getByRole("region", { name: "Organic competitors" })).getAllByRole("listitem");
    expect(comps[0]).toHaveTextContent("smilehub.sa140 shared keywords · AS 34");
    expect(comps[1]).toHaveTextContent("pearlclinic.saAS 21");
  });

  it("leaves the SEO block out when Semrush was not read", async () => {
    open({ ...doneAudit, seo: undefined });
    await screen.findByRole("heading", { name: "Nakheel Dental" });
    expect(screen.queryByRole("region", { name: "SEO (Semrush)" })).not.toBeInTheDocument();
  });

  it("shows the area table before the analyst has written up", async () => {
    open({ ...doneAudit, status: "running", analysis: undefined });
    await screen.findByRole("heading", { name: "Nakheel Dental" });
    expect(section("The seven areas, at a glance")).toBeInTheDocument();
    expect(section("The competitive gap")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "The gaps" })).not.toBeInTheDocument();
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
