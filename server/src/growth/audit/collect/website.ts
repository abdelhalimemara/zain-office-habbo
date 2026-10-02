import type { Budget } from "../budget";
import type { CrmFlags, SocialChannel, StepResult, Trackers, WebsiteData } from "../types";

/**
 * Runs in each crawled page (apify/web-scraper, real Chrome), after scripts have run, so tags that
 * GTM injects are seen too. Returns one compact record per page.
 */
export const PAGE_FUNCTION = `async function pageFunction(context) {
  const d = document;
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : "");
  const scripts = [...d.querySelectorAll("script")].map((s) => (s.src || "") + " " + (s.src ? "" : (s.textContent || "").slice(0, 3000)));
  const all = scripts.join("\\n");
  const host = location.hostname.replace(/^www\\./, "");
  const links = [...d.querySelectorAll("a[href]")].map((a) => a.href);
  const jsonLd = [...d.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
    try { const v = JSON.parse(s.textContent || "null"); const list = Array.isArray(v) ? v : v && v["@graph"] ? v["@graph"] : [v];
      return list.map((x) => (x && x["@type"] ? String(x["@type"]) : "")).filter(Boolean); } catch (e) { return []; }
  });
  const imgs = [...d.querySelectorAll("img")];
  const body = text(d.body);
  return {
    url: location.href,
    lang: (d.documentElement.getAttribute("lang") || "").toLowerCase(),
    dir: (d.documentElement.getAttribute("dir") || "").toLowerCase(),
    title: d.title || "",
    metaDescription: (d.querySelector('meta[name="description"]') || {}).content || "",
    viewport: !!d.querySelector('meta[name="viewport"]'),
    h1: [...d.querySelectorAll("h1")].map(text).slice(0, 5),
    h2: [...d.querySelectorAll("h2")].map(text).slice(0, 8),
    words: body ? body.split(" ").length : 0,
    arabicChars: (body.match(/[\\u0600-\\u06FF]/g) || []).length,
    latinChars: (body.match(/[A-Za-z]/g) || []).length,
    images: imgs.length,
    imagesNoAlt: imgs.filter((i) => !(i.getAttribute("alt") || "").trim()).length,
    jsonLd,
    internalLinks: links.filter((h) => { try { return new URL(h).hostname.replace(/^www\\./, "") === host; } catch (e) { return false; } }).length,
    socialLinks: links.filter((h) => /(instagram\\.com|tiktok\\.com|facebook\\.com|fb\\.com|twitter\\.com|x\\.com|linkedin\\.com)\\//i.test(h)).slice(0, 20),
    trackers: {
      metaPixel: !!window.fbq || /connect\\.facebook\\.net\\/[^"']*fbevents\\.js|fbq\\(['"]init/.test(all),
      gtm: !!window.google_tag_manager || /googletagmanager\\.com\\/gtm\\.js|GTM-[A-Z0-9]{4,}/.test(all),
      ga4: /gtag\\/js\\?id=G-|['"]G-[A-Z0-9]{6,}['"]/.test(all) || Object.keys(window.google_tag_manager || {}).some((k) => k.startsWith("G-")),
      tiktokPixel: !!window.ttq || /analytics\\.tiktok\\.com/.test(all),
      snapPixel: !!window.snaptr || /sc-static\\.net\\/scevent/.test(all),
    },
  };
}`;

export function websiteInput(website: string): Record<string, unknown> {
  const origin = new URL(website).origin;
  return {
    startUrls: [{ url: website }],
    linkSelector: "a[href]",
    globs: [{ glob: `${origin}/**` }, { glob: `${origin.replace("://", "://www.")}/**` }],
    maxPagesPerCrawl: 25,
    maxCrawlingDepth: 2,
    maxConcurrency: 5,
    injectJQuery: false,
    waitUntil: ["networkidle2"],
    pageFunction: PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true },
  };
}

interface PageRecord {
  url?: string;
  lang?: string;
  title?: string;
  metaDescription?: string;
  viewport?: boolean;
  h1?: string[];
  h2?: string[];
  words?: number;
  arabicChars?: number;
  latinChars?: number;
  images?: number;
  imagesNoAlt?: number;
  jsonLd?: string[];
  internalLinks?: number;
  socialLinks?: string[];
  trackers?: Partial<Trackers>;
}

