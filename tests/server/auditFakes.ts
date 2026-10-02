import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KanbanTask } from "../../shared/hermes";
import type { ActorRunOptions, ActorRunner } from "../../server/src/growth/audit/apify";
import { ApifyError, APIFY_NOT_CONNECTED } from "../../server/src/growth/audit/apify";
import { memoryRecordStore } from "../../server/src/board/recordStore";
import type { PdfRenderer, Screenshotter } from "../../server/src/growth/audit/chrome";
import type { AuditCrm, CrmProspect, CrmRecordKind, ProspectHit } from "../../server/src/growth/audit/crm";
import { AuditEngine, type AuditEngineDeps } from "../../server/src/growth/audit/engine";
import type { AuditNotionSink } from "../../server/src/growth/audit/notion";
import type { AuditHermes } from "../../server/src/growth/audit/steps";
import type { StoredAudit } from "../../server/src/growth/audit/types";
import { HttpError } from "../../server/src/http";
import { task } from "./helpers";

/** Fixture times are relative to the real clock: collectors count "the last 30 days" from Date.now(). */
export const NOW_MS = Date.now();
export const NOW = Math.floor(NOW_MS / 1000);
const daysAgo = (d: number) => new Date(NOW_MS - d * 86_400_000).toISOString();

export const LEAD_ID = "0314cc38-bf3f-4cc2-8303-586a2f7ca60a";
export const COMPANY_ID = "00294367-0282-4c94-82db-0f2219d25e46";

type Items = Record<string, unknown>[];
type Input = Record<string, unknown>;

export function page(url: string, extra: Record<string, unknown> = {}) {
  return {
    url,
    lang: "ar",
    title: "THE STUDIO | صالون تجميل في الرياض",
    metaDescription: "صالون تجميل فاخر في الرياض يقدم خدمات الشعر والأظافر والعناية بالبشرة بأيدي خبيرات معتمدات.",
    viewport: true,
    h1: ["صالون تجميل"],
    h2: ["Hair styling", "Nail care"],
    words: 420,
    arabicChars: 900,
    latinChars: 100,
    images: 10,
    imagesNoAlt: 2,
    jsonLd: ["BeautySalon"],
    internalLinks: 12,
    socialLinks: ["https://www.instagram.com/thestudio.sa/", "https://www.tiktok.com/@thestudio"],
    policyLinks: ["Privacy policy", "Returns"],
    contact: { whatsapp: true, phone: true },
    reviews: true,
    platform: "Salla",
    trackers: { metaPixel: true, gtm: false, ga4: false, tiktokPixel: false, snapPixel: false, googleAdsConversion: true },
    ...extra,
  };
}

const serpFor = (term: string): Record<string, unknown> => {
  if (term === '"THE STUDIO"') {
    return { searchQuery: { term }, organicResults: [{ url: "https://www.thestudio.sa/?srsltid=abc", position: 1 }, { url: "https://www.instagram.com/thestudio.sa/", position: 2 }] };
  }
  const organic = [
    { url: "https://rival.sa/", position: 1 },
    { url: "https://www.glow.sa/ar", position: 2 },
    { url: "https://www.instagram.com/someone/", position: 3 },
    { url: "https://www.google.com.sa/maps/place/x", position: 4 },
  ];
  if (term === "beauty salon Riyadh") organic.push({ url: "https://www.thestudio.sa/services", position: 5 });
  return { searchQuery: { term }, organicResults: organic, paidResults: [] };
};

const semrushDomain = (domain: string): Record<string, unknown> => {
  const table: Record<string, [number, number, number]> = { "thestudio.sa": [12, 40, 80], "rival.sa": [25, 4200, 600], "glow.sa": [18, 1500, 300], "glam.sa": [9, 90, 20] };
  const [authority, traffic, keywords] = table[domain] ?? [1, 0, 0];
  return {
    domain,
    database: "sa",
    authority_score: authority,
    organic_traffic: traffic,
    organic_keywords: keywords,
    backlinks: authority * 50,
    referring_domains: authority * 10,
    organic: {
      top_keywords: [
        { keyword: "صالون تجميل", position: 14, volume: 9900, traffic: 30, url: `https://${domain}/` },
        { keyword: "nail salon riyadh", position: 8, volume: 880, traffic: 10, url: `https://${domain}/services` },
      ],
      competitors: [{ domain: "rival.sa", common_keywords: 31 }, { domain: "petstock.co.nz", common_keywords: 1 }],
    },
  };
};

