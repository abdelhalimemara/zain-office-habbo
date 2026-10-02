import type { TagRead } from "../../../../../shared/audits";
import type { Budget } from "../budget";
import type { CrmFlags, SocialChannel, StepResult, Trackers, WebsiteData } from "../types";

/**
 * Runs inside each crawled page (real Chromium, after its scripts ran), so tags that GTM injects are seen
 * too. Returns one compact record per page.
 */
const BROWSER_READ = `() => {
  const d = document;
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : "");
  const scripts = [...d.querySelectorAll("script")].map((s) => (s.src || "") + " " + (s.src ? "" : (s.textContent || "").slice(0, 4000)));
  const all = scripts.join("\\n") + "\\n" + [...d.querySelectorAll("img[src],iframe[src],noscript")].map((e) => e.src || e.textContent || "").join("\\n");
  const html = d.documentElement.outerHTML.slice(0, 400000);
  const host = location.hostname.replace(/^www\\./, "");
  const anchors = [...d.querySelectorAll("a[href]")];
  const links = anchors.map((a) => a.href);
  const jsonLd = [...d.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
    try { const v = JSON.parse(s.textContent || "null"); const list = Array.isArray(v) ? v : v && v["@graph"] ? v["@graph"] : [v];
      return list.map((x) => (x && x["@type"] ? String(x["@type"]) : "")).filter(Boolean); } catch (e) { return []; }
  });
  const imgs = [...d.querySelectorAll("img")];
  const body = text(d.body);
  const w = window;
  return {
    url: location.href,
    lang: (d.documentElement.getAttribute("lang") || "").toLowerCase(),
    title: d.title || "",
    siteName: (d.querySelector('meta[property="og:site_name"]') || {}).content || "",
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
    socialLinks: links.filter((h) => /(instagram\\.com|tiktok\\.com|facebook\\.com|fb\\.com|twitter\\.com|x\\.com|linkedin\\.com|youtube\\.com|snapchat\\.com)\\//i.test(h)).slice(0, 30),
    policyLinks: anchors.filter((a) => /(polic|shipping|return|refund|privacy|terms|سياسة|الشحن|الاسترجاع|الخصوصية|الشروط)/i.test(a.pathname + " " + text(a)) && text(a).length <= 40).map((a) => text(a) || a.pathname).slice(0, 10),
    contact: {
      whatsapp: links.some((h) => /wa\\.me|whatsapp\\.com|api\\.whatsapp/i.test(h)),
      phone: links.some((h) => /^tel:/i.test(h)),
      email: links.some((h) => /^mailto:/i.test(h)),
      form: !!d.querySelector("form input[type=email], form input[type=tel], form textarea"),
    },
    reviews: /(testimonial|customer reviews|what our customers|آراء العملاء|تقييمات)/i.test(body) || jsonLd.some((t) => /Review|AggregateRating/.test(t)),
    platform: /cdn\\.shopify\\.com|Shopify\\.theme/.test(html) ? "Shopify" : /salla\\.(sa|network)|cdn\\.salla/.test(html) ? "Salla" : /zid\\.store|zidcdn/.test(html) ? "Zid"
      : /wp-content|woocommerce/.test(html) ? (/woocommerce/.test(html) ? "WordPress / WooCommerce" : "WordPress") : /wixstatic|wix\\.com/.test(html) ? "Wix"
      : /webflow/.test(html) ? "Webflow" : /squarespace/.test(html) ? "Squarespace" : "",
    trackers: {
      ga4: /gtag\\/js\\?id=G-|['"]G-[A-Z0-9]{6,}['"]/.test(all) || Object.keys(w.google_tag_manager || {}).some((k) => k.startsWith("G-")),
      gtm: !!w.google_tag_manager && Object.keys(w.google_tag_manager).some((k) => k.startsWith("GTM-")) || /googletagmanager\\.com\\/gtm\\.js|GTM-[A-Z0-9]{4,}/.test(all),
      metaPixel: !!w.fbq || /connect\\.facebook\\.net\\/[^"']*fbevents\\.js|fbq\\(['"]init/.test(all),
      tiktokPixel: !!w.ttq || /analytics\\.tiktok\\.com/.test(all),
      snapPixel: !!w.snaptr || /sc-static\\.net\\/scevent/.test(all),
      linkedinInsight: !!w._linkedin_partner_id || /snap\\.licdn\\.com|_linkedin_partner_id/.test(all),
      xPixel: !!w.twq || /static\\.ads-twitter\\.com|twq\\(/.test(all),
      hotjarClarity: !!w.hj || !!w.clarity || /static\\.hotjar\\.com|clarity\\.ms/.test(all),
      googleAdsConversion: /AW-[0-9]{6,}|googleadservices\\.com\\/pagead\\/conversion/.test(all) || Object.keys(w.google_tag_manager || {}).some((k) => k.startsWith("AW-")),
    },
  };
}`;

