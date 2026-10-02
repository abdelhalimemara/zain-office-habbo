import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ProspectAudit } from "../../../../../shared/audits";
import type { CollectedData } from "../types";
import { PAGES, esc, type ReportContext } from "./partials";

const dir = fileURLToPath(new URL(".", import.meta.url));
const FONTS =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=Inter:wght@400;600;700;800&display=block";

export const CONTACT = { name: "Ahmad, Zain Group", email: "ahmad@zain-studio.com" };

let assets: { css: string; logo: string } | null = null;
function brand(): { css: string; logo: string } {
  assets ??= { css: readFileSync(`${dir}brand.css`, "utf8"), logo: readFileSync(`${dir}logo.svg`, "utf8").trim() };
  return assets;
}

/** The whole report as one self-contained HTML document (fonts from Google Fonts). */
export function renderReport(audit: ProspectAudit, data: CollectedData, at = new Date()): string {
  const { css, logo } = brand();
  const ctx: ReportContext = {
    audit,
    data,
    logo,
    date: at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    contact: CONTACT,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Zain Growth audit · ${esc(audit.prospect.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}"><style>${css}</style></head>
<body>${PAGES.map((p) => p(ctx)).join("\n")}</body></html>`;
}
