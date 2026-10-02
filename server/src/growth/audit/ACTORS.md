# Apify actors for prospect audits

These actors were chosen on 2026-10-02 from the public Apify Store API. They are popular, maintained, and charged per result or event where possible. Prices are Apify free-plan rates; paid plans are cheaper.

The actor ids and limits live in `budget.ts` (`ACTORS`). Every run passes:
- `maxItems`
- `maxTotalChargeUsd`, which is also reserved from the audit's $3 budget while the run lasts
- `timeout`, plus `memory` for the crawler

| Step | Actor | Pricing | Limits we pass | Est. per audit |
|---|---|---|---|---|
| website | `apify/web-scraper` (125k users) | compute only | 25 pages, depth 2, 2 GB, 420 s | ~$0.05 (max ~$0.10) |
| search | `apify/google-search-scraper` (195k users) | $0.0045 per SERP page + $0.001 start | 5–8 queries × 1 page, `countryCode: sa`, `languageCode: ar` | ~$0.03 |
| social | `apify/instagram-profile-scraper` (235k users) | $0.0026 per profile (latest 12 posts included) | 1 profile | ~$0.003 |
| social | `clockworks/tiktok-profile-scraper` (48k users) | $0.003 per video | 12 latest videos | ~$0.04 |
| social | `apify/facebook-pages-scraper` (64k users) | $0.012 per page | 1 page | ~$0.012 |
| social | `apify/facebook-posts-scraper` (117k users) | $0.005 per post + $0.001 start | 10 posts, last 60 days | ~$0.05 |
| ads | `apify/facebook-ads-scraper` (40k users) | $0.0058 per ad | 30 active ads, SA | ~$0.17 |
| ads | `scrapesage/google-ads-transparency-scraper` (1.6k users, 0 failed runs in 30 days) | $0.002 per ad | 30 ads, region SA, `includeDetails: false` | ~$0.06 |

**Estimated cost per audit:** about $0.45–0.50 when all channels are present. The worst case is about $0.53. The reservations add up to at most about $1.01 per audit, well under the `AUDIT_MAX_COST_USD` cap of $3.

## Notes

- **Why `web-scraper`, not `website-content-crawler`:** it renders each page in real Chrome. Our page function then reads titles, meta descriptions, H1/H2, word counts, alt text, JSON-LD, internal links, language, and tracking tags from both the script sources and the `window` globals (`fbq`, `ttq`, `snaptr`, `google_tag_manager`). That catches pixels that GTM injects. `website-content-crawler` strips scripts and returns no headings or schema data.
- **Search:** queries come from the CRM category and city in English and Arabic, plus short service headings from the crawl. The brand name is the last query. Competitors are the non-platform domains that outrank the prospect; Google, Instagram, Wikipedia and similar sites are excluded.
- **Social handles:** they come from the CRM lead (`instagramHandle`, `tiktokHandle`, `facebookPageUrl`) or the request first, then from links on the crawled site. X and LinkedIn are listed but not measured, because there is no cheap, reliable scraper for either.
- **Meta Ad Library:** the actor searches the CRM's `metaAdLibraryUrl`, the Facebook page, or a keyword search in SA. Keyword results are filtered to the prospect's page name or to ads linking to its domain.
- **Google Ads Transparency:** we search by exact domain. The actor has no "active" flag, so an ad counts as recent if it was shown in the last 14 days.
- **TikTok ad library:** skipped. It only covers EU/EEA countries, and the actors that wrap it list no SA region. TikTok's `isAd` flag on profile videos is used as a weaker signal.
- **Run mode:** a run is started with `waitForFinish` and then polled, instead of using `run-sync-get-dataset-items`. The run object carries `usageTotalUsd`, which the cost cap needs, and long crawls can exceed the 300 s sync limit. A run that outlives its timeout is aborted.
- **Recorded spend:** each run is recorded as the larger of Apify's reported usage and our per-result estimate. It is capped at the run's reservation, because Apify stops pay-per-event actors at `maxTotalChargeUsd`.
