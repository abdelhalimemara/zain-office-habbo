import { describe, expect, it } from "vitest";
import type { AuditProspect, ProspectAudit } from "../../shared/audits";
import { draftAnalysis, parseAnalysis } from "../../server/src/growth/audit/analysis";
import { buildBenchmark, nameFromDomain } from "../../server/src/growth/audit/benchmark";
import { attributeMeta, mapsRead, metaUrl, summarizeGoogleAds, trafficRead } from "../../server/src/growth/audit/collect/ads";
import { deriveQueries, pickCompetitors, summarizeSearch } from "../../server/src/growth/audit/collect/search";
import { auditIssues, seoRead } from "../../server/src/growth/audit/collect/seo";
import { cleanHandle, collectSocial, instagramRow, postsInWindow, socialHandles, tiktokRow } from "../../server/src/growth/audit/collect/social";
import { Budget } from "../../server/src/growth/audit/budget";
import { socialLinksFrom, summarizeHome, summarizeWebsite, tagRead } from "../../server/src/growth/audit/collect/website";
import { gradeFor, scoreAudit, statusFor } from "../../server/src/growth/audit/score";
import type { CollectedData } from "../../server/src/growth/audit/types";
import { isPrivateAddress, validateWebsite } from "../../server/src/growth/audit/url";
import { NOW_MS, fakeApify, page, publicResolver, sampleActors } from "./auditFakes";

const prospect: AuditProspect = { name: "THE STUDIO", website: "https://www.thestudio.sa/", city: "RIYADH", category: "BEAUTY", instagram: "thestudio.sa" };
const items = (actor: string, input: Record<string, unknown> = {}) => {
  const a = sampleActors()[actor]!;
  return typeof a === "function" ? a(input) : a;
};
const site = () => summarizeWebsite(prospect.website, [page("https://www.thestudio.sa/"), page("https://www.thestudio.sa/services", { lang: "en", arabicChars: 0, latinChars: 800 })]);

/** A fully collected audit, as the pipeline would hold it after the four scraping steps. */
function collected(): CollectedData {
  const queries = deriveQueries(prospect, site());
  const search = summarizeSearch(prospect, queries, items("apify/google-search-scraper", { queries: queries.map((q) => q.query).join("\n") }));
  const competitors = pickCompetitors(prospect, search).map((domain) => ({ domain, name: nameFromDomain(domain) }));
  const domains = ["thestudio.sa", ...competitors.map((c) => c.domain)];
  return {
    asOf: "2 Oct 2026",
    website: site(),
    search,
    competitors,
    seo: { read: seoRead(items("pro100chok/semrush-scraper", { domains })[0], undefined, "2 Oct 2026"), competitors: { "rival.sa": { authorityScore: 25, organicTraffic: 4200 } } },
    social: { rows: [instagramRow(items("apify/instagram-profile-scraper", { usernames: ["thestudio.sa"] })[0], NOW_MS)], competitorInstagram: { "rival.sa": 5400 } },
    ads: {
      google: { "thestudio.sa": { active: 2, total: 2, formats: ["image"], since: "2026-06-19" }, "rival.sa": "none" },
      meta: { "thestudio.sa": "none", "rival.sa": { active: 1 } },
      traffic: Object.fromEntries(domains.map((d, i) => [d, { monthlyVisits: [2042, 10628, 3747][i] ?? 1, period: "Aug 2026" }])),
      maps: { title: "THE STUDIO", rating: 4.8, reviews: 651 },
    },
  };
}

