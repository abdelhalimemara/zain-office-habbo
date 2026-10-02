import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardSection, dashboardUpdated, fileDashboard, trimDashboard } from "../../server/src/board/memory/dashboard";

const NOW = new Date("2026-10-02T18:00:00+03:00");
const fresh = `Updated: 2026-10-02T15:00:00+03:00 · by coo

| Metric | Value | Δ3h | Δ24h |
|---|---|---|---|
| Active clients | 5 | — | ▲1 |
<!-- notes:start -->
- COO: pipeline steady.
<!-- notes:end -->

## Pipeline
${"| Opportunity | stage |\n".repeat(200)}`;

describe("company dashboard", () => {
  it("reads the Updated time from the header", () => {
    expect(dashboardUpdated(fresh)?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(dashboardUpdated("no header")).toBeNull();
  });

  it("keeps the headline and notes when it cuts to the budget, and drops the note markers", () => {
    const cut = trimDashboard(fresh, 400);
    expect(cut.length).toBeLessThanOrEqual(440);
    expect(cut).toContain("| Active clients | 5 | — | ▲1 |");
    expect(cut).toContain("- COO: pipeline steady.");
    expect(cut).not.toContain("notes:start");
    expect(cut).toContain("… (more in the full dashboard)");
  });

  it("flags stale numbers and filters lines", () => {
    expect(dashboardSection(fresh, 3000, NOW).join("\n")).not.toContain("out of date");
    const old = dashboardSection(fresh, 3000, new Date("2026-10-03T08:00:00+03:00")).join("\n");
    expect(old).toContain("may be out of date");
    const filtered = dashboardSection(fresh, 3000, NOW, (l) => !l.includes("Active clients")).join("\n");
    expect(filtered).not.toContain("Active clients");
    expect(dashboardSection(null, 3000, NOW)).toEqual([]);
  });

  it("reads the file, and nothing when it does not exist yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zain-dash-"));
    try {
      expect(await fileDashboard(join(dir, "missing.md"))()).toBeNull();
      await writeFile(join(dir, "d.md"), fresh);
      expect(await fileDashboard(join(dir, "d.md"))()).toContain("Active clients");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
