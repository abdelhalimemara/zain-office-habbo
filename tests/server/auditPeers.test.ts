import { describe, expect, it } from "vitest";
import { AUDIT_STEPS, type AuditProspect, type ProspectAudit, type SearchRun } from "../../shared/audits";
import { draftAnalysis } from "../../server/src/growth/audit/analysis";
import { buildBenchmark, publicView } from "../../server/src/growth/audit/benchmark";
import { categoryTerms, finalPeers, isRelevant, saudiPeer, screenCandidates, type Candidate } from "../../server/src/growth/audit/collect/peers";
import { brandRun } from "../../server/src/growth/audit/collect/search";
import { scoreAudit } from "../../server/src/growth/audit/score";
import { renderReport } from "../../server/src/growth/audit/template/render";
import type { CollectedData, TrafficRead } from "../../server/src/growth/audit/types";

const paw: AuditProspect = { name: "The Paw Concept", website: "https://thepawconcept.co/", city: "RIYADH" };
const visits = (n: number, saudiShare?: number): TrafficRead => ({ monthlyVisits: n, period: "Aug 2026", ...(saudiShare !== undefined ? { saudiShare } : {}) });
const run = (query: string, kind: SearchRun["kind"], prospectPresent: boolean): SearchRun => ({ query, kind, prospectPresent, others: [] });

describe("competitor rules (Saudi peers only)", () => {
  it("takes the category vocabulary from the category searches, without cities and filler", () => {
    const runs = [run('"The Paw Concept"', "brand", true), run("cat food Riyadh", "category", false), run("أفضل مستلزمات الحيوانات في الرياض", "category", false)];
    expect(categoryTerms(runs)).toEqual(["cat food", "مستلزمات الحيوانات"]);
  });

  it("needs a whole category phrase, or two category words, on the home page", () => {
    const terms = ["cat food", "cat bag", "dog beds"];
    expect(isRelevant("Premium cat food and treats delivered in Riyadh", terms)).toBe(true);
    expect(isRelevant("Beds for dogs and cats", terms)).toBe(true); // "beds" + "cats"
    expect(isRelevant("Caterpillar boots and work bags", terms)).toBe(false); // "cat" is not in "caterpillar", one word is not enough
    expect(isRelevant("مستلزمات الحيوانات الأليفة", ["مستلزمات الحيوانات"])).toBe(true);
    expect(isRelevant("anything", [])).toBe(true);
  });

  it("drops non-businesses and off-topic pages, and puts .sa and Arabic storefronts first", () => {
    const c = (domain: string, extra: Partial<Candidate> = {}): Candidate => ({ domain, name: domain, relevant: true, business: true, ...extra });
    expect(
      screenCandidates([c("blog.com", { business: false }), c("shoes.com", { relevant: false }), c("global.com"), c("arabic.com", { arabic: true }), c("local.sa")]).map((x) => x.domain),
    ).toEqual(["local.sa", "arabic.com", "global.com"]);
  });

  it("keeps Saudi peers of the prospect's size, at most three, and never pads", () => {
    const traffic = {
      "thepawconcept.co": visits(2042, 0.73),
      "royalcanin.com": visits(4_247_868, 0.02), // global manufacturer
      "bigmall.com": visits(200_000, 0.8), // Saudi audience, but 98x the prospect and not a local storefront
      "pethouseksa.com": visits(3071, 0.9),
      "petzone.sa": visits(91_980, 0.6), // big, but a .sa local retailer
    };
    const candidates: Candidate[] = ["royalcanin.com", "bigmall.com", "pethouseksa.com", "petzone.sa", "unknown.com"].map((domain) => ({ domain, name: domain }));
    expect(finalPeers(candidates, traffic, "thepawconcept.co").map((c) => c.domain)).toEqual(["pethouseksa.com", "petzone.sa"]);
    expect(saudiPeer({ domain: "x.com", name: "x", arabic: true })).toBe(true);
    expect(saudiPeer({ domain: "x.com", name: "x" }, visits(10, 0.49))).toBe(false);
  });

  it("shows only vetted peers, and the summary never quotes a dropped one", () => {
    const data: CollectedData = {
      asOf: "3 Oct 2026",
      competitors: [{ domain: "pethouseksa.com", name: "Pet House" }],
      ads: { google: { "thepawconcept.co": "none" }, meta: {}, traffic: { "thepawconcept.co": visits(2042), "pethouseksa.com": visits(3071) } },
    };
    expect(buildBenchmark(paw, data).map((b) => b.domain)).toEqual(["thepawconcept.co", "pethouseksa.com"]);
    // Before the ads step has vetted them, candidates never appear.
    expect(buildBenchmark(paw, { competitors: [{ domain: "royalcanin.com", name: "Royal Canin" }] })).toHaveLength(1);
    const audit = { id: "a", prospect: paw, status: "running", steps: [], requestedBy: "hq", createdAt: 1, updatedAt: 1 } as ProspectAudit;
    const unvetted = draftAnalysis(audit, scoreAudit({ competitors: [{ domain: "royalcanin.com", name: "Royal Canin" }] }, paw), { competitors: [{ domain: "royalcanin.com", name: "Royal Canin" }] });
    expect(JSON.stringify(unvetted)).not.toContain("Royal Canin");
  });
});

