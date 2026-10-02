import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KanbanTask } from "../../shared/hermes";
import type { ActorRunOptions, ActorRunner } from "../../server/src/growth/audit/apify";
import { ApifyError, APIFY_NOT_CONNECTED } from "../../server/src/growth/audit/apify";
import { memoryRecordStore } from "../../server/src/board/recordStore";
import type { AuditCrm, CrmProspect, CrmRecordKind } from "../../server/src/growth/audit/crm";
import { AuditEngine, type AuditEngineDeps } from "../../server/src/growth/audit/engine";
import type { AuditNotionSink } from "../../server/src/growth/audit/notion";
import type { PdfRenderer } from "../../server/src/growth/audit/pdf";
import type { AuditHermes } from "../../server/src/growth/audit/steps";
import type { StoredAudit } from "../../server/src/growth/audit/types";
import { HttpError } from "../../server/src/http";
import { task } from "./helpers";

export const NOW_MS = Date.parse("2026-10-01T12:00:00Z");
export const NOW = NOW_MS / 1000;
const daysAgo = (d: number) => new Date(NOW_MS - d * 86_400_000).toISOString();

export const LEAD_ID = "0314cc38-bf3f-4cc2-8303-586a2f7ca60a";
export const COMPANY_ID = "00294367-0282-4c94-82db-0f2219d25e46";

/** What each actor returns for thestudio.sa: a small, well-tagged site with Instagram and Meta ads. */
export function sampleItems(): Record<string, Record<string, unknown>[]> {
  const page = (url: string, extra: Record<string, unknown> = {}) => ({
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
    trackers: { metaPixel: true, gtm: true, ga4: false, tiktokPixel: false, snapPixel: false },
    ...extra,
  });
  return {
    "apify/web-scraper": [page("https://www.thestudio.sa/"), page("https://www.thestudio.sa/services", { lang: "en", arabicChars: 0, latinChars: 800 })],
    "apify/google-search-scraper": [
      { searchQuery: { term: "beauty salon Riyadh" }, organicResults: [{ url: "https://rival.sa/", position: 1 }, { url: "https://www.thestudio.sa/", position: 3 }], paidResults: [{}] },
      { searchQuery: { term: "صالون تجميل الرياض" }, organicResults: [{ url: "https://rival.sa/x", position: 1 }, { url: "https://www.instagram.com/a", position: 2 }] },
      { searchQuery: { term: "THE STUDIO" }, organicResults: [{ url: "https://thestudio.sa/", position: 1 }] },
    ],
    "apify/instagram-profile-scraper": [
      {
        username: "thestudio.sa",
        followersCount: 12_000,
        postsCount: 300,
        latestPosts: [1, 3, 6, 10, 15, 20, 40].map((d) => ({ timestamp: daysAgo(d), likesCount: 200, commentsCount: 16 })),
      },
    ],
    "clockworks/tiktok-profile-scraper": [2, 9].map((d) => ({ createTimeISO: daysAgo(d), diggCount: 50, commentCount: 5, shareCount: 5, authorMeta: { fans: 800 }, isAd: false })),
    "apify/facebook-pages-scraper": [],
    "apify/facebook-posts-scraper": [],
    "apify/facebook-ads-scraper": [
      { pageName: "THE STUDIO", isActive: true, startDate: (NOW_MS - 45 * 86_400_000) / 1000, publisherPlatform: ["FACEBOOK", "INSTAGRAM"] },
      { pageName: "Other Salon", isActive: true, startDate: NOW - 86_400, publisherPlatform: ["FACEBOOK"] },
    ],
    "scrapesage/google-ads-transparency-scraper": [],
  };
}

export interface FakeApifyCall {
  actor: string;
  input: Record<string, unknown>;
  options: ActorRunOptions;
}

/** Apify without the network; `fail` makes an actor throw, `connected: false` behaves like a missing token. */
export function fakeApify(opts: { items?: Record<string, Record<string, unknown>[]>; costUsd?: number; fail?: Record<string, string>; connected?: boolean } = {}) {
  const items = opts.items ?? sampleItems();
  const calls: FakeApifyCall[] = [];
  const runner: ActorRunner = {
    async run(actor, input, options) {
      calls.push({ actor, input, options });
      if (opts.connected === false) throw new ApifyError(APIFY_NOT_CONNECTED);
      if (opts.fail?.[actor]) throw new ApifyError(opts.fail[actor]);
      return { items: items[actor] ?? [], costUsd: opts.costUsd ?? 0.01 };
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

export function fakeCrm(records: Partial<Record<string, CrmProspect>> = {}) {
  const calls: string[] = [];
  const crm: AuditCrm = {
    async prospect(kind: CrmRecordKind, id: string) {
      calls.push(`prospect ${kind} ${id}`);
      const r = records[id];
      if (!r) throw new HttpError(404, `CRM ${kind} ${id} not found`);
      return r;
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

export function fakePdf() {
  const rendered: string[] = [];
  const pdf: PdfRenderer = {
    async render(html, out) {
      rendered.push(html);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, "%PDF-1.4 fake");
    },
  };
  return { pdf, rendered };
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

export async function auditRig(overrides: Partial<AuditEngineDeps> & { apifyOpts?: Parameters<typeof fakeApify>[0]; profiles?: string[] } = {}) {
  const apify = fakeApify(overrides.apifyOpts);
  const hermes = fakeHermes(overrides.profiles);
  const crm = fakeCrm({ [LEAD_ID]: theStudioLead });
  const pdf = fakePdf();
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
    pdf: pdf.pdf,
    notion: notion.notion,
    root,
    publicBase: "https://hq.test",
    resolve: publicResolver,
    now: () => NOW,
    log: (l) => logs.push(l),
    newId: () => `aud_${String(++n).padStart(4, "0")}`,
    ...overrides,
  });
  /** Ticks until nothing is in flight and nothing changes. */
  const drive = async (rounds = 12) => {
    for (let i = 0; i < rounds; i++) {
      await engine.tick();
      await engine.idle();
    }
  };
  return { engine, apify, hermes, crm, pdf, notion, store, root, logs, drive };
}