/** Each actor's output for thestudio.sa and its competitors, shaped like the real actors' items (synthetic values). */
export function sampleActors(): Record<string, Items | ((input: Input) => Items)> {
  return {
    "apify/playwright-scraper": (input) =>
      input.maxCrawlingDepth === 0
        ? [page("https://rival.sa/", { siteName: "Rival Beauty", socialLinks: ["https://instagram.com/rivalbeauty"] }), page("https://glow.sa/", { siteName: "", title: "Glow Lounge | Riyadh", socialLinks: [] })]
        : [page("https://www.thestudio.sa/"), page("https://www.thestudio.sa/services", { lang: "en", arabicChars: 0, latinChars: 800 })],
    "apify/google-search-scraper": (input) => String(input.queries).split("\n").map(serpFor),
    "pro100chok/semrush-scraper": (input) =>
      input.mode === "seo_audit"
        ? [{ url: input.domains, h1_count: 0, has_sitemap: true, has_robots_txt: true, images_missing_alt: 12, title_length: 30, meta_description_length: 120, structured_data_blocks: 1, canonical: "https://thestudio.sa/", semrush: { organic_competitors: [{ domain: "glam.sa" }] } }]
        : (input.domains as string[]).map(semrushDomain),
    "apify/instagram-profile-scraper": (input) =>
      (input.usernames as string[]).flatMap((u) =>
        u === "thestudio.sa"
          ? [{ username: u, followersCount: 12_000, postsCount: 300, latestPosts: [1, 3, 6, 10, 15, 20, 40].map((d) => ({ timestamp: daysAgo(d), likesCount: 200, commentsCount: 16 })) }]
          : u === "rivalbeauty"
            ? [{ username: u, followersCount: 5_400, postsCount: 120, latestPosts: [] }]
            : [],
      ),
    "clockworks/tiktok-profile-scraper": [2, 9].map((d) => ({ createTimeISO: daysAgo(d), diggCount: 50, commentCount: 5, shareCount: 5, authorMeta: { fans: 800, video: 40 }, isAd: false })),
    "apify/facebook-ads-scraper": (input) =>
      (input.startUrls as { url: string }[]).flatMap(({ url }) =>
        url.includes("THE%20STUDIO")
          ? [
              { inputUrl: url, pageName: "THE STUDIO", isActive: true, startDate: Math.floor((NOW_MS - 45 * 86_400_000) / 1000), publisherPlatform: ["FACEBOOK", "INSTAGRAM"] },
              { inputUrl: url, pageName: "Studio Games 3D", isActive: true, startDate: NOW - 86_400 },
            ]
          : [],
      ),
    "scrapesage/google-ads-transparency-scraper": (input) =>
      (input.domains as string[]).flatMap((domain) =>
        domain === "thestudio.sa" || domain === "rival.sa"
          ? [1, 2].map((n) => ({ domain, advertiserName: "Studio Trading Co", creativeId: `CR${n}`, format: n === 1 ? "IMAGE" : "TEXT", firstShown: daysAgo(100 + n), lastShown: daysAgo(n), shownForDays: 100 }))
          : [],
      ),
    "pro100chok/similarweb-scraper": (input) =>
      (input.domains as string[]).map((d, i) => ({
        SiteName: d,
        Engagments: { Visits: [2042, 10628, 3747, 900][i] ?? 100, BounceRate: 35.15, Month: 8, Year: 2026 },
        TrafficSources: { SearchOrganic: 37.67, Direct: 23.09, SearchPaid: 8.94 },
        TopCountryShares: [{ CountryCode: "SA", Value: 72.62 }],
      })),
    "compass/crawler-google-places": [{ title: "THE STUDIO", website: "https://www.thestudio.sa/", totalScore: 4.8, reviewsCount: 651, categoryName: "Beauty salon", url: "https://maps.google.com/?cid=1" }],
  };
}

export interface FakeApifyCall {
  actor: string;
  input: Input;
  options: ActorRunOptions;
}

/** Apify without the network; `fail` makes an actor throw, `connected: false` behaves like a missing token. */
export function fakeApify(opts: { actors?: Record<string, Items | ((input: Input) => Items)>; costUsd?: number; fail?: Record<string, string>; connected?: boolean } = {}) {
  const actors = opts.actors ?? sampleActors();
  const calls: FakeApifyCall[] = [];
  const runner: ActorRunner = {
    async run(actor, input, options) {
      calls.push({ actor, input, options });
      if (opts.connected === false) throw new ApifyError(APIFY_NOT_CONNECTED);
      if (opts.fail?.[actor]) throw new ApifyError(opts.fail[actor]);
      const source = actors[actor];
      return { items: (typeof source === "function" ? source(input) : source) ?? [], costUsd: opts.costUsd ?? 0.01 };
    },
  };
  return { runner, calls, actors: () => calls.map((c) => c.actor) };
}