const share = (pages: readonly PageRecord[], test: (p: PageRecord) => boolean) => (pages.length ? pages.filter(test).length / pages.length : 0);
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const SOCIAL_PATTERNS: [SocialChannel, RegExp][] = [
  ["instagram", /instagram\.com\/([A-Za-z0-9._]{2,30})\/?(?:[?#]|$)/i],
  ["tiktok", /tiktok\.com\/@([A-Za-z0-9._]{2,30})/i],
  ["facebook", /(?:facebook|fb)\.com\/(?!sharer|share|dialog|plugins|tr\b)([A-Za-z0-9.\-]{2,80})\/?(?:[?#]|$)/i],
  ["x", /(?:twitter|x)\.com\/(?!intent|share|home)([A-Za-z0-9_]{2,30})\/?(?:[?#]|$)/i],
  ["linkedin", /linkedin\.com\/(company|in)\/([A-Za-z0-9\-_%]{2,100})/i],
];

/** The first profile link per channel, as a handle (instagram, tiktok, x) or a page URL (facebook, linkedin). */
export function socialLinksFrom(urls: readonly string[]): WebsiteData["socialLinks"] {
  const found: WebsiteData["socialLinks"] = {};
  for (const url of urls) {
    for (const [channel, pattern] of SOCIAL_PATTERNS) {
      if (found[channel]) continue;
      const m = pattern.exec(url);
      if (!m) continue;
      if (channel === "facebook") found.facebook = `https://www.facebook.com/${m[1]}`;
      else if (channel === "linkedin") found.linkedin = `https://www.linkedin.com/${m[1]}/${m[2]}`;
      else if (!/^(p|reel|explore|stories|share)$/i.test(m[1]!)) found[channel] = m[1]!;
    }
  }
  return found;
}

export function summarizeWebsite(website: string, items: readonly Record<string, unknown>[], flags: CrmFlags = {}): WebsiteData {
  const pages = items as readonly PageRecord[];
  const any = (key: keyof Trackers) => pages.some((p) => !!p.trackers?.[key]);
  const home = pages.find((p) => p.url && new URL(p.url).pathname === "/") ?? pages[0];
  const headings = [...(home?.h1 ?? []), ...(home?.h2 ?? []), ...pages.slice(0, 6).flatMap((p) => p.h1 ?? [])];
  return {
    pages: pages.length,
    https: website.startsWith("https:") && pages.every((p) => !p.url || p.url.startsWith("https:")),
    goodTitles: share(pages, (p) => (p.title ?? "").trim().length >= 10 && (p.title ?? "").trim().length <= 65),
    goodMetas: share(pages, (p) => (p.metaDescription ?? "").trim().length >= 50 && (p.metaDescription ?? "").trim().length <= 160),
    oneH1: share(pages, (p) => (p.h1 ?? []).length === 1),
    avgWords: Math.round(avg(pages.map((p) => num(p.words)))),
    images: pages.reduce((n, p) => n + num(p.images), 0),
    imagesNoAlt: pages.reduce((n, p) => n + num(p.imagesNoAlt), 0),
    schemaTypes: [...new Set(pages.flatMap((p) => p.jsonLd ?? []))].slice(0, 12),
    viewport: pages.length > 0 && share(pages, (p) => !!p.viewport) >= 0.5,
    avgInternalLinks: Math.round(avg(pages.map((p) => num(p.internalLinks)))),
    arabicPages: pages.filter((p) => (p.lang ?? "").startsWith("ar") || num(p.arabicChars) > num(p.latinChars)).length,
    englishPages: pages.filter((p) => (p.lang ?? "").startsWith("en") || num(p.latinChars) >= num(p.arabicChars)).length,
    trackers: {
      metaPixel: any("metaPixel") || !!flags.hasPixel,
      gtm: any("gtm") || !!flags.hasGoogleTagManager,
      ga4: any("ga4"),
      tiktokPixel: any("tiktokPixel"),
      snapPixel: any("snapPixel"),
    },
    socialLinks: socialLinksFrom(pages.flatMap((p) => p.socialLinks ?? [])),
    title: home?.title?.slice(0, 200),
    description: home?.metaDescription?.slice(0, 300),
    headings: [...new Set(headings.map((h) => h.slice(0, 120)).filter(Boolean))].slice(0, 12),
  };
}

export async function collectWebsite(auditId: string, website: string, budget: Budget, flags?: CrmFlags): Promise<StepResult<WebsiteData>> {
  const { items, costUsd } = await budget.run(auditId, "website", websiteInput(website));
  if (items.length === 0) throw Object.assign(new Error("The crawler could not load any page of the site"), { costUsd });
  const data = summarizeWebsite(website, items, flags);
  return { status: "done", data, costUsd, note: `${data.pages} pages crawled` };
}
