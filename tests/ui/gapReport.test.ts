import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@shared/audits";
import {
  auditKpis,
  authorityCell,
  estimate,
  organicCell,
  sortIssues,
  groupIssues,
  formatRate,
  screenshotSrc,
  urlPath,
  benchmarkRows,
  evidenceLine,
  followersCell,
  googleAdsCell,
  metaAdsCell,
  notMeasuredAreas,
  orderedAreas,
  sortFindings,
  visitsCell,
} from "../../src/ui/gapReport";
import { doneAudit } from "./auditFixtures";

const score = doneAudit.score!;

describe("gap report", () => {
  it("lists the seven areas in template order, filling a missing one as not measured", () => {
    const areas = orderedAreas(score.areas.filter((a) => a.area !== "brand"));
    expect(areas.map((a) => a.area)).toEqual(["website", "brand", "search", "social", "performance", "conversion", "reputation"]);
    expect(areas[1]).toMatchObject({ area: "brand", status: "not-measured" });
    expect(notMeasuredAreas(score.areas)).toEqual(["conversion", "reputation"]);
  });

  it("writes the evidence line of an area", () => {
    expect(evidenceLine(score.areas[1]!)).toBe("quoted (search) / not measured (Maps, tool timeout)");
  });

  it("orders findings by severity, keeping the analyst's order within one", () => {
    const f = (title: string, severity: AuditFinding["severity"]): AuditFinding => ({ area: "website", title, detail: "", severity });
    expect(sortFindings([f("a", "low"), f("b", "high"), f("c", "critical"), f("d", "high")]).map((x) => x.title)).toEqual(["c", "b", "d", "a"]);
  });

  it("computes the four tiles from the findings, areas and the prospect's traffic", () => {
    expect(auditKpis(doneAudit)).toEqual({ gaps: 4, critical: 1, measured: 5, total: 7, visits: { value: 2042, period: "Aug 2026" } });
    expect(auditKpis({ ...doneAudit, analysis: undefined, benchmark: undefined })).toEqual({ gaps: 5, critical: 1, measured: 5, total: 7 });
    expect(auditKpis({ ...doneAudit, score: undefined })).toBeNull();
  });

  it("puts the prospect first in the benchmark and formats each cell", () => {
    expect(benchmarkRows(doneAudit.benchmark!).map((r) => r.name)).toEqual(["Nakheel Dental", "Smile Hub", "Pearl Clinic"]);
    expect(googleAdsCell({ active: 20, formats: "text/image", since: "13 Aug 2022" })).toBe("20 active, text/image, since 13 Aug 2022");
    expect(googleAdsCell("none")).toBe("None found");
    expect(googleAdsCell(undefined)).toBe("not measured");
    expect(metaAdsCell({ active: 1, note: "confirmed" })).toBe("1 active (confirmed)");
    expect(metaAdsCell("none")).toBe("None attributable");
    expect(followersCell(12040)).toBe("12,040");
    expect(followersCell("not-measured")).toBe("not measured");
    expect(visitsCell({ monthlyVisits: 10628, period: "Aug 2026" })).toBe("~10,628 (est.)");
    expect(authorityCell(33.6)).toBe("34 (est.)");
    expect(authorityCell(undefined)).toBe("not measured");
    expect(organicCell(8700)).toBe("~8,700 (est.)");
  });

  it("formats SEO estimates, issue order and page paths", () => {
    expect(estimate(2380)).toBe("~2,380");
    expect(estimate(undefined)).toBe("—");
    const order = sortIssues([
      { title: "a", severity: "low" as const, count: 9 },
      { title: "b", severity: "medium" as const, count: 1 },
      { title: "c", severity: "medium" as const, count: 40 },
      { title: "d", severity: "critical" as const },
    ]).map((i) => i.title);
    expect(order).toEqual(["d", "c", "b", "a"]);
    expect(urlPath("https://x.com/a/b?q=1")).toBe("/a/b?q=1");
    expect(urlPath("x.com")).toBe("/");
  });

  it("groups issues by severity and formats rates and capture paths", () => {
    const groups = groupIssues(doneAudit.seo!.issues);
    expect(groups.map((g) => [g.severity, g.issues.map((i) => i.title)])).toEqual([
      ["critical", ["Broken internal links"]],
      ["high", ["Slow pages"]],
      ["medium", ["Duplicate titles", "Missing meta descriptions"]],
    ]);
    expect(formatRate(0.0017)).toBe("0.17%");
    expect(formatRate(0.125)).toBe("12.5%");
    expect(formatRate(undefined)).toBe("—");
    expect(screenshotSrc("/api/growth/audits/a/screenshot")).toBe("/api/growth/audits/a/screenshot");
    expect(screenshotSrc("//evil.example/x.png")).toBeUndefined();
    expect(screenshotSrc("javascript:alert(1)")).toBeUndefined();
  });
});