describe("brand search", () => {
  it("counts the brand as present when either brand search finds it", () => {
    expect(brandRun([run('"X"', "brand", false), run("X Riyadh", "brand", true)])?.prospectPresent).toBe(true);
    expect(brandRun([run('"X"', "brand", false), run("X Riyadh", "brand", false)])?.prospectPresent).toBe(false);
  });

  it("rates Brand and Local Presence weak only when both brand searches fail", () => {
    const maps = { title: "The Paw Concept", rating: 5, reviews: 8 };
    const area = (runs: SearchRun[]) =>
      scoreAudit({ search: { runs }, ads: { google: {}, meta: {}, traffic: {}, maps } }, paw).areas.find((a) => a.area === "brand")!;
    expect(area([run('"The Paw Concept"', "brand", false), run("The Paw Concept Riyadh", "brand", true)]).status).toBe("strong");
    const both = area([run('"The Paw Concept"', "brand", false), run("The Paw Concept Riyadh", "brand", false)]);
    expect(both.status).toBe("weak");
    expect(both.summary).toContain("does not return the official site");
  });
});

describe("ad rows", () => {
  it("shows no formats or start date with a count of 0", () => {
    const data: CollectedData = {
      asOf: "3 Oct 2026",
      competitors: [{ domain: "pethouseksa.com", name: "Pet House" }],
      ads: {
        google: {
          "thepawconcept.co": { active: 0, total: 20, formats: ["image", "text", "video"], since: "2025-03-20", lastSeen: "2026-06-01" },
          "pethouseksa.com": { active: 4, total: 4, formats: ["text"], since: "2025-02-04" },
        },
        meta: {},
        traffic: {},
      },
    };
    const rows = buildBenchmark(paw, data);
    expect(rows[0]!.googleAds).toEqual({ active: 0 });
    const audit: ProspectAudit = { id: "aud_1", prospect: paw, status: "running", steps: AUDIT_STEPS.map((id) => ({ id, status: "done" })), requestedBy: "hq", createdAt: 1_790_000_000, updatedAt: 1 };
    audit.score = scoreAudit(data, paw);
    Object.assign(audit, publicView(audit, data));
    const html = renderReport(audit, data, draftAnalysis(audit, audit.score, data), { logo: null });
    expect(html).toContain("None active (last seen 1 Jun 2026)");
    expect(html).not.toMatch(/0 active, image/);
    expect(html).toContain("4 active, text, since 4 Feb 2025");
    expect(audit.score.areas.find((a) => a.area === "performance")!.evidence.map((e) => e.text)).toContain("No active Google ads (20 older ads, last seen 1 Jun 2026)");
  });
});
