import { describe, expect, it } from "vitest";
import type { AuditScore } from "../../shared/audits";
import { fallbackAnalysis, parseAnalysis } from "../../server/src/growth/audit/analysis";
import { metaAdsInput, summarizeGoogleAds, summarizeMetaAds } from "../../server/src/growth/audit/collect/ads";
import { deriveQueries, summarizeSearch } from "../../server/src/growth/audit/collect/search";
import { cadence, cleanHandle, instagramStats, socialHandles, tiktokStats } from "../../server/src/growth/audit/collect/social";
import { socialLinksFrom, summarizeWebsite } from "../../server/src/growth/audit/collect/website";
import { gradeFor, scoreAds, scoreAudit, scoreSearch, scoreSocial, scoreTracking, scoreWebsite } from "../../server/src/growth/audit/score";
import type { CollectedData, WebsiteData } from "../../server/src/growth/audit/types";
import { isPrivateAddress, validateWebsite } from "../../server/src/growth/audit/url";
import { NOW_MS, publicResolver, sampleItems } from "./auditFakes";

const site = (): WebsiteData => summarizeWebsite("https://www.thestudio.sa/", sampleItems()["apify/web-scraper"]!);
const prospect = { name: "THE STUDIO", website: "https://www.thestudio.sa/", city: "RIYADH", category: "BEAUTY" };

describe("audit scoring", () => {
  it("grades on the documented bands", () => {
    expect([85, 84, 70, 69, 55, 54, 40, 39, 0].map(gradeFor)).toEqual(["A", "B", "B", "C", "C", "D", "D", "E", "E"]);
  });

  it("scores the website from the crawl, deterministically, with 2-4 drivers", () => {
    const w = site();
    expect(w).toMatchObject({ pages: 2, https: true, goodTitles: 1, oneH1: 1, avgWords: 420, images: 20, imagesNoAlt: 4, schemaTypes: ["BeautySalon"] });
    expect(w.socialLinks).toEqual({ instagram: "thestudio.sa", tiktok: "thestudio" });
    const a = scoreWebsite(w);
    expect(a).toEqual(scoreWebsite(site()));
    expect(a.score).toBe(98);
    expect(a.drivers.length).toBeGreaterThanOrEqual(2);
    expect(a.drivers.length).toBeLessThanOrEqual(4);
    const thin = scoreWebsite({ ...w, avgWords: 60, schemaTypes: [], https: false, goodMetas: 0 });
    expect(thin.score).toBeLessThan(60);
    expect(thin.drivers[0]).toMatch(/meta description|Thin content|HTTPS/);
  });

  it("scores search from page-one share, top-3 share and the brand search", () => {
    const s = scoreSearch({
      queries: [
        { query: "a", position: 2, topDomains: [], ads: 0 },
        { query: "b", topDomains: [], ads: 0 },
        { query: "brand", position: 1, topDomains: [], ads: 0 },
      ],
      competitors: [{ domain: "rival.sa", appearances: 1 }],
    });
    expect(s.score).toBe(Math.round(60 * 0.5 + 20 * 0.5 + 20));
    expect(s.drivers).toContain("rival.sa outranks them on 1 of 2 searches");
  });

  it("scores social against the category benchmark, cadence and engagement", () => {
    const strong = scoreSocial({ channels: [{ channel: "instagram", handle: "x", followers: 15_000, postsPerWeek: 4, engagementRate: 0.05 }] }, "BEAUTY");
    expect(strong.score).toBe(100);
    const none = scoreSocial({ channels: [{ channel: "x", handle: "x" }] });
    expect(none.score).toBe(0);
  });

  it("treats no ads as a low score framed as an opportunity", () => {
    const none = scoreAds({ meta: { activeAds: 0, platforms: [] }, google: { ads: 0, formats: [], recentlyShown: 0 } });
    expect(none.score).toBe(0);
    expect(none.drivers).toContain("No paid presence: a clear opportunity");
    expect(scoreAds({ meta: { activeAds: 8, oldestDays: 60, platforms: ["facebook"] }, google: { ads: 3, formats: ["text"], recentlyShown: 2 } }).score).toBe(100);
  });

  it("scores tracking from the tags found", () => {
    expect(scoreTracking({ metaPixel: true, gtm: true, ga4: true, tiktokPixel: true, snapPixel: true }).score).toBe(100);
    const t = scoreTracking({ metaPixel: false, gtm: true, ga4: false, tiktokPixel: false, snapPixel: false });
    expect(t.score).toBe(20);
    expect(t.drivers[0]).toBe("Missing: Meta pixel, GA4, TikTok pixel, Snap pixel");
  });

  it("weights sections 0.3/0.2/0.25/0.1/0.15 and shares out the weight of unmeasured ones", () => {
    const data: CollectedData = { website: site(), ads: { meta: { activeAds: 0, platforms: [] } } };
    const full = scoreAudit({ ...data, search: { queries: [{ query: "brand", position: 1, topDomains: [], ads: 0 }], competitors: [] }, social: { channels: [] } });
    expect(Object.values(full.sections).map((s) => s.weight)).toEqual([0.3, 0.2, 0.25, 0.1, 0.15]);
    const partial = scoreAudit(data);
    expect(partial.sections.search).toMatchObject({ weight: 0, drivers: ["Not measured in this audit", expect.any(String)] });
    expect(Object.values(partial.sections).reduce((n, s) => n + s.weight, 0)).toBeCloseTo(1, 2);
    const expected = Math.round((partial.sections.website.score * 0.3 + 0 * 0.1 + partial.sections.tracking.score * 0.15) / 0.55);
    expect(partial.overall).toBe(expected);
    expect(partial.grade).toBe(gradeFor(expected));
  });
});

