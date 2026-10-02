import { AUDIT_AREA_LABELS, type BenchmarkRow } from "../../../../../shared/audits";
import { PLATFORMS, brandRun } from "../collect/search";
import { shortDate } from "../dates";
import { tagRead } from "../collect/website";
import { gaps } from "../score";
import { bottomLine, cards, esc, fmt, logo, notes, page, peerMethod, severityPill, statusPill, t, table, type ReportContext } from "./layout";

const FOCUS = ["Website and technical health", "Non-brand search demand", "Paid media and measurement", "Organic social presence", "Traffic and competitor benchmark"];

export function cover(ctx: ReportContext): string {
  const a = ctx.analysis;
  return `<section class="page">
  ${logo(ctx, "logo cover-logo")}
  <div style="position:absolute;top:226px;left:90px;width:700px">
    <div class="label">Digital Gap Audit</div>
    <h1 style="margin:22px 0 10px;font-size:44px;line-height:1.08;font-weight:700">${t(ctx.audit.prospect.name)}</h1>
    <div style="font-size:21px;font-weight:700">Digital Gap Audit</div>
    <div style="width:100px;height:3px;background:var(--mint);margin:20px 0 26px"></div>
    <p style="margin:0;font-size:12.5px;line-height:1.55;color:var(--body)">${t(a.coverLine)}</p>
    <div style="margin-top:44px;font-size:9.5px;font-weight:700">Prepared by Zain Growth</div>
    <div style="margin-top:8px;font-size:8.5px;color:var(--faint)">${esc(ctx.month)} | Confidential</div>
  </div>
  <div class="box panel" style="position:absolute;top:126px;right:75px;width:372px;height:368px;padding:34px 34px">
    <div class="label">Report focus</div>
    ${FOCUS.map((f, i) => `<div style="display:flex;gap:42px;margin-top:${i ? 26 : 26}px;font-size:9.5px;color:var(--body)"><span style="color:var(--green);font-weight:700;font-size:8px">0${i + 1}</span>${f}</div>`).join("")}
  </div>
  <div style="position:absolute;top:512px;right:75px;width:372px;min-height:56px;border:1.5px solid var(--mint);border-radius:12px;background:var(--tint-green);display:flex;align-items:center;justify-content:center;text-align:center;padding:10px 30px;font-size:9.5px;font-weight:700;color:var(--green-dark)">${t(a.goal)}</div>
  <footer><span>CONFIDENTIAL &nbsp;|&nbsp; DIGITAL GAP AUDIT</span><span>1</span></footer>
</section>`;
}

function kpi(label: string, value: string, note: string, color: string): string {
  return `<div class="box" style="padding:16px 20px;height:86px"><div style="font-size:9px;font-weight:600;color:var(--body)">${esc(label)}</div><div style="font-size:24px;font-weight:700;color:${color};margin-top:14px;line-height:1">${esc(value)}</div><div style="font-size:7px;color:var(--faint);margin-top:4px">${esc(note)}</div></div>`;
}

export function summary(ctx: ReportContext): string {
  const s = ctx.audit.score!;
  const a = ctx.analysis;
  const open = gaps(s);
  const critical = open.filter((g) => g.severity === "critical");
  const traffic = ctx.data.ads?.traffic[ctx.host];
  const unmeasured = 7 - s.areasMeasured;
  const body = `<div class="body">
    <div style="position:absolute;left:0;top:0;width:590px">
      <div class="label">What we found</div>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.45;font-weight:700">${t(a.executiveSummary)}</p>
    </div>
    <div style="position:absolute;right:0;top:-8px;width:410px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
      ${kpi("Gaps identified", String(open.length), "from public data, this pass", "var(--green)")}
      ${kpi("Rated Critical", String(critical.length), critical.length ? critical.map((c) => AUDIT_AREA_LABELS[c.area].split(" ")[0]!.toLowerCase()).join(", ") : "none this pass", "var(--green)")}
      ${kpi("Areas measured", `${s.areasMeasured} of 7`, unmeasured ? `${unmeasured} not measurable this pass` : "all seven measured", "var(--purple)")}
      ${kpi("Est. monthly visits", traffic ? `~${fmt(traffic.monthlyVisits)}` : "—", traffic ? `estimated (Similarweb, ${traffic.period})` : "not measured this pass", "var(--blue)")}
    </div>
  </div>`;
  return page(ctx, 2, "Executive Summary", a.headline, body, `${cards(a.keyPoints)}${bottomLine(a.bottomLines.summary ? `Bottom line: ${a.bottomLines.summary}` : "")}`);
}

