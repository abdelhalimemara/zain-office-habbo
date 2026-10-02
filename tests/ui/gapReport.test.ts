import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@shared/audits";
import {
  auditKpis,
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
  });
});
