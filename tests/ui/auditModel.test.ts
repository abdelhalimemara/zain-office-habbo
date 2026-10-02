import { describe, expect, it } from "vitest";
import {
  apifyMissing,
  AUDIT_POLL_ACTIVE_MS,
  AUDIT_POLL_IDLE_MS,
  auditCost,
  auditDate,
  auditsPollInterval,
  canCancel,
  canRetry,
  checkWebsite,
  domainOf,
  formatCost,
  formatDuration,
  groupFindings,
  isApifyMissing,
  orderedSteps,
  safeHref,
  stepsFinished,
  stepTooltip,
  websiteRequest,
} from "../../src/ui/auditModel";
import { doneAudit, failedAudit, runningAudit } from "./auditFixtures";

describe("checkWebsite", () => {
  it.each([
    ["example.com", "https://example.com", "example.com"],
    ["  https://www.Example.co.uk/  ", "https://www.example.co.uk", "example.co.uk"],
    ["http://shop.example.sa/ar?ref=1", "http://shop.example.sa/ar?ref=1", "shop.example.sa"],
  ])("accepts %s", (input, url, domain) => {
    expect(checkWebsite(input)).toEqual({ ok: true, url, domain });
  });

  it.each([
    ["", "Enter the prospect's website."],
    ["   ", "Enter the prospect's website."],
    ["kahwa house.com", "A website address has no spaces."],
    ["ftp://example.com", "Use an http or https address."],
    ["javascript:alert(1)", "Use an http or https address."],
    ["localhost", "Use a full domain, like example.com."],
    ["https://192.168.1.1", "Use a full domain, like example.com."],
    ["example", "Use a full domain, like example.com."],
    ["https://user:pw@example.com", "Leave out any user name or password."],
  ])("rejects %j", (input, error) => {
    expect(checkWebsite(input)).toEqual({ ok: false, error });
  });
});

describe("websiteRequest", () => {
  it("normalizes the site and keeps only the socials that were filled in", () => {
    expect(websiteRequest("acme.com", "  Acme ", { instagram: " @acme ", x: "  ", tiktok: "" })).toEqual({
      request: { website: "https://acme.com", name: "Acme", socials: { instagram: "@acme" } },
    });
    expect(websiteRequest("acme.com", "", {})).toEqual({ request: { website: "https://acme.com" } });
  });

  it("returns the validation error", () => {
    expect(websiteRequest("nope", "", {})).toEqual({ error: "Use a full domain, like example.com." });
  });
});

describe("steps and progress", () => {
  it("lists all nine steps in pipeline order, filling in missing ones as pending", () => {
    const steps = orderedSteps([{ id: "pdf", status: "done" }]);
    expect(steps.map((s) => s.id)).toEqual(["website", "search", "social", "ads", "score", "analysis", "pdf", "crm", "notion"]);
    expect(steps.filter((s) => s.status === "pending")).toHaveLength(8);
  });

  it("counts done and skipped steps as finished", () => {
    expect(stepsFinished(runningAudit.steps)).toBe(2);
    expect(stepsFinished(doneAudit.steps)).toBe(9);
  });

  it("builds a tooltip from the label, status and note", () => {
    expect(stepTooltip(runningAudit.steps[0]!)).toBe("Website crawl: Done. 38 pages crawled, 6 missing meta descriptions");
    expect(stepTooltip(runningAudit.steps[2]!)).toBe("Social profiles: Running");
  });

  it("polls fast while any audit is queued or running", () => {
    expect(auditsPollInterval([doneAudit, runningAudit])).toBe(AUDIT_POLL_ACTIVE_MS);
    expect(auditsPollInterval([{ status: "queued" }])).toBe(AUDIT_POLL_ACTIVE_MS);
    expect(auditsPollInterval([doneAudit, failedAudit])).toBe(AUDIT_POLL_IDLE_MS);
    expect(auditsPollInterval(undefined)).toBe(AUDIT_POLL_IDLE_MS);
  });
});

describe("formatting", () => {
  it("formats cost and duration", () => {
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(135)).toBe("2m 15s");
    expect(auditDate(Date.UTC(2026, 9, 2, 12) / 1000)).toBe("2 Oct 2026");
  });

  it("uses the server's total cost, else sums the steps", () => {
    expect(auditCost(doneAudit)).toBe(1.03);
    expect(auditCost(runningAudit)).toBeCloseTo(0.6);
    expect(auditCost(failedAudit)).toBeUndefined();
  });

  it("reads the bare domain", () => {
    expect(domainOf("https://www.kahwahouse.sa/menu")).toBe("kahwahouse.sa");
    expect(domainOf("nakheeldental.com")).toBe("nakheeldental.com");
  });

  it("only turns http(s) URLs into links", () => {
    expect(safeHref("https://notion.so/x")).toBe("https://notion.so/x");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe("audit state", () => {
  it("detects a missing Apify token from step notes or the error", () => {
    expect(isApifyMissing("Apify is not connected")).toBe(true);
    expect(isApifyMissing("Set APIFY_TOKEN first")).toBe(true);
    expect(isApifyMissing("Apify run timed out")).toBe(false);
    expect(apifyMissing(failedAudit)).toBe(true);
    expect(apifyMissing(doneAudit)).toBe(false);
  });

  it("offers retry after failure or cancel and cancel while working", () => {
    expect([canRetry(failedAudit), canRetry({ status: "cancelled" }), canRetry(doneAudit), canRetry(runningAudit)]).toEqual([true, true, false, false]);
    expect([canCancel(runningAudit), canCancel({ status: "queued" }), canCancel(doneAudit), canCancel(failedAudit)]).toEqual([true, true, false, false]);
  });

  it("groups findings by section in section order, most severe first", () => {
    const groups = groupFindings(doneAudit.analysis!.findings);
    expect(groups.map((g) => g.section)).toEqual(["website", "search", "tracking"]);
    expect(groups[0]!.findings.map((f) => f.severity)).toEqual(["high", "medium"]);
  });
});