/** apify/playwright-scraper's page function: the read above, evaluated in the page once tag managers had a moment to fire. */
export const PAGE_FUNCTION = `async function pageFunction(context) {
  await context.page.waitForTimeout(1500);
  return await context.page.evaluate(${BROWSER_READ});
}`;

export function websiteInput(website: string, maxPages = 20, depth = 2): Record<string, unknown> {
  const origin = new URL(website).origin;
  return {
    startUrls: [{ url: website }],
    linkSelector: depth > 0 ? "a[href]" : "",
    globs: [{ glob: `${origin}/**` }, { glob: `${origin.replace("://", "://www.")}/**` }],
    maxPagesPerCrawl: maxPages,
    maxCrawlingDepth: depth,
    maxConcurrency: 8,
    // "networkidle" never settles on chatty storefronts; "load" plus a short wait catches injected tags.
    waitUntil: "load",
    pageLoadTimeoutSecs: 30,
    closeCookieModals: true,
    downloadMedia: false,
    pageFunction: PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true },
  };
}

interface PageRecord {
  url?: string;
  lang?: string;
  title?: string;
  siteName?: string;
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
  policyLinks?: string[];
  contact?: Partial<Record<"whatsapp" | "phone" | "email" | "form", boolean>>;
  reviews?: boolean;
  platform?: string;
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
  ["youtube", /youtube\.com\/(@[A-Za-z0-9._-]{2,60}|c\/[A-Za-z0-9._-]{2,60}|channel\/[A-Za-z0-9_-]{10,40})/i],
  ["snapchat", /snapchat\.com\/add\/([A-Za-z0-9._-]{2,30})/i],
];

/** The first profile link per channel, as a handle (instagram, tiktok, x, snapchat) or a page URL (the others). */
export function socialLinksFrom(urls: readonly string[]): WebsiteData["socialLinks"] {
  const found: WebsiteData["socialLinks"] = {};
  for (const url of urls) {
    for (const [channel, pattern] of SOCIAL_PATTERNS) {
      if (found[channel]) continue;
      const m = pattern.exec(url);
      if (!m) continue;
      if (channel === "facebook") found.facebook = `https://www.facebook.com/${m[1]}`;
      else if (channel === "linkedin") found.linkedin = `https://www.linkedin.com/${m[1]}/${m[2]}`;
      else if (channel === "youtube") found.youtube = `https://www.youtube.com/${m[1]}`;
      else if (!/^(p|reel|explore|stories|share)$/i.test(m[1]!)) found[channel] = m[1]!;
    }
  }
  return found;
}

const TAG_LABELS: [keyof Trackers, string][] = [
  ["googleAdsConversion", "Google Ads conversion tag"],
  ["ga4", "GA4"],
  ["gtm", "Google Tag Manager"],
  ["metaPixel", "Meta Pixel"],
  ["tiktokPixel", "TikTok Pixel"],
  ["snapPixel", "Snapchat Pixel"],
  ["linkedinInsight", "LinkedIn Insight Tag"],
  ["xPixel", "X Pixel"],
  ["hotjarClarity", "Hotjar / Microsoft Clarity"],
];

