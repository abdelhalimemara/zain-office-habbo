import type { AuditFinding, ProspectAudit, SectionScore } from "../../../../../shared/audits";
import type { CollectedData } from "../types";

/** Everything a page partial can use; each partial returns one A4 page. */
export interface ReportContext {
  audit: ProspectAudit;
  data: CollectedData;
  logo: string;
  date: string;
  contact: { name: string; email: string };
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Prospect-supplied text may be Arabic: let the browser pick the direction per element. */
const t = (value: unknown) => `<span dir="auto">${esc(value)}</span>`;
/** CRM values come in upper case ("RIYADH", "REAL_ESTATE"). */
const label = (v: string) => (/[a-z]/.test(v) ? v : v.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString("en-US"));
const yes = (v: boolean) => (v ? `<span class="yes">Yes</span>` : `<span class="no">No</span>`);

const SECTION_LABEL = { website: "Website & SEO", search: "Search visibility", social: "Social media", ads: "Paid ads", tracking: "Tracking" } as const;
type Section = keyof typeof SECTION_LABEL;

function page(ctx: ReportContext, no: number, body: string): string {
  return `<section class="page">
  <header><div class="brand">${ctx.logo}<span>Zain Growth</span></div><div class="meta">Prospect audit · ${t(ctx.audit.prospect.name)}</div></header>
  ${body}
  <footer><span>Zain Growth · zain-studio.com</span><span>${ctx.date} · ${no}</span></footer>
</section>`;
}

function dial(score: number): string {
  const r = 26;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return `<svg viewBox="0 0 64 64" role="img" aria-label="Overall score ${score} of 100">
  <circle class="track" cx="32" cy="32" r="${r}" fill="none" stroke-width="6"/>
  <circle class="value" cx="32" cy="32" r="${r}" fill="none" stroke-width="6" stroke-dasharray="${filled.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 32 32)"/>
  <text class="num" x="32" y="35" text-anchor="middle">${score}</text><text class="of" x="32" y="43" text-anchor="middle">out of 100</text>
</svg>`;
}

function findings(ctx: ReportContext, section: Section): string {
  const list = (ctx.audit.analysis?.findings ?? []).filter((f: AuditFinding) => f.section === section);
  if (!list.length) return "";
  return `<h3>Findings</h3>${list.map((f) => `<div class="finding ${f.severity}"><b>${t(f.title)}</b>${t(f.detail)}</div>`).join("")}`;
}

function sectionHead(ctx: ReportContext, section: Section): string {
  const s: SectionScore | undefined = ctx.audit.score?.sections[section];
  const scored = s && s.weight > 0 ? `${s.score}/100` : "Not measured";
  return `<h2>${esc(SECTION_LABEL[section])}</h2><p class="lead">Score: <b>${scored}</b>${s?.drivers.length ? ` · ${esc(s.drivers[0])}` : ""}</p>`;
}

export function cover(ctx: ReportContext): string {
  const { audit } = ctx;
  const score = audit.score;
  return `<section class="page cover">
  <div class="band"><div class="logo">${ctx.logo}<span>Zain Growth</span></div>
    <h1>${t(audit.prospect.name)}</h1><div class="site">${esc(audit.prospect.website)}</div></div>
  <div class="body">
    <div class="facts"><h2>Digital growth audit</h2><p class="muted">Website, search, social, paid ads and tracking, measured and scored.</p>
      <dl><dt>Date</dt><dd>${ctx.date}</dd>${audit.prospect.city ? `<dt>City</dt><dd>${t(label(audit.prospect.city))}</dd>` : ""}${
        audit.prospect.category ? `<dt>Category</dt><dd>${t(label(audit.prospect.category))}</dd>` : ""
      }<dt>Prepared by</dt><dd>Zain Growth</dd></dl></div>
    <div class="dial">${dial(score?.overall ?? 0)}<div class="grade">Grade ${esc(score?.grade ?? "–")}</div></div>
  </div>
  <footer><span>Confidential · prepared for ${t(audit.prospect.name)}</span><span>1</span></footer>
</section>`;
}

export function summary(ctx: ReportContext): string {
  const a = ctx.audit.analysis;
  return page(
    ctx,
    2,
    `<h2>Executive summary</h2><p class="lead">${t(a?.executiveSummary ?? "")}</p>
    <h3>Top findings</h3>${(a?.findings ?? [])
      .filter((f) => f.severity === "high")
      .concat((a?.findings ?? []).filter((f) => f.severity !== "high"))
      .slice(0, 4)
      .map((f) => `<div class="finding ${f.severity}"><b>${t(f.title)}</b>${t(f.detail)}</div>`)
      .join("")}`,
  );
}

export function scorecard(ctx: ReportContext): string {
  const s = ctx.audit.score;
  const rows = (Object.keys(SECTION_LABEL) as Section[])
    .map((k) => {
      const sec = s?.sections[k];
      const measured = !!sec && sec.weight > 0;
      return `<div class="score-row"><div><div class="name">${esc(SECTION_LABEL[k])}</div><div class="weight">${measured ? `${Math.round(sec.weight * 100)}% of the score` : "Not measured"}</div></div>
      <div><div class="bar"><span style="width:${measured ? sec.score : 0}%"></span></div><ul>${(sec?.drivers ?? []).map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>
      <div class="pts">${measured ? sec.score : "–"}</div></div>`;
    })
    .join("");
  return page(ctx, 3, `<h2>Scorecard</h2><p class="lead">Overall <b>${s?.overall ?? 0}/100</b>, grade <b>${esc(s?.grade ?? "–")}</b>.</p><div class="scorecard">${rows}</div>`);
}

export function website(ctx: ReportContext): string {
  const w = ctx.data.website;
  const body = w
    ? `<div class="stats"><div class="stat"><b>${w.pages}</b><span>pages crawled</span></div><div class="stat"><b>${w.avgWords}</b><span>words per page</span></div><div class="stat"><b>${w.imagesNoAlt}/${w.images}</b><span>images without alt text</span></div></div>
      <table><tr><th>Check</th><th>Result</th></tr>
      <tr><td>Well-sized page titles</td><td>${Math.round(w.goodTitles * 100)}% of pages</td></tr>
      <tr><td>Meta descriptions</td><td>${Math.round(w.goodMetas * 100)}% of pages</td></tr>
      <tr><td>Exactly one H1</td><td>${Math.round(w.oneH1 * 100)}% of pages</td></tr>
      <tr><td>Structured data</td><td>${w.schemaTypes.length ? esc(w.schemaTypes.join(", ")) : yes(false)}</td></tr>
      <tr><td>HTTPS</td><td>${yes(w.https)}</td></tr><tr><td>Mobile viewport</td><td>${yes(w.viewport)}</td></tr>
      <tr><td>Arabic / English pages</td><td>${w.arabicPages} / ${w.englishPages}</td></tr>
      <tr><td>Internal links per page</td><td>${w.avgInternalLinks}</td></tr></table>`
    : `<p class="muted">The website could not be crawled in this audit.</p>`;
  return page(ctx, 4, `${sectionHead(ctx, "website")}${body}${findings(ctx, "website")}`);
}

export function search(ctx: ReportContext): string {
  const s = ctx.data.search;
  const competitors = ctx.audit.analysis?.competitors.length
    ? ctx.audit.analysis.competitors.map((c) => `<tr><td>${t(c.name)}</td><td>${esc(c.domain ?? "")}</td><td>${t(c.note)}</td></tr>`).join("")
    : (s?.competitors ?? []).map((c) => `<tr><td>${esc(c.domain)}</td><td>${esc(c.domain)}</td><td>Outranks on ${c.appearances} searches</td></tr>`).join("");
  const body = s
    ? `<table><tr><th>Search (Saudi Arabia)</th><th>Their position</th><th>Who ranks</th></tr>${s.queries
        .map((q) => `<tr><td>${t(q.query)}</td><td>${q.position ? `#${q.position}` : `<span class="no">Not on page one</span>`}</td><td>${esc(q.topDomains.slice(0, 3).join(", "))}</td></tr>`)
        .join("")}</table>
      ${competitors ? `<h3>Competitors</h3><table><tr><th>Name</th><th>Domain</th><th>Why they win</th></tr>${competitors}</table>` : ""}`
    : `<p class="muted">Search visibility was not measured in this audit.</p>`;
  return page(ctx, 5, `${sectionHead(ctx, "search")}${body}${findings(ctx, "search")}`);
}

export function social(ctx: ReportContext): string {
  const s = ctx.data.social;
  const body = s?.channels.length
    ? `<table><tr><th>Channel</th><th>Account</th><th>Followers</th><th>Posts / week</th><th>Engagement</th></tr>${s.channels
        .map(
          (c) =>
            `<tr><td>${esc(c.channel)}</td><td>${t(c.handle)}</td><td>${n(c.followers)}</td><td>${c.postsPerWeek ?? "—"}</td><td>${
              c.engagementRate === undefined ? "—" : `${(c.engagementRate * 100).toFixed(1)}%`
            }</td></tr>`,
        )
        .join("")}</table><p class="muted">Cadence counts posts in the last 30 days; engagement is average interactions per post divided by followers.</p>`
    : `<p class="muted">No social profile was found on the CRM record or the website.</p>`;
  return page(ctx, 6, `${sectionHead(ctx, "social")}${body}${findings(ctx, "social")}`);
}

export function ads(ctx: ReportContext): string {
  const a = ctx.data.ads;
  const body = a
    ? `<table><tr><th>Channel</th><th>Running</th><th>Detail</th></tr>
      <tr><td>Meta (Facebook, Instagram)</td><td>${a.meta ? yes(a.meta.activeAds > 0) : "Not read"}</td><td>${
        a.meta ? `${a.meta.activeAds} active ads${a.meta.oldestDays ? `, oldest ${a.meta.oldestDays} days` : ""}` : ""
      }</td></tr>
      <tr><td>Google Ads</td><td>${a.google ? yes(a.google.ads > 0) : "Not read"}</td><td>${
        a.google ? `${a.google.ads} ads${a.google.formats.length ? ` (${esc(a.google.formats.join(", "))})` : ""}` : ""
      }</td></tr>
      <tr><td>TikTok</td><td>—</td><td>TikTok's ad library does not cover Saudi Arabia</td></tr></table>`
    : `<p class="muted">Paid ads were not measured in this audit.</p>`;
  return page(ctx, 7, `${sectionHead(ctx, "ads")}${body}${findings(ctx, "ads")}`);
}

export function tracking(ctx: ReportContext): string {
  const tr = ctx.data.website?.trackers;
  const body = tr
    ? `<table><tr><th>Tag</th><th>Installed</th><th>What it enables</th></tr>
      <tr><td>Meta pixel</td><td>${yes(tr.metaPixel)}</td><td>Retargeting and conversion-optimised Meta campaigns</td></tr>
      <tr><td>Google Analytics 4</td><td>${yes(tr.ga4)}</td><td>Traffic and conversion measurement</td></tr>
      <tr><td>Google Tag Manager</td><td>${yes(tr.gtm)}</td><td>Adding and changing tags without developers</td></tr>
      <tr><td>TikTok pixel</td><td>${yes(tr.tiktokPixel)}</td><td>TikTok retargeting and conversion campaigns</td></tr>
      <tr><td>Snap pixel</td><td>${yes(tr.snapPixel)}</td><td>Snapchat campaigns, strong in Saudi Arabia</td></tr></table>`
    : `<p class="muted">Tracking was not measured in this audit.</p>`;
  return page(ctx, 8, `${sectionHead(ctx, "tracking")}${body}${findings(ctx, "tracking")}`);
}

export function opportunities(ctx: ReportContext): string {
  const list = ctx.audit.analysis?.opportunities ?? [];
  return page(
    ctx,
    9,
    `<h2>Top opportunities</h2><p class="lead">Ordered by expected impact, each mapped to the Zain team that delivers it.</p>
    <table><tr><th>Opportunity</th><th>Zain service</th><th>Impact</th><th>Effort</th></tr>${list
      .map((o) => `<tr><td>${t(o.title)}</td><td>${esc(o.service)}</td><td><span class="pill ${o.impact}">${o.impact}</span></td><td>${o.effort}</td></tr>`)
      .join("")}</table>`,
  );
}

export function nextSteps(ctx: ReportContext): string {
  const top = (ctx.audit.analysis?.opportunities ?? []).slice(0, 3);
  return page(
    ctx,
    10,
    `<h2>Next steps</h2>
    <ol class="steps"><li>A 30-minute walkthrough of this audit with the Zain Growth team.</li>${top.map((o) => `<li>${t(o.title)} (${esc(o.service)}).</li>`).join("")}<li>A 90-day growth plan with targets and budget.</li></ol>
    <div class="cta"><h2>Let's talk</h2><p>${esc(ctx.contact.name)} · <a href="mailto:${esc(ctx.contact.email)}">${esc(ctx.contact.email)}</a></p><p>Zain Growth · Riyadh</p></div>`,
  );
}

export const PAGES = [cover, summary, scorecard, website, search, social, ads, tracking, opportunities, nextSteps] as const;