export function areas(ctx: ReportContext): string {
  const rows = ctx.audit.score!.areas.map((a) => {
    // The date is on every page already; the source column keeps the kind and the tool, as the template does.
    const kinds = [...new Set(a.evidence.map((e) => `${e.kind === "not-measured" ? "not measured" : e.kind} (${e.source.replace(/, \d{1,2} \w{3} \d{4}$/, "")})`))].slice(0, 2).join(" / ");
    return `<tr><td class="name" style="width:230px">${esc(AUDIT_AREA_LABELS[a.area])}</td><td style="width:110px">${statusPill(a)}</td><td style="width:100px">${severityPill(a)}</td><td style="font-size:9px">${t(a.summary)}</td><td style="width:150px;font-size:7.5px;line-height:1.35;color:var(--faint)">${esc(kinds)}</td></tr>`;
  });
  const body = `<div class="body" style="top:208px;bottom:110px"><div class="box areas" style="padding:12px 16px;height:100%"><table style="height:100%"><tbody>${rows.join("")}</tbody></table></div>
  <div style="margin-top:12px;font-size:7px;color:var(--faint)">Strong: nothing material missing. Fair: real gaps, fixable inside a programme. Weak: the area is missing or broken. Not measured: no public evidence either way, this pass.</div></div>`;
  return page(ctx, 3, "The Seven Areas, At a Glance", "Status and severity from what public data actually showed this pass.", body);
}

export function visitor(ctx: ReportContext): string {
  const w = ctx.data.website;
  const issue = ctx.data.seo?.read.issues[0];
  const items = [
    w?.platform ? { title: `${w.platform} site`, detail: `The site runs on ${w.platform} (quoted, ${ctx.src.crawl}).` } : { title: "Custom-built site", detail: `No common store or CMS platform was detected (quoted, ${ctx.src.crawl}).` },
    w?.policyPages.length
      ? { title: "Policy pages in place", detail: `${w.policyPages.slice(0, 3).join(", ")} are linked from the site (quoted).` }
      : { title: "No policy pages found", detail: "No shipping, returns, privacy or terms page was linked from the crawled pages (quoted)." },
    issue ? { title: issue.title, detail: `Flagged by the technical read${issue.count ? ` (${issue.count})` : ""} (estimated, ${ctx.src.semrush}).` } : { title: "No major technical flags", detail: "The technical read raised no high-severity issue this pass." },
    w?.contactPaths.length
      ? { title: "Ways to get in touch", detail: `${w.contactPaths.join(", ").replace(/^./, (c) => c.toUpperCase())} reachable from the site (quoted).` }
      : { title: "No direct contact path", detail: "No WhatsApp, phone, email or form was found on the crawled pages (quoted)." },
  ];
  const shot = ctx.screenshot
    ? `<img src="${ctx.screenshot}" alt="Mobile home page" style="height:300px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08)"><div style="margin-top:8px;font-size:7.5px;color:var(--faint);text-align:center">${esc(ctx.host)} home page, mobile, ${esc(ctx.day)}</div>`
    : `<div style="font-size:10px;color:var(--faint)">Mobile capture not available this pass.</div>`;
  const body = `<div class="body"><div class="box panel" style="position:absolute;left:0;top:0;width:640px;height:440px;display:flex;flex-direction:column;align-items:center;justify-content:center">${shot}</div>
    <div class="box" style="position:absolute;right:0;top:0;width:460px;height:440px"><div class="notes">${notes(items)}</div></div></div>`;
  return page(ctx, 4, "What a Visitor Sees", "The home page, captured on mobile.", body);
}

