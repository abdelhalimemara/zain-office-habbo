import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditAnalysis, ProspectAudit } from "../../../../../shared/audits";
import { monthYear, shortDate } from "../dates";
import { sources } from "../score";
import { siteHost } from "../url";
import type { CollectedData } from "../types";
import { esc, type ReportContext } from "./layout";
import { closing, competitive, fixPage, gapsPage, reputation, social, traffic } from "./pagesBack";
import { areas, cover, paid, search, summary, technical, visitor } from "./pagesFront";

const dir = fileURLToPath(new URL(".", import.meta.url));
const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=block";

/** The founder's brand folder, outside the (public) repo; ZAIN_BRAND_DIR overrides it. */
export const DEFAULT_BRAND_DIR = "/Users/abdelhalimemara/Desktop/Zain Studio/Zain_Documents/zain_brand_assets 2";
export const GROWTH_LOGO = join("zain_growth", "01_logo_png", "zain_growth_full_transparent_1024w.png");

export const PAGES = [cover, summary, areas, visitor, technical, search, paid, social, traffic, reputation, competitive, gapsPage, fixPage, closing] as const;

let css: string | null = null;

/** The Zain Growth logo as a data: URI, read at render time; null (text logo) when the file is missing. */
export function brandLogo(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    return `data:image/png;base64,${readFileSync(join(env.ZAIN_BRAND_DIR || DEFAULT_BRAND_DIR, GROWTH_LOGO)).toString("base64")}`;
  } catch {
    return null;
  }
}

export interface RenderOptions {
  at?: Date;
  logo?: string | null;
  /** The mobile capture as a data: URI. */
  screenshot?: string | null;
}

/** The fourteen-page Digital Gap Audit as one self-contained HTML document (fonts from Google Fonts). */
export function renderReport(audit: ProspectAudit, data: CollectedData, analysis: AuditAnalysis, opts: RenderOptions = {}): string {
  css ??= readFileSync(`${dir}brand.css`, "utf8");
  const at = opts.at ?? new Date(audit.createdAt * 1000);
  const day = shortDate(at);
  const ctx: ReportContext = {
    audit,
    data,
    analysis,
    logo: opts.logo === undefined ? brandLogo() : opts.logo,
    screenshot: opts.screenshot ?? null,
    month: monthYear(at),
    day,
    src: sources(data.asOf ?? day),
    host: siteHost(audit.prospect.website),
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(audit.prospect.name)} · Digital Gap Audit · Zain Growth</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}"><style>${css}</style></head>
<body>${PAGES.map((p) => p(ctx)).join("\n")}</body></html>`;
}
