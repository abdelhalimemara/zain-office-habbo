import { AUDIT_AREA_LABELS } from "../../../../../shared/audits";
import { shortDate } from "../dates";
import { bottomLine, cards, esc, fmt, logo, page, pct, pill, t, table, type ReportContext } from "./layout";
import { googleCell, metaCell } from "./pagesFront";

const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", x: "X / Twitter", linkedin: "LinkedIn", youtube: "YouTube", snapchat: "Snapchat" };
const dayLabel = (iso: string | undefined) => (iso ? shortDate(iso) : "—");

export function social(ctx: ReportContext): string {
  const rows = ctx.audit.social ?? [];
  const measured = rows.filter((r) => r.measured);
  const lead = measured.sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))[0];
  const table1 = rows.map((r) =>
    r.measured
      ? [CHANNEL_LABEL[r.channel]!, fmt(r.followers), fmt(r.posts), r.postsPer30Days === undefined ? "—" : String(r.postsPer30Days), r.engagement === undefined ? "—" : pct(r.engagement, 2), dayLabel(r.lastPost)]
      : [CHANNEL_LABEL[r.channel]!, `<span class="dim">not measured (not found this pass)</span>`, "—", "—", "—", "—"],
  );
  const benchmark = (ctx.audit.benchmark ?? []).filter((b) => !b.isProspect && typeof b.instagramFollowers === "number");
  const items = [
    lead
      ? { title: "The live channel", detail: `${CHANNEL_LABEL[lead.channel]}: ${fmt(lead.followers)} followers, ${lead.postsPer30Days ?? 0} posts in the last 30 days, ${pct(lead.engagement, 2)} engagement on the sample.` }
      : { title: "No measured channel", detail: "No social profile could be confirmed and measured this pass." },
    benchmark.length
      ? { title: "Benchmark", detail: benchmark.map((b) => `${b.name}: ${fmt(b.instagramFollowers as number)} Instagram followers`).join("; ") + " (quoted)." }
      : { title: "Benchmark", detail: "Competitors' Instagram accounts were not found or measured this pass." },
    { title: "Unconfirmed channels", detail: `${rows.filter((r) => !r.measured).map((r) => CHANNEL_LABEL[r.channel]).join(", ") || "None"}: not measured this pass — not measured, not zero.` },
  ];
  const body = `<div class="body compact" style="bottom:auto">${table(
    ["Channel", "Followers", "Posts", "Posts / 30 days", "Engagement (sample)", "Last post"],
    table1,
    `Source: ${ctx.src.social}. Engagement is average likes and comments per sampled post, divided by followers.`,
    -1,
    ["16%", "22%", "10%", "14%", "22%", "16%"],
  )}</div>`;
  const sub = lead ? `${CHANNEL_LABEL[lead.channel]} is the strongest channel measured this pass.` : "No channel could be measured this pass.";
  return page(ctx, 8, "Organic Social", sub, body, `${cards(items)}${bottomLine(ctx.analysis.bottomLines.social)}`);
}