export function fakeHermes(profiles: string[] = []) {
  const tasks = new Map<string, KanbanTask>();
  let next = 0;
  const hermes: AuditHermes = {
    listProfiles: async () => [{ name: "default" }, ...profiles.map((name) => ({ name }))] as Awaited<ReturnType<AuditHermes["listProfiles"]>>,
    createTask: async (input) => {
      const t = task({ id: `t_${++next}`, status: "ready", result: null, title: input.title, body: input.body ?? null, assignee: input.assignee ?? null, tenant: input.tenant ?? null });
      tasks.set(t.id, t);
      return t;
    },
    task: async (id) => ({ task: tasks.get(id)!, comments: [], links: { parents: [], children: [] } }) as unknown as Awaited<ReturnType<AuditHermes["task"]>>,
    updateTask: async (id, patch) => {
      const t = { ...tasks.get(id)!, ...(patch as Partial<KanbanTask>) };
      tasks.set(id, t);
      return t;
    },
  };
  return {
    hermes,
    tasks,
    complete(result: string) {
      for (const t of tasks.values()) if (t.status !== "done") tasks.set(t.id, { ...t, status: "done", result });
    },
  };
}

export const HITS: ProspectHit[] = [{ id: LEAD_ID, kind: "lead", name: "THE STUDIO", website: "https://www.thestudio.sa", instagram: "thestudio.sa", city: "RIYADH" }];

export function fakeCrm(records: Partial<Record<string, CrmProspect>> = {}) {
  const calls: string[] = [];
  const crm: AuditCrm = {
    async prospect(kind: CrmRecordKind, id: string) {
      calls.push(`prospect ${kind} ${id}`);
      const r = records[id];
      if (!r) throw new HttpError(404, `CRM ${kind} ${id} not found`);
      return r;
    },
    async search(q) {
      calls.push(`search ${q}`);
      return HITS.filter((h) => h.name.toLowerCase().includes(q.toLowerCase()));
    },
    async uploadPdf(name) {
      calls.push(`upload ${name}`);
      return "file_1";
    },
    async attach(kind, id, _name, fileId) {
      calls.push(`attach ${kind} ${id} ${fileId}`);
      return "att_1";
    },
    async note(kind, id, title) {
      calls.push(`note ${kind} ${id} ${title}`);
      return "note_1";
    },
    recordUrl: (kind, id) => `https://crm.test/object/${kind}/${id}`,
  };
  return { crm, calls };
}

export const theStudioLead: CrmProspect = {
  prospect: { name: "THE STUDIO", website: "https://www.thestudio.sa", leadId: LEAD_ID, city: "RIYADH", category: "BEAUTY", instagram: "thestudio.sa" },
  flags: { hasPixel: true },
};

export const PNG = Buffer.from("89504e470d0a1a0a", "hex");

export function fakeChrome(opts: { captureFails?: boolean } = {}) {
  const rendered: string[] = [];
  const captured: string[] = [];
  const write = async (out: string, bytes: Buffer | string) => {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
  };
  const pdf: PdfRenderer = {
    async render(html, out) {
      rendered.push(html);
      await write(out, "%PDF-1.4 fake");
    },
  };
  const screenshots: Screenshotter = {
    async capture(url, out) {
      if (opts.captureFails) throw new Error("navigation timed out");
      captured.push(url);
      await write(out, PNG);
    },
  };
  return { pdf, screenshots, rendered, captured };
}

export function fakeNotion() {
  const synced: { id: string; bytes: number; url: string }[] = [];
  const notion: AuditNotionSink = {
    async sync(a, _pageId, pdf) {
      synced.push({ id: a.id, bytes: pdf.bytes?.length ?? 0, url: pdf.url });
      return { pageId: "page_1", url: "https://notion.so/page_1" };
    },
  };
  return { notion, synced };
}

export const publicResolver = async () => ["93.184.216.34"];

export async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zain-audits-"));
}

export async function auditRig(overrides: Partial<AuditEngineDeps> & { apifyOpts?: Parameters<typeof fakeApify>[0]; profiles?: string[]; captureFails?: boolean } = {}) {
  const { apifyOpts, profiles, captureFails, ...deps } = overrides;
  const apify = fakeApify(apifyOpts);
  const hermes = fakeHermes(profiles);
  const crm = fakeCrm({ [LEAD_ID]: theStudioLead });
  const chrome = fakeChrome({ captureFails });
  const notion = fakeNotion();
  const store = memoryRecordStore<StoredAudit>();
  const root = await tempRoot();
  let n = 0;
  const logs: string[] = [];
  const engine = new AuditEngine({
    store,
    apify: apify.runner,
    hermes: hermes.hermes,
    crm: crm.crm,
    pdf: chrome.pdf,
    screenshots: chrome.screenshots,
    notion: notion.notion,
    root,
    publicBase: "https://hq.test",
    resolve: publicResolver,
    now: () => NOW,
    log: (l) => logs.push(l),
    newId: () => `aud_${String(++n).padStart(4, "0")}`,
    ...deps,
  });
  /** Ticks until nothing is in flight and nothing changes. */
  const drive = async (rounds = 14) => {
    for (let i = 0; i < rounds; i++) {
      await engine.tick();
      await engine.idle();
    }
  };
  return { engine, apify, hermes, crm, chrome, notion, store, root, logs, drive };
}