/** The contract's tag read, in the template's order. */
export function tagRead(t: Trackers): TagRead[] {
  return TAG_LABELS.map(([key, tag]) => ({ tag, found: t[key] }));
}

export function summarizeWebsite(website: string, items: readonly Record<string, unknown>[], flags: CrmFlags = {}): WebsiteData {
  const pages = items as readonly PageRecord[];
  const any = (key: keyof Trackers) => pages.some((p) => !!p.trackers?.[key]);
  const home = pages.find((p) => p.url && new URL(p.url).pathname === "/") ?? pages[0];
  const headings = [...(home?.h1 ?? []), ...(home?.h2 ?? []), ...pages.slice(0, 6).flatMap((p) => p.h1 ?? [])];
  const contact = (k: "whatsapp" | "phone" | "email" | "form") => pages.some((p) => p.contact?.[k]);
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
      ga4: any("ga4"),
      gtm: any("gtm") || !!flags.hasGoogleTagManager,
      metaPixel: any("metaPixel") || !!flags.hasPixel,
      tiktokPixel: any("tiktokPixel"),
      snapPixel: any("snapPixel"),
      linkedinInsight: any("linkedinInsight"),
      xPixel: any("xPixel"),
      hotjarClarity: any("hotjarClarity"),
      googleAdsConversion: any("googleAdsConversion"),
    },
    socialLinks: socialLinksFrom(pages.flatMap((p) => p.socialLinks ?? [])),
    platform: pages.map((p) => p.platform).find((p) => p) || undefined,
    policyPages: [...new Set(pages.flatMap((p) => p.policyLinks ?? []).map((l) => l.slice(0, 60)))].slice(0, 6),
    contactPaths: (["whatsapp", "phone", "email", "form"] as const).filter(contact).map((k) => (k === "whatsapp" ? "WhatsApp" : k === "form" ? "contact form" : k)),
    reviewsOnSite: pages.some((p) => p.reviews),
    title: home?.title?.slice(0, 200),
    description: home?.metaDescription?.slice(0, 300),
    headings: [...new Set(headings.map((h) => h.slice(0, 120)).filter(Boolean))].slice(0, 12),
  };
}

export interface HomeRead {
  name?: string;
  instagram?: string;
  /** The page looks like a business's own site: a store platform, policy pages, WhatsApp/phone, or commerce schema. */
  business: boolean;
}

/** A competitor candidate's home page: display name, Instagram handle, and whether it is a business at all. */
export function summarizeHome(item: Record<string, unknown> | undefined): HomeRead {
  if (!item) return { business: false };
  const p = item as PageRecord;
  const raw = (p.siteName || (p.title ?? "").split(/[|·–—-]/)[0] || "").trim();
  const business =
    !!p.platform ||
    (p.policyLinks ?? []).length > 0 ||
    !!p.contact?.whatsapp ||
    !!p.contact?.phone ||
    (p.jsonLd ?? []).some((t) => /Store|LocalBusiness|Organization|Product|Offer|Restaurant|Clinic|Salon/i.test(t));
  return { name: raw.length >= 2 && raw.length <= 60 ? raw : undefined, instagram: socialLinksFrom(p.socialLinks ?? []).instagram, business };
}

export async function collectWebsite(auditId: string, website: string, budget: Budget, flags?: CrmFlags): Promise<StepResult<WebsiteData>> {
  const { items, costUsd } = await budget.run(auditId, "website", websiteInput(website));
  if (items.length === 0) throw Object.assign(new Error("The crawler could not load any page of the site"), { costUsd });
  const data = summarizeWebsite(website, items, flags);
  const found = tagRead(data.trackers).filter((t) => t.found).length;
  return { status: "done", data, costUsd, note: `${data.pages} pages crawled, ${found} of 9 tags found` };
}