export function traffic(ctx: ReportContext): string {
  const rows = ctx.audit.benchmark ?? [];
  const withTraffic = rows.filter((r) => typeof r.traffic === "object");
  const period = withTraffic.map((r) => (r.traffic as { period: string }).period)[0] ?? "latest";
  const visits = (r: (typeof rows)[number]) => (typeof r.traffic === "object" ? r.traffic.monthlyVisits : 0);
  const leader = [...withTraffic].sort((a, b) => visits(b) - visits(a))[0];
  const me = rows[0];
  const own = ctx.data.ads?.traffic[ctx.host];
  const items = [
    leader && me && leader !== me
      ? { title: `${leader.name} leads`, detail: `An estimated ${fmt(visits(leader))} monthly visits against ${me.name}'s ${fmt(visits(me))}${leader.organicTraffic !== undefined ? `; Semrush puts its organic traffic at ~${fmt(leader.organicTraffic)}` : ""}.` }
      : { title: me && leader === me ? `${me.name} leads` : "Traffic", detail: leader ? `${me?.name} draws the most estimated visits in this set.` : "No traffic estimate was available this pass." },
    { title: "Paid share", detail: own?.paidShare !== undefined ? `An estimated ${pct(own.paidShare)} of ${me?.name}'s visits come from paid search (Similarweb).` : "The paid share of traffic could not be estimated this pass." },
    { title: "Same caveat for all", detail: "Every figure here is a third-party estimate, useful for ranking the businesses against each other, not as a hard number." },
  ];
  const cell = (r: (typeof rows)[number]) =>
    typeof r.traffic === "object"
      ? [`~${fmt(r.traffic.monthlyVisits)} (est.)`, pct(r.traffic.bounceRate), esc(r.traffic.topSource ?? "—"), r.traffic.saudiShare === undefined ? "—" : `${pct(r.traffic.saudiShare)} (est.)`]
      : ["not measured", "—", "—", "—"];
  const body = `<div class="body">${table(
    ["Business", `Est. monthly visits (${period})`, "Bounce rate", "Top source", "Saudi share", "Organic (Semrush)", "Authority"],
    rows.map((r) => [t(r.name), ...cell(r), r.organicTraffic === undefined ? "—" : `~${fmt(r.organicTraffic)}`, r.authorityScore === undefined ? "—" : String(r.authorityScore)]),
    `Estimated: Similarweb via Apify (${period}) and ${ctx.src.semrush}. Small domains sit near the reliable-measurement threshold; treat as directional, not exact.`,
    0,
    ["17%", "17%", "11%", "20%", "12%", "13%", "10%"],
  )}</div>`;
  return page(ctx, 9, "Traffic (Similarweb Estimates)", "Third-party estimates, not the sites' own analytics — directional only.", body, `${cards(items)}${bottomLine(ctx.analysis.bottomLines.traffic)}`);
}

export function reputation(ctx: ReportContext): string {
  const maps = ctx.data.ads?.maps;
  const w = ctx.data.website;
  const mapsText =
    maps === undefined ? "Not measured — the Maps lookup did not run this pass" : maps === "none" ? "Not measured — no listing matched the business name" : `${maps.rating?.toFixed(1) ?? "—"} stars from ${fmt(maps.reviews)} reviews${maps.category ? ` (${esc(maps.category)})` : ""}`;
  const rows = [
    ["Google Maps listing (rating, review count)", mapsText],
    ["On-site customer reviews", w ? (w.reviewsOnSite ? `Customer reviews appear on ${esc(ctx.host)}'s own pages (self-published, not independent)` : "None found on the crawled pages") : "Not measured"],
    ["Trust / policy pages on-site", w ? (w.policyPages.length ? `${esc(w.policyPages.slice(0, 3).join(", "))} (quoted)` : "None found on the crawled pages") : "Not measured"],
    ["App-store presence", "Not measured this pass"],
  ];
  const measured = typeof maps === "object";
  const items = [
    measured
      ? { title: (maps.rating ?? 0) >= 4.5 ? "Strong rating" : "Rating to build", detail: `${maps.rating?.toFixed(1)} stars from ${fmt(maps.reviews)} Google reviews${(maps.reviews ?? 0) < 20 ? " — a thin base that a review programme can grow quickly" : ""}.` }
      : { title: "Not measured, not zero", detail: "No independent rating or review count could be pulled this pass — a coverage gap, not a finding of low reputation." },
    { title: "What is visible", detail: w ? `${w.reviewsOnSite ? "The site carries customer reviews" : "The site carries no review section"}${w.policyPages.length ? " and standard policy pages" : ""}.` : "The site could not be read this pass." },
  ];
  const sub = measured ? "Independent reputation signals, as public data showed them this pass." : "Mostly not measured this pass — shown here as coverage, not a finding.";
  const body = `<div class="body">${table(["Signal", "Status"], rows.map(([a, b]) => [esc(a), b!]), `Source: ${ctx.src.maps}; ${ctx.src.crawl}.`, -1, ["32%", "68%"])}</div>`;
  return page(ctx, 10, "Reputation and Local", sub, body, cards(items, 82));
}

