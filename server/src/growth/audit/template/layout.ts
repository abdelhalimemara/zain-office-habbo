import type { AreaResult, AuditAnalysis, ProspectAudit } from "../../../../../shared/audits";
import type { Sources } from "../score";
import type { CollectedData } from "../types";

/** Everything a page can use; each page function returns one 1280 x 720 page. */
export interface ReportContext {
  audit: ProspectAudit;
  data: CollectedData;
  analysis: AuditAnalysis;
  /** The Zain Growth logo as a data: URI, or null for the text logo. */
  logo: string | null;
  /** The mobile capture as a data: URI, when there is one. */
  screenshot: string | null;
  /** "September 2026" for the cover, "27 Sep 2026" in source lines. */
  month: string;
  day: string;
  src: Sources;
  host: string;
}

/** How the benchmarked competitors were found, for subtitles and source lines. */
export function peerMethod(ctx: ReportContext): string {
  const peers = ctx.data.ads ? (ctx.data.competitors ?? []) : [];
  const semrush = peers.some((c) => c.source === "semrush");
  const search = peers.some((c) => c.source === "search");
  if (semrush && search) return "found by shared keywords (Semrush, est.) and live category searches";
  if (semrush) return "found by shared keywords (Semrush, est.)";
  return "found in live category searches";
}

/** A competitor's shared keywords with the prospect (and Semrush's competition level), or how it was found. */
export function sharedKeywords(ctx: ReportContext, domain: string | undefined, withLevel = false): string {
  if (!domain || domain === ctx.host) return "—";
  const c = ctx.data.competitors?.find((x) => x.domain === domain);
  if (c?.commonKeywords !== undefined) {
    const level = withLevel && c.competitionLevel !== undefined ? `, ${Math.round(c.competitionLevel * 100)}% competition` : "";
    return `${c.commonKeywords.toLocaleString("en-US")}${level} (est.)`;
  }
  // A neighbour shares keywords with the Saudi candidate it was found through, not (measurably) with the prospect.
  return c?.via ? `via ${esc(c.via)}` : "—";
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Prospect- and competitor-supplied text may be Arabic: the browser picks the direction per element. */
export const t = (value: unknown) => `<span dir="auto">${esc(value)}</span>`;
export const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-US"));
export const pct = (share: number | undefined, digits = 1) => (share === undefined ? "—" : `${(share * 100).toFixed(digits)}%`);
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function logo(ctx: ReportContext, cls = "logo"): string {
  return `<div class="${cls}">${ctx.logo ? `<img src="${ctx.logo}" alt="Zain Growth">` : `<div class="text-logo">Zain<br>Growth</div>`}</div>`;
}

/** The template's page chrome: mint bar, logo, kicker, title, subtitle, footer with the page number. */
export function page(ctx: ReportContext, no: number, title: string, sub: string, body: string, extra = ""): string {
  return `<section class="page">
  ${logo(ctx)}<div class="kicker">DIGITAL GAP AUDIT</div>
  <h1 class="title">${esc(title)}</h1>${sub ? `<p class="sub">${t(sub)}</p>` : ""}
  ${body}${extra}
  <footer><span>CONFIDENTIAL &nbsp;|&nbsp; DIGITAL GAP AUDIT</span><span>${no}</span></footer>
</section>`;
}

export function pill(kind: string, label = cap(kind.replace("-", " "))): string {
  return `<span class="pill ${esc(kind)}">${esc(label)}</span>`;
}

export const statusPill = (a: AreaResult) => pill(a.status, a.status === "not-measured" ? "Not measured" : cap(a.status));
export const severityPill = (a: AreaResult) => (a.severity ? pill(a.severity) : "");

const TINTS = ["green", "amber", "blue"] as const;

/** The row of three (or two) numbered cards over the bottom line. */
export function cards(items: readonly { title: string; detail: string }[], bottom?: number): string {
  return `<div class="cards-row"${bottom === undefined ? "" : ` style="bottom:${bottom}px"`}><div class="cards${items.length === 2 ? " two" : ""}">${items
    .map((c, i) => `<div class="card ${TINTS[i % 3]}"><div class="dot ${TINTS[i % 3]}">0${i + 1}</div><div><h4>${t(c.title)}</h4><p>${t(c.detail)}</p></div></div>`)
    .join("")}</div></div>`;
}

export const bottomLine = (text: string | undefined) => (text ? `<div class="bottom">${t(text)}</div>` : "");

/** A bordered table; `prospectRow` tints that row like the template. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[], source: string, prospectRow = -1, widths: readonly string[] = []): string {
  return `<div class="box table"><table><thead><tr>${headers.map((h, i) => `<th${widths[i] ? ` style="width:${widths[i]}"` : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r, i) => `<tr${i === prospectRow ? ' class="prospect"' : ""}>${r.map((cell, j) => `<td${j === 0 ? ' class="name"' : ""}>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table><div class="source">${esc(source)}</div></div>`;
}

/** Numbered notes (What a Visitor Sees, Why it matters). */
export function notes(items: readonly { title: string; detail: string }[]): string {
  const dots = ["green", "amber", "blue", "purple"];
  return items.map((n, i) => `<div class="note"><div class="dot ${dots[i % 4]}">0${i + 1}</div><div><h4>${t(n.title)}</h4><p>${t(n.detail)}</p></div></div>`).join("");
}