describe("seven-area scoring", () => {
  it("grades and rates on the documented bands", () => {
    expect([85, 84, 70, 69, 55, 54, 40, 39, 0].map(gradeFor)).toEqual(["A", "B", "B", "C", "C", "D", "D", "E", "E"]);
    expect([75, 74, 45, 44].map(statusFor)).toEqual(["strong", "fair", "fair", "weak"]);
  });

  it("scores all seven areas deterministically, with evidence labelled by kind and source", () => {
    const s = scoreAudit(collected(), prospect);
    expect(s).toEqual(scoreAudit(collected(), prospect));
    expect(s.areas.map((a) => a.area)).toEqual(["website", "brand", "search", "social", "performance", "conversion", "reputation"]);
    expect(s.areasMeasured).toBe(6);
    expect(s.areas.reduce((n, a) => n + a.weight, 0)).toBeCloseTo(1, 2);
    const conversion = s.areas.find((a) => a.area === "conversion")!;
    expect(conversion).toMatchObject({ status: "not-measured", weight: 0, summary: "Checkout flow, forms and CRM connection are not visible from public pages." });
    expect(conversion.evidence.map((e) => e.kind)).toEqual(["not-measured", "quoted"]);
    for (const a of s.areas) {
      expect(a.summary).not.toBe("");
      for (const e of a.evidence) expect(e.source).not.toBe("");
    }
    const search = s.areas.find((a) => a.area === "search")!;
    expect(search.evidence.some((e) => e.kind === "estimated" && e.source === "Semrush via Apify, 2 Oct 2026")).toBe(true);
    expect(s.areas.find((a) => a.area === "reputation")).toMatchObject({ status: "strong", summary: expect.stringContaining("4.8 stars from 651 reviews") });
  });

  it("rates performance critical when ads run without GA4 or GTM", () => {
    const perf = scoreAudit(collected(), prospect).areas.find((a) => a.area === "performance")!;
    expect(perf.severity).toBe("critical");
    expect(perf.summary).toBe("2 active Google ads, but neither GA4 nor GTM is on the page.");
    const tagged = collected();
    tagged.website!.trackers.ga4 = true;
    expect(scoreAudit(tagged, prospect).areas.find((a) => a.area === "performance")!.severity).not.toBe("critical");
  });

  it("counts an unmeasured area as coverage, not zero", () => {
    const data = collected();
    delete data.ads;
    const s = scoreAudit(data, prospect);
    expect(s.areas.find((a) => a.area === "reputation")).toMatchObject({ status: "not-measured", weight: 0 });
    expect(s.areas.find((a) => a.area === "reputation")!.score).toBeUndefined();
    const measured = s.areas.filter((a) => a.status !== "not-measured");
    const expected = Math.round(measured.reduce((n, a) => n + a.score! * a.weight, 0));
    expect(Math.abs(s.overall - expected)).toBeLessThanOrEqual(1);
  });
});

describe("audit analysis", () => {
  const data = collected();
  const score = scoreAudit(data, prospect);
  const audit = { id: "aud_1", prospect, status: "running", steps: [], requestedBy: "hq", createdAt: 1, updatedAt: 1, benchmark: buildBenchmark(prospect, data) } as ProspectAudit;
  const draft = draftAnalysis(audit, score, data);

  it("drafts every template slot from the data", () => {
    expect(draft.coverLine).toContain("thestudio.sa");
    expect(draft.coverLine).toContain("Built from public data only.");
    expect(draft.keyPoints).toHaveLength(3);
    expect(Object.keys(draft.bottomLines)).toEqual(["summary", "search", "paid", "social", "traffic", "competitive", "close"]);
    expect(draft.findings[0]!.severity).toBe("critical");
    expect(draft.findings.map((f) => f.severity)).toEqual([...draft.findings.map((f) => f.severity)].sort((a, b) => ["critical", "high", "medium", "low"].indexOf(a) - ["critical", "high", "medium", "low"].indexOf(b)));
    expect(draft.fix.map((f) => f.name)).toEqual(["Foundation", "Demand Capture", "Demand Generation"]);
    expect(draft.fix[0]!.detail).toContain("GA4");
    expect(draft.closingSteps).toHaveLength(3);
  });

  it("merges the agent's JSON over the draft and coerces its enums", () => {
    const text = ["Sure:", "```json", JSON.stringify({ executiveSummary: "Agent summary.", findings: [{ area: "SEARCH", title: "Invisible", detail: "d", severity: "CRITICAL" }, { title: "" }], fix: [{ headline: "only one" }], bottomLines: { search: "Agent line." } }), "```"].join("\n");
    const a = parseAnalysis(text, draft)!;
    expect(a.executiveSummary).toBe("Agent summary.");
    expect(a.findings).toEqual([{ area: "search", title: "Invisible", detail: "d", severity: "critical", evidence: "quoted" }]);
    expect(a.fix).toEqual(draft.fix); // an incomplete fix keeps the draft's three phases
    expect(a.bottomLines.search).toBe("Agent line.");
    expect(a.bottomLines.paid).toBe(draft.bottomLines.paid);
    expect(a.coverLine).toBe(draft.coverLine);
  });

  it("accepts bare JSON with trailing commas, and refuses prose or broken JSON", () => {
    expect(parseAnalysis('{"executiveSummary":"A long enough summary","findings":[],}', draft)?.executiveSummary).toBe("A long enough summary");
    expect(parseAnalysis("I could not do it.", draft)).toBeNull();
    expect(parseAnalysis("```json\n{ executiveSummary: oops\n```", draft)).toBeNull();
  });
});