export function competitive(ctx: ReportContext): string {
  const rows = ctx.audit.benchmark ?? [];
  const me = rows[0];
  const ig = (r: (typeof rows)[number]) => (typeof r.instagramFollowers === "number" ? fmt(r.instagramFollowers) : "not measured");
  const visits = (r: (typeof rows)[number]) => (typeof r.traffic === "object" ? `~${fmt(r.traffic.monthlyVisits)} (est.)` : "not measured");
  const googleOn = rows.filter((r) => typeof r.googleAds === "object" && r.googleAds.active > 0).length;
  const leader = [...rows].filter((r) => typeof r.traffic === "object").sort((a, b) => (b.traffic as { monthlyVisits: number }).monthlyVisits - (a.traffic as { monthlyVisits: number }).monthlyVisits)[0];
  const igLeader = [...rows].filter((r) => typeof r.instagramFollowers === "number").sort((a, b) => (b.instagramFollowers as number) - (a.instagramFollowers as number))[0];
  const items = [
    { title: googleOn === rows.length ? "Google: everyone is in" : `Google: ${googleOn} of ${rows.length} active`, detail: `${googleOn} of the ${rows.length} businesses run active Google ads right now (quoted, Ads Transparency Center).` },
    leader ? { title: `Traffic: ${leader.name} ${leader === me ? "leads" : "is ahead"}`, detail: `An estimated ${visits(leader).replace(" (est.)", "")} monthly visits (Similarweb).` } : { title: "Traffic", detail: "Not measured this pass." },
    igLeader ? { title: `Instagram: ${igLeader.name} leads`, detail: `${ig(igLeader)} followers; engagement and Meta activity complete the picture (see Organic Social and Paid Media).` } : { title: "Social", detail: "Instagram followers were not measured for this set." },
  ];
  const body = `<div class="body">${table(
    ["Business", "Google Ads", "Meta Ads", "Instagram followers", "Est. monthly visits", "Authority (Semrush)"],
    rows.map((r) => [t(r.name), googleCell(r, ctx).split(",")[0]!, metaCell(r).replace(/\s\(.*$/, ""), ig(r), visits(r), r.authorityScore === undefined ? "—" : String(r.authorityScore)]),
    `Sources as on the previous pages, ${ctx.day}.`,
    0,
  )}</div>`;
  return page(ctx, 11, "The Competitive Gap", `${me?.name ?? "The prospect"} first, against the closest Saudi competitors, same public measures.`, body, `${cards(items)}${bottomLine(ctx.analysis.bottomLines.competitive)}`);
}

export function gapsPage(ctx: ReportContext): string {
  const findings = ctx.analysis.findings.slice(0, 6);
  const notMeasured = ctx.audit.score!.areas.filter((a) => a.status === "not-measured").map((a) => AUDIT_AREA_LABELS[a.area]);
  const grid = findings
    .map(
      (f, i) =>
        `<div class="box" style="padding:18px 22px;height:98px;position:relative"><div style="display:flex;gap:22px"><span style="color:var(--green);font-weight:700;font-size:8px;margin-top:3px">0${i + 1}</span><div style="flex:1"><div style="font-size:12px;font-weight:700;margin-bottom:6px;padding-right:70px">${t(f.title)}</div><div style="font-size:8.5px;line-height:1.45;color:var(--body)">${t(f.detail)}</div></div></div><div style="position:absolute;top:16px;right:18px">${pill(f.severity)}</div></div>`,
    )
    .join("");
  const sub = `Ordered by severity.${notMeasured.length ? ` Not measured this pass: ${notMeasured.join(", ")} (see the scorecard for why).` : ""}`;
  const body = `<div class="body" style="bottom:150px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 18px">${grid || `<div style="font-size:11px;color:var(--muted)">No material gaps in the measured areas.</div>`}</div></div>`;
  return page(ctx, 12, "The Gaps", sub, body, bottomLine(notMeasured.length ? `Not measured this pass: ${notMeasured.join(", ")}.` : "All seven areas were measured this pass."));
}