export function technical(ctx: ReportContext): string {
  const tr = ctx.data.website?.trackers;
  const tags = tr ? tagRead(tr) : [];
  const g = ctx.data.ads?.google[ctx.host];
  const spending = (g && g !== "none" && g.active > 0) || ctx.data.ads?.meta[ctx.host] !== "none";
  const why: { title: string; detail: string }[] = [];
  if (tr && !tr.ga4 && !tr.gtm) why.push({ title: spending ? "Spend without sight" : "No analytics foundation", detail: "With no GA4 or Google Tag Manager on the page there is no independent read on what traffic and spend actually return." });
  if (tr && (!tr.metaPixel || !tr.tiktokPixel || !tr.snapPixel)) {
    const missing = [!tr.metaPixel && "Meta", !tr.tiktokPixel && "TikTok", !tr.snapPixel && "Snap"].filter(Boolean).join(", ");
    why.push({ title: "No cross-platform matching", detail: `${missing} pixels are absent, so those channels cannot be tested or optimised on conversion data if opened later.` });
  }
  const issue = ctx.data.seo?.read.issues.find((i) => i.severity === "high" || i.severity === "critical");
  if (issue) why.push({ title: "A crawlability risk", detail: `${issue.title}: it can quietly cap how well pages rank (estimated, Semrush).` });
  if (!why.length) why.push({ title: "A solid tag base", detail: "The core tags are in place; the next step is checking they fire on the right events." });
  const body = `<div class="body" style="top:208px">
    <div class="box panel" style="position:absolute;left:0;top:0;width:620px;height:440px;padding:30px 32px">
      <div class="label">What's on the page</div><div style="font-size:15px;font-weight:700;margin:8px 0 18px">Tag and technical read</div>
      ${tags.length ? tags.map((x) => `<div style="font-size:9.5px;color:var(--body);margin-bottom:12px">${esc(x.tag)}: ${x.found ? "found" : "not found on the page"}</div>`).join("") : `<div style="font-size:10px;color:var(--faint)">The tag read was not available this pass.</div>`}
      <div style="position:absolute;bottom:18px;left:32px;font-size:7px;color:var(--faint)">Source: ${esc(ctx.src.crawl)}${ctx.data.seo ? `; ${esc(ctx.src.semrush)}` : ""}.</div>
    </div>
    <div class="box" style="position:absolute;right:0;top:0;width:484px;height:440px;padding:28px 30px">
      <div style="font-size:17px;font-weight:700;margin-bottom:16px">Why it matters</div>
      <div style="display:flex;flex-direction:column;gap:18px">${notes(why.slice(0, 3))}</div>
      <div style="position:absolute;left:24px;right:24px;bottom:22px;border:1px solid var(--line);border-radius:10px;padding:12px 24px;text-align:center;font-size:9.5px;font-weight:700">Priority fix: ${t(ctx.analysis.fix[0]?.detail ?? "")}</div>
    </div></div>`;
  return page(ctx, 5, "Website and Technical", "", body);
}

export function search(ctx: ReportContext): string {
  const runs = ctx.audit.searchRuns ?? [];
  const brand = brandRun(runs);
  const category = runs.filter((r) => r.kind === "category");
  const inCategory = category.filter((r) => r.prospectPresent);
  // Who did show up, without marketplaces and social networks.
  const shownUp = [...new Set(category.flatMap((r) => r.others))].filter((d) => !PLATFORMS.test(d)).slice(0, 2);
  const rows = runs.map((r) => [
    r.kind === "brand" ? `${t(r.query)} (brand)` : t(r.query),
    r.prospectPresent ? "Yes" : "No",
    r.others.length ? esc(r.others.slice(0, 3).join(", ")) : r.kind === "brand" ? "The brand's own channels" : "—",
  ]);
  const seo = ctx.data.seo;
  const traffic = ctx.data.ads?.traffic ?? {};
  const lane = (ctx.data.competitors ?? []).map((c) => ({ c, t: traffic[c.domain] })).filter((x) => x.t?.organicShare !== undefined).sort((a, b) => b.t!.organicShare! - a.t!.organicShare!)[0];
  const items = [
    brand?.prospectPresent
      ? { title: "Brand owned", detail: "Yes — a plain search for the name returns the official site or its verified profiles (quoted)." }
      : { title: "Brand not owned", detail: `A plain search for "${ctx.audit.prospect.name}" does not return the official site (quoted).` },
    inCategory.length
      ? { title: "Category entered", detail: `Present in ${inCategory.length} of ${category.length} live category searches (quoted).` }
      : { title: "Category not entered", detail: `${ctx.host} did not appear in ${category.length} live category searches${shownUp.length ? `; ${shownUp.join(" and ")} did` : ""} (quoted).` },
    lane
      ? { title: "The keyword lane", detail: `${lane.c.domain} draws an estimated ${Math.round(lane.t!.organicShare! * 100)}% of its traffic from organic search (Similarweb) — evidence the category is winnable.` }
      : { title: "The keyword lane", detail: seo ? `${fmt(seo.read.organicKeywords)} ranking keywords and ~${fmt(seo.read.organicTraffic)} organic visits a month (estimated, Semrush).` : "Organic search share could not be estimated this pass." },
  ];
  const body = `<div class="body compact">${table(["Search run", `${ctx.host} present?`, "Who else appears"], rows, `Source: ${ctx.src.search}.`, -1, ["38%", "24%", "38%"])}</div>`;
  return page(ctx, 6, "Search: Brand vs Category", "Each row is one live search run this pass.", body, `${cards(items)}${bottomLine(ctx.analysis.bottomLines.search)}`);
}