describe("benchmark", () => {
  it("puts the prospect first and marks what was not measured", () => {
    const rows = buildBenchmark(prospect, collected());
    expect(rows[0]).toMatchObject({ name: "THE STUDIO", isProspect: true, googleAds: { active: 2, formats: "image", since: "19 Jun 2026" }, metaAds: "none", instagramFollowers: 12_000, authorityScore: 12 });
    expect(rows[1]).toMatchObject({ name: "Rival", domain: "rival.sa", googleAds: "none", metaAds: { active: 1 }, instagramFollowers: 5400, authorityScore: 25, organicTraffic: 4200 });
    expect(rows[2]).toMatchObject({ domain: "glow.sa", googleAds: "not-measured", metaAds: "not-measured", instagramFollowers: "not-measured" });
    expect(nameFromDomain("pets-houses.com")).toBe("Pets Houses");
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
  it("reads the site: tags in the template's order, platform, policies, contact paths", () => {
    const w = site();
    expect(w).toMatchObject({ pages: 2, platform: "Salla", policyPages: ["Privacy policy", "Returns"], contactPaths: ["WhatsApp", "phone"], reviewsOnSite: true });
    expect(tagRead(w.trackers).slice(0, 4)).toEqual([
      { tag: "Google Ads conversion tag", found: true },
      { tag: "GA4", found: false },
      { tag: "Google Tag Manager", found: false },
      { tag: "Meta Pixel", found: true },
    ]);
    expect(socialLinksFrom(["https://www.youtube.com/@thestudio", "https://www.snapchat.com/add/thestudio", "https://facebook.com/sharer/x"])).toEqual({
      youtube: "https://www.youtube.com/@thestudio",
      snapchat: "thestudio",
    });
    expect(summarizeHome({ siteName: "", title: "Glow Lounge | Riyadh", socialLinks: ["https://instagram.com/glow"] })).toEqual({ name: "Glow Lounge", instagram: "glow", business: false });
    expect(summarizeHome({ title: "Pet House", platform: "Salla" }).business).toBe(true);
  });

  it("runs the brand search first and picks competitors from the category searches", () => {
    const q = deriveQueries(prospect, site());
    expect(q[0]).toEqual({ query: '"THE STUDIO"', kind: "brand" });
    expect(q.filter((x) => x.kind === "category").map((x) => x.query)).toContain("صالون تجميل الرياض");
    const s = summarizeSearch(prospect, q, items("apify/google-search-scraper", { queries: q.map((x) => x.query).join("\n") }));
    expect(s.runs[0]).toMatchObject({ prospectPresent: true, others: [] }); // instagram.com is the brand's own profile here
    expect(s.runs.find((r) => r.query === "beauty salon Riyadh")).toMatchObject({ prospectPresent: true, others: ["rival.sa", "glow.sa", "instagram.com"] });
    expect(pickCompetitors(prospect, s, ["glam.sa", "petstock.co.nz"])).toEqual(["rival.sa", "glow.sa", "glam.sa"]);
  });

  it("without a CRM category, searches what Semrush says the site ranks for, never UI text or the brand", () => {
    const shop = { ...site(), headings: ["Cart 0 items", "Peak nutrition", "Luxury dog beds", "Sign in"] };
    const paw = { name: "The Paw Concept", website: "https://thepawconcept.co/" };
    expect(deriveQueries(paw, shop, ["cat food", "the paw concept", "قضيب القط"]).map((x) => x.query)).toEqual(['"The Paw Concept"', "cat food Riyadh", "قضيب القط الرياض"]);
    expect(deriveQueries(paw, shop, ["cat food"]).map((x) => x.query)).toEqual(['"The Paw Concept"', "cat food Riyadh", "Peak nutrition Riyadh", "Luxury dog beds Riyadh"]);
  });

  it("keeps foreign and platform sites out of the competitors, and prefers Saudi domains", () => {
    const runs = [{ query: "cat food Riyadh", kind: "category" as const, prospectPresent: false, others: ["flipkart.com", "petvo.in", "petzone.com", "pets.sa", "daraz.pk"] }];
    expect(pickCompetitors(prospect, { runs })).toEqual(["pets.sa", "petzone.com"]);
  });

  it("maps Semrush into the SEO read, with technical issues from the home-page audit", () => {
    const read = seoRead(items("pro100chok/semrush-scraper", { domains: ["thestudio.sa"] })[0], undefined, "2 Oct 2026");
    expect(read).toMatchObject({ source: "Semrush via Apify, 2 Oct 2026", authorityScore: 12, organicTraffic: 40, organicKeywords: 80, backlinks: 600, referringDomains: 120 });
    expect(read.topKeywords[0]).toEqual({ keyword: "صالون تجميل", position: 14, volume: 9900, url: "https://thestudio.sa/" });
    expect(read.topPages[0]).toEqual({ url: "https://thestudio.sa/", traffic: 30 });
    expect(read.competitors[0]).toEqual({ domain: "rival.sa", commonKeywords: 31 });
    expect(auditIssues({ h1_count: 0, has_sitemap: false, has_robots_txt: true, images_missing_alt: 21, title_length: 15, meta_description_length: 120, canonical: "x" })).toEqual([
      { title: "No XML sitemap", severity: "high" },
      { title: "Home page has no H1 heading", severity: "high" },
      { title: "Images missing alt text on the home page", severity: "medium", count: 21 },
      { title: "Home page title is 15 characters (aim for 30-60)", severity: "low" },
    ]);
  });

  it("measures social rows: followers, posts in 30 days, engagement, last post", () => {
    expect(postsInWindow([NOW_MS - 86_400_000, NOW_MS - 40 * 86_400_000, undefined], NOW_MS)).toBe(1);
    const ig = instagramRow(items("apify/instagram-profile-scraper", { usernames: ["thestudio.sa"] })[0], NOW_MS);
    expect(ig).toMatchObject({ channel: "instagram", followers: 12_000, posts: 300, postsPer30Days: 6, engagement: 0.018, measured: true });
    expect(tiktokRow(items("clockworks/tiktok-profile-scraper"), NOW_MS)).toMatchObject({ followers: 800, posts: 40, postsPer30Days: 2, measured: true });
    expect(instagramRow({ private: true }, NOW_MS)).toEqual({ channel: "instagram", measured: false });
    expect(cleanHandle("https://www.instagram.com/the.studio/")).toBe("the.studio");
    expect(socialHandles({ ...prospect, instagram: "crm_handle" }, site())).toMatchObject({ instagram: "crm_handle", tiktok: "thestudio" });
  });

  it("keeps the three candidates whose home pages read as businesses", async () => {
    const homes = [
      page("https://expat.com/", { siteName: "Expat.com", platform: "", policyLinks: [], contact: {}, jsonLd: ["Article"], socialLinks: [] }),
      page("https://pethouse.com/", { siteName: "Pet House", platform: "Salla", socialLinks: [] }),
      page("https://cats.com/", { siteName: "Cats", platform: "", policyLinks: [], contact: {}, jsonLd: [], socialLinks: [] }),
      page("https://petzone.com/", { siteName: "Petzone", platform: "Shopify", socialLinks: [] }),
    ];
    const apify = fakeApify({ actors: { ...sampleActors(), "apify/playwright-scraper": homes } });
    const candidates = ["expat.com", "pethouse.com", "cats.com", "petzone.com", "pets.sa"].map((domain) => ({ domain, name: domain }));
    const r = await collectSocial("a1", prospect, site(), candidates, new Budget(apify.runner), NOW_MS);
    expect(r.competitors?.map((c) => c.domain)).toEqual(["pethouse.com", "petzone.com", "pets.sa"]);
    expect(r.competitors?.[0]?.name).toBe("Pet House");
  });

  it("attributes Meta ads only to the business's own page", () => {
    const b = { domain: "thestudio.sa", name: "THE STUDIO" };
    const { url, byKeyword } = metaUrl(b);
    expect(byKeyword).toBe(true);
    expect(url).toContain("search_type=keyword_exact_phrase");
    expect(attributeMeta(b, items("apify/facebook-ads-scraper", { startUrls: [{ url }] }), true)).toEqual({ active: 1, pageName: "THE STUDIO" });
    expect(attributeMeta(b, [{ pageName: "Joyreels", isActive: true }], true)).toBe("none");
    expect(metaUrl(b, { metaAdLibraryUrl: "https://www.facebook.com/ads/library/?id=1" }).byKeyword).toBe(false);
  });

  it("reads Google Ads, Similarweb and Maps", () => {
    const g = summarizeGoogleAds(items("scrapesage/google-ads-transparency-scraper", { domains: ["thestudio.sa"] }), NOW_MS);
    expect(g).toMatchObject({ active: 2, total: 2, formats: ["image", "text"], advertiser: "Studio Trading Co" });
    expect(summarizeGoogleAds([], NOW_MS)).toBe("none");
    expect(trafficRead(items("pro100chok/similarweb-scraper", { domains: ["thestudio.sa"] })[0]!)).toEqual({
      monthlyVisits: 2042,
      bounceRate: 0.352,
      topSource: "Organic search (37.7%, est.)",
      saudiShare: 0.726,
      period: "Aug 2026",
      organicShare: 0.3767,
      paidShare: 0.0894,
    });
    expect(mapsRead(prospect, items("compass/crawler-google-places"))).toMatchObject({ rating: 4.8, reviews: 651 });
    expect(mapsRead(prospect, [{ title: "Another Salon", website: "https://other.sa" }])).toBe("none");
  });
});