export function fixPage(ctx: ReportContext): string {
  const a = ctx.analysis;
  const phases = a.fix
    .map(
      (f, i) =>
        `<div class="box" style="height:286px;padding:20px 28px;text-align:center;${i === 1 ? "background:var(--panel)" : "background:var(--tint-green);border:1.5px solid var(--mint)"}"><div style="font-size:8px;font-weight:700;color:var(--green)">Phase ${f.phase} · ${esc(f.name)}</div><div style="font-size:16px;font-weight:700;margin:34px 0 16px">${t(f.headline)}</div><div style="font-size:9px;line-height:1.5;color:var(--body)">${t(f.detail)}</div></div>`,
    )
    .join("");
  const body = `<div class="body" style="top:208px"><div class="cards">${phases}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:22px">
      <div class="box panel" style="display:flex;gap:40px;align-items:center;padding:16px 22px;height:76px"><b style="font-size:11px;width:110px">North Star</b><span style="font-size:8.5px;color:var(--muted)">${t(a.northStar)}</span></div>
      <div class="box" style="display:flex;gap:40px;align-items:center;padding:16px 22px;height:76px;background:var(--tint-green);border:1.5px solid var(--mint)"><b style="font-size:11px;width:110px;color:var(--green-dark)">Next step</b><span style="font-size:8.5px;color:var(--green-dark)">${t(a.nextStep)}</span></div>
    </div></div>`;
  return page(ctx, 13, "The Fix: Foundation Before More Spend", "Sequence matters: see what the current spend returns, fix what blocks the crawl, then open the category and channels still sitting empty.", body);
}

export function closing(ctx: ReportContext): string {
  const a = ctx.analysis;
  return `<section class="page">
  ${logo(ctx)}
  <div style="position:absolute;top:232px;left:93px;width:680px">
    <div class="label">Next step</div>
    <div style="margin:26px 0 22px;font-size:32px;line-height:1.25;font-weight:700">${t(a.closingHeadline)}</div>
    <p style="margin:0;font-size:11px;line-height:1.55;color:var(--body)">${t(a.bottomLines.close || a.pitchAngle)}</p>
    ${a.closingSteps.map((s, i) => `<div style="display:flex;gap:44px;margin-top:${i ? 26 : 34}px;font-size:12px;font-weight:700"><span style="color:var(--green);font-size:8px;margin-top:3px">0${i + 1}</span>${t(s)}</div>`).join("")}
    <div style="margin-top:12px;font-size:14px;font-weight:700;color:var(--green)">Thank you</div>
  </div>
  <div style="position:absolute;top:240px;right:80px;width:400px;height:346px;border-radius:16px;background:var(--night);color:#fff;text-align:center;padding-top:62px">
    <div style="font-size:8.5px">Prepared by</div>
    <div style="height:104px;margin:22px auto 0;display:flex;justify-content:center">${ctx.logo ? `<img src="${ctx.logo}" alt="Zain Growth" style="height:100%">` : `<div style="font-size:40px;font-weight:700;color:var(--brand);line-height:1.05">Zain<br>Growth</div>`}</div>
    <div style="margin-top:62px;font-size:10px;font-weight:700">Digital Gap Audit</div>
    <div style="margin-top:14px;font-size:7.5px;opacity:.85">Confidential report for ${t(ctx.audit.prospect.name)} · prepared by Zain Growth</div>
  </div>
  <footer><span>CONFIDENTIAL &nbsp;|&nbsp; DIGITAL GAP AUDIT</span><span>14</span></footer>
</section>`;
}