describe("audit analysis parsing", () => {
  const score: AuditScore = scoreAudit({ website: site() });
  const audit = { id: "aud_1", prospect, status: "running" as const, steps: [], requestedBy: "hq" as const, createdAt: 1, updatedAt: 1 };

  it("reads the fenced JSON, coercing enums and dropping junk", () => {
    const text = [
      "Sure! Here you go:",
      "```json",
      JSON.stringify({
        executiveSummary: "Strong site, weak search.",
        findings: [{ section: "SEARCH", title: "Invisible", detail: "d", severity: "HIGH" }, { title: "" }, "nope"],
        opportunities: [{ title: "SEO", service: "Zain Growth · SEO & AI Search", impact: "huge", effort: "XL" }],
        competitors: [{ name: "Rival", domain: "rival.sa", note: "first" }],
        pitchAngle: "Lead with search.",
      }),
      "```",
    ].join("\n");
    expect(parseAnalysis(text)).toEqual({
      executiveSummary: "Strong site, weak search.",
      findings: [{ section: "search", title: "Invisible", detail: "d", severity: "high" }],
      opportunities: [{ title: "SEO", service: "Zain Growth · SEO & AI Search", impact: "medium", effort: "M" }],
      competitors: [{ name: "Rival", domain: "rival.sa", note: "first" }],
      pitchAngle: "Lead with search.",
    });
  });

  it("accepts bare JSON with trailing commas", () => {
    expect(parseAnalysis('{"executiveSummary":"x","findings":[],"opportunities":[{"title":"t",}],}')?.opportunities[0]?.title).toBe("t");
  });

  it("returns null for prose, broken JSON or an empty analysis", () => {
    expect(parseAnalysis("I could not do it.")).toBeNull();
    expect(parseAnalysis("```json\n{ executiveSummary: oops\n```")).toBeNull();
    expect(parseAnalysis('{"executiveSummary":"","findings":[]}')).toBeNull();
  });

  it("builds a fallback from the drivers so the PDF still renders", () => {
    const a = fallbackAnalysis(audit, score, { website: site() });
    expect(a.executiveSummary).toContain(`THE STUDIO scores ${score.overall}/100`);
    expect(a.findings.length).toBeGreaterThan(0);
    expect(a.opportunities.length).toBeGreaterThan(0);
    expect(a.pitchAngle).not.toBe("");
  });
});