/** A zero count never comes with formats: "None active (last seen …)" when older ads exist. */
const googleCell = (r: BenchmarkRow, ctx?: ReportContext) => {
  if (r.googleAds === "none") return "None found";
  if (!r.googleAds || r.googleAds === "not-measured") return "Not measured";
  if (r.googleAds.active === 0) {
    const g = r.domain ? ctx?.data.ads?.google[r.domain] : undefined;
    const last = g && g !== "none" ? g.lastSeen : undefined;
    return last ? `None active (last seen ${esc(shortDate(last))})` : "None active";
  }
  return `${r.googleAds.active} active${r.googleAds.formats ? `, ${esc(r.googleAds.formats)}` : ""}${r.googleAds.since ? `, since ${esc(r.googleAds.since)}` : ""}`;
};
const metaCell = (r: BenchmarkRow) =>
  r.metaAds === "none" ? "None attributable" : !r.metaAds || r.metaAds === "not-measured" ? "Not measured" : `${r.metaAds.active} active${r.metaAds.note ? ` (${t(r.metaAds.note)} page)` : ""}`;

export function paid(ctx: ReportContext): string {
  const rows = ctx.audit.benchmark ?? [];
  const googleOn = rows.filter((r) => typeof r.googleAds === "object" && r.googleAds.active > 0);
  const metaOn = rows.filter((r) => typeof r.metaAds === "object" && r.metaAds.active > 0);
  const tr = ctx.data.website?.trackers;
  const items = [
    { title: googleOn.length > 1 ? "Google is contested" : googleOn.length ? "Google has one player" : "Google is open", detail: `${googleOn.length} of ${rows.length} businesses run active Google ads in the Transparency Center right now (quoted).` },
    { title: metaOn.length > 1 ? "Meta is contested" : "Meta is mostly open", detail: `${metaOn.length} of ${rows.length} show active Meta ads attributable to their own page this pass (quoted).` },
    tr && !tr.ga4 && !tr.gtm
      ? { title: "Spend without full tracking", detail: "The prospect's paid traffic lands on pages without GA4 or GTM (see Website and Technical)." }
      : { title: "Tracking in place", detail: "Paid traffic lands on pages with analytics tags; conversion events still need checking." },
  ];
  const body = `<div class="body">${table(
    ["Business", "Google Ads (Transparency Center)", "Meta Ads (Ad Library)"],
    rows.map((r) => [t(r.name), googleCell(r, ctx), metaCell(r)]),
    `Source: ${ctx.src.googleAds}; ${ctx.src.meta}. Meta counts are keyword-matched; a page not clearly the brand is left out.`,
    0,
    ["24%", "40%", "36%"],
  )}</div>`;
  return page(ctx, 7, "Paid Media: Google and Meta", `Prospect first, then Saudi competitors ${peerMethod(ctx)}, same public measures.`, body, `${cards(items)}${bottomLine(ctx.analysis.bottomLines.paid)}`);
}

export { googleCell, metaCell };
