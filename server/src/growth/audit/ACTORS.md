# Apify actors for prospect audits (Digital Gap Audit)

These actors were chosen with the public Apify Store API. Each one was verified with real runs on 2026-10-02 against thepawconcept.co (the template's sample prospect) and three Saudi competitors. Prices are as charged on the Zain Apify account.

The actor ids and limits live in `budget.ts` (`ACTORS`). Every run passes:
- `maxItems`
- `maxTotalChargeUsd`, which is also reserved from the audit's `AUDIT_MAX_COST_USD` while the run lasts
- `timeout`

| Step | Actor | Pricing | What we run | Est. per audit |
|---|---|---|---|---|
| website | `apify/playwright-scraper` | compute only | ≤25 pages, depth 2, waits for `load` + 1.5 s, 2 GB | ~$0.05–0.10 |
| website | headless Chrome on the HQ machine | free | mobile capture of the home page (390 × 844 @2x) | $0 |
| search | `apify/google-search-scraper` | ~$0.002 per SERP page + $0.001 start | 1 brand + ≤6 category queries, `countryCode: sa` | ~$0.015 |
| search | `pro100chok/semrush-scraper` (`seo_audit` mode) | $0.0045 per result | home-page technical audit (H1, alt, sitemap, robots, speed, schema) | $0.0045 |
| search | `pro100chok/semrush-scraper` (`domain` mode, `database: sa`) | $0.0045 per domain | prospect + 3 competitors: authority, keywords, traffic, backlinks, top keywords, organic competitors | $0.018 |
| social | `apify/playwright-scraper` | compute only | competitors' home pages (name, Instagram handle) | ~$0.02 |
| social | `apify/instagram-profile-scraper` | $0.0026 per profile | prospect + competitors in one run (latest 12 posts included) | ~$0.01 |
| social | `clockworks/tiktok-profile-scraper` | $0.003 per video | 12 latest videos | ~$0.04 |
| social | `apify/facebook-pages-scraper`, `apify/facebook-posts-scraper` | $0.012 per page; $0.005 per post | page + 10 posts (only when a page is known) | ~$0.06 |
| ads | `scrapesage/google-ads-transparency-scraper` | $0.002 per ad | all 4 domains in one run, ≤20 ads each, region SA | ≤$0.16 |
| ads | `apify/facebook-ads-scraper` | ~$0.0042–0.0058 per ad | one exact-phrase Ad Library search per business, ≤10 each, SA | ≤$0.23 |
| ads | `pro100chok/similarweb-scraper` | $0.0019 per domain | all 4 domains in one run | $0.008 |
| ads | `compass/crawler-google-places` | $0.002 per place (+ add-ons, all off) | 1 place: "<name>", "<city>, Saudi Arabia" | ~$0.002 |

**Estimated cost per audit:** about $0.35–0.65 with three competitors, and below $0.70 in the worst case. Meta ads are the largest item. Reservations add up to about $2.5, so the $3 cap holds even when every step runs at once.

## Notes

- **Why `playwright-scraper`:** `apify/web-scraper`, `puppeteer-scraper` and `cheerio-scraper` refuse to run until their "full permission" is approved in the Apify console. `playwright-scraper` runs as is. Its page function evaluates our browser read in the page, after scripts ran. The read covers:
  - titles, meta descriptions, H1/H2, word counts, alt text, JSON-LD, internal links
  - policy pages, contact paths, review sections, platform (Shopify, Salla, Zid, WordPress, Wix, Webflow)
  - the nine tags in the template: Google Ads conversion, GA4, GTM, Meta, TikTok, Snap, LinkedIn Insight, X pixel, Hotjar/Clarity. Tags are found from script sources, inline code and `window` globals.
- **Minimum charge:** Google Search and Google Maps refuse a `maxTotalChargeUsd` under $0.50. They reserve $0.50 and are held down by `maxItems`.
- **Competitors:** competitors are found by keyword overlap first. Semrush's organic competitors for the prospect (domain mode, `organic.competitors`) are ranked by `common_keywords`. A competitor needs at least 2 shared keywords and must not be a marketplace, a social platform, a foreign ccTLD or a subdomain.
  - The category-search competitors are only a fallback, used when fewer than 2 Semrush peers survive the rules in `collect/peers.ts`: a business homepage about the category, .sa/Arabic/Saudi traffic ≥ 50%, and no more than 30× the prospect's visits unless it is a local storefront.
  - At most 3 are kept, never padded.
  - The report names how competitors were found and shows each one's common-keyword count.
- **Meta Ad Library:** `keyword_unordered` returns unrelated advertisers, so we search `keyword_exact_phrase`. An ad counts only when its page name matches the business or it links to its domain; otherwise the row reads "none attributable". Items carry `inputUrl`, which maps them back to the business.
- **Google Ads Transparency:** we search by domain. An ad counts as active if it was shown in the last 30 days. Advertisers often appear under their legal entity name.
- **Similarweb:** percentages arrive on a 0–100 scale and are stored as 0..1. Items do not come back in input order, so they are matched by `SiteName`.
- **Semrush:** there is no top-pages list. Pages are ranked by the traffic of the keywords they rank for. Only about 7 top keywords come back per domain.
- **TikTok ad library:** skipped. It only covers the EU/EEA.
- **Run mode:** a run is started with `waitForFinish` and then polled, instead of using `run-sync-get-dataset-items`. The run object carries `usageTotalUsd`, which the cost cap needs. Apify fills that field a few seconds after the run ends, so the client reads the run once more when it shows 0.
- **Recorded spend:** each run is recorded as the larger of Apify's reported usage and our per-result estimate, capped at the run's reservation.
- **Honesty rules from the template:**
  - Every fact is labelled quoted, estimated or not measured, with its source and date. Semrush and Similarweb figures are always estimated.
  - A source that fails or finds nothing is "not measured", never zero.
  - Conversion and CRM are always not measured, because checkout, forms and CRM are not visible from public pages.