describe("audit website validation (SSRF guard)", () => {
  it("normalizes public sites", async () => {
    expect(await validateWebsite("thestudio.sa", publicResolver)).toBe("https://thestudio.sa/");
    expect(await validateWebsite("http://www.thestudio.sa/ar#top", publicResolver)).toBe("http://www.thestudio.sa/ar");
  });

  it.each([
    ["ftp://thestudio.sa", "http or https"],
    ["javascript:alert(1)", "http or https"],
    ["file:///etc/passwd", "http or https"],
    ["https://user:pw@thestudio.sa", "credentials"],
    ["https://thestudio.sa:8080", "default port"],
    ["http://127.0.0.1", "IP address"],
    ["http://[::1]/", "IP address"],
    ["http://169.254.169.254/latest/meta-data", "IP address"],
    ["http://localhost:8787", "default port"],
    ["http://localhost", "public domain"],
    ["http://printer.local", "public domain"],
    ["http://intranet", "public domain"],
  ])("refuses %s", async (url, message) => {
    await expect(validateWebsite(url, publicResolver)).rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) });
  });

  it("refuses names that resolve to private addresses, or do not resolve", async () => {
    await expect(validateWebsite("rebind.example.com", async () => ["10.0.0.5"])).rejects.toMatchObject({ status: 400 });
    await expect(validateWebsite("rebind.example.com", async () => ["93.184.216.34", "::ffff:127.0.0.1"])).rejects.toMatchObject({ status: 400 });
    await expect(validateWebsite("nope.example.com", async () => Promise.reject(new Error("ENOTFOUND")))).rejects.toMatchObject({ status: 400 });
  });

  it("knows the private ranges", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "fd00::1", "fe80::1", "::1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("audit collectors", () => {
  it("derives 5-8 bilingual target searches with the brand last", () => {
    const q = deriveQueries(prospect, site());
    expect(q.length).toBeGreaterThanOrEqual(5);
    expect(q.length).toBeLessThanOrEqual(8);
    expect(q).toContain("beauty salon Riyadh");
    expect(q).toContain("صالون تجميل الرياض");
    expect(q.at(-1)).toBe("THE STUDIO");
  });

  it("finds the prospect's rank and the competitors outranking it", () => {
    const queries = ["beauty salon Riyadh", "صالون تجميل الرياض", "THE STUDIO"];
    const s = summarizeSearch(prospect.website, queries, sampleItems()["apify/google-search-scraper"]!);
    expect(s.queries.map((q) => q.position)).toEqual([3, undefined, 1]);
    expect(s.competitors).toEqual([{ domain: "rival.sa", appearances: 2 }]); // instagram.com is a platform, not a competitor
  });

  it("measures followers, posting cadence and engagement", () => {
    expect(cadence([NOW_MS - 86_400_000, NOW_MS - 40 * 86_400_000, undefined], NOW_MS)).toBe(0.2);
    const ig = instagramStats("thestudio.sa", sampleItems()["apify/instagram-profile-scraper"]!, NOW_MS);
    expect(ig).toMatchObject({ followers: 12_000, postsPerWeek: 1.4, engagementRate: 0.018 });
    const tt = tiktokStats("thestudio", sampleItems()["clockworks/tiktok-profile-scraper"]!, NOW_MS);
    expect(tt).toMatchObject({ followers: 800, postsPerWeek: 0.5, adsInFeed: 0 });
  });

  it("prefers CRM handles and falls back to links on the site", () => {
    expect(cleanHandle("@the.studio")).toBe("the.studio");
    expect(cleanHandle("https://www.instagram.com/the.studio/")).toBe("the.studio");
    expect(cleanHandle("not a handle!")).toBeNull();
    expect(socialHandles({ ...prospect, instagram: "crm_handle" }, site())).toMatchObject({ instagram: "crm_handle", tiktok: "thestudio" });
    expect(socialLinksFrom(["https://www.instagram.com/p/abc/", "https://facebook.com/sharer/x", "https://facebook.com/TheStudioSA"])).toEqual({
      facebook: "https://www.facebook.com/TheStudioSA",
    });
  });

  it("keeps only the prospect's ads from a Meta keyword search", () => {
    const { input, byKeyword } = metaAdsInput(prospect);
    expect(byKeyword).toBe(true);
    expect(String((input.startUrls as { url: string }[])[0]!.url)).toContain("country=SA");
    const meta = summarizeMetaAds(prospect, sampleItems()["apify/facebook-ads-scraper"]!, true, NOW_MS);
    expect(meta).toMatchObject({ activeAds: 1, oldestDays: 45, platforms: ["facebook", "instagram"], pageName: "THE STUDIO" });
    expect(metaAdsInput(prospect, { metaAdLibraryUrl: "https://www.facebook.com/ads/library/?id=1" }).byKeyword).toBe(false);
    const google = summarizeGoogleAds([{ creativeId: "1", format: "TEXT", shownForDays: 90, lastShown: new Date(NOW_MS - 86_400_000).toISOString() }], NOW_MS);
    expect(google).toEqual({ ads: 1, formats: ["text"], longestDays: 90, recentlyShown: 1 });
  });
});
