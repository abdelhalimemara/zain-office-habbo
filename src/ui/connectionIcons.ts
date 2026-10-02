import {
  siAirtable,
  siAnthropic,
  siDiscord,
  siFigma,
  siGithub,
  siGmail,
  siGoogle,
  siGooglecalendar,
  siGooglechat,
  siGoogledrive,
  siHubspot,
  siLinear,
  siNotion,
  siShopify,
  siSignal,
  siStripe,
  siTelegram,
  siWebflow,
  siWhatsapp,
  siZapier,
  type SimpleIcon,
} from "simple-icons";
import type { Connection } from "@shared/api";

export type ConnectionIcon =
  | { type: "brand"; brand: string; path: string; hex: string }
  | { type: "mail" }
  | { type: "monogram"; letter: string; hermes?: boolean };

export interface ConnectionIconSpec {
  icon: ConnectionIcon;
  /** Small secondary glyph that tells apart connections sharing a brand (e.g. Telegram approvals). */
  badge?: "approvals";
}

function brand(icon: SimpleIcon): ConnectionIcon {
  return { type: "brand", brand: icon.title, path: icon.path, hex: `#${icon.hex}` };
}

/** First match wins; tested against "<id> <name>" in lower case. */
const BRANDS: readonly [RegExp, ConnectionIcon][] = [
  [/telegram/, brand(siTelegram)],
  [/whatsapp/, brand(siWhatsapp)],
  [/gmail/, brand(siGmail)],
  [/google[ _-]?chat/, brand(siGooglechat)],
  [/google[ _-]?drive/, brand(siGoogledrive)],
  [/google[ _-]?calendar/, brand(siGooglecalendar)],
  [/google|gws\b/, brand(siGoogle)],
  [/\bemail\b|\bmail\b/, { type: "mail" }],
  [/discord/, brand(siDiscord)],
  [/signal/, brand(siSignal)],
  [/notion|\bntn\b/, brand(siNotion)],
  [/github|\bgh\b/, brand(siGithub)],
  [/webflow/, brand(siWebflow)],
  [/figma/, brand(siFigma)],
  [/linear/, brand(siLinear)],
  [/airtable/, brand(siAirtable)],
  [/zapier/, brand(siZapier)],
  [/stripe/, brand(siStripe)],
  [/hubspot/, brand(siHubspot)],
  [/shopify/, brand(siShopify)],
  [/anthropic|claude/, brand(siAnthropic)],
];

function monogram(name: string): ConnectionIcon {
  const letter = name.trim().match(/[A-Za-z0-9]/)?.[0] ?? "?";
  return { type: "monogram", letter: letter.toUpperCase() };
}

/** The logo for a connection: a brand mark where simple-icons has one, else a lettered tile. */
export function connectionIcon(c: Pick<Connection, "id" | "name">): ConnectionIconSpec {
  const key = `${c.id} ${c.name}`.toLowerCase();
  const badge = /telegram[ _-]?approvals/.test(key) ? ("approvals" as const) : undefined;
  if (/^channel:gateway\b|^cli:hermes\b/.test(c.id) || /^hermes\b/i.test(c.name)) {
    return { icon: { type: "monogram", letter: "H", hermes: true } };
  }
  const match = BRANDS.find(([re]) => re.test(key));
  return { icon: match ? match[1] : monogram(c.name), ...(badge ? { badge } : {}) };
}
