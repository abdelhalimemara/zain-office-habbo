import { join } from "node:path";
import { hermesHome } from "../clientChannels/hermesPaths";
import { readEnvKey, redact } from "../connections/run";
import type { FetchLike } from "../hermes/client";

export const NOTION_VERSION = "2025-09-03";
const BASE = "https://api.notion.com/v1";
const TIMEOUT_MS = 20_000;

export class NotionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Reads the integration token from the default profile's .env at call time; it never leaves the request header. */
export function envToken(home = hermesHome()): () => Promise<string> {
  return async () => {
    const token = await readEnvKey(join(home, ".env"), "NOTION_API_KEY");
    if (!token) throw new NotionError(401, "NOTION_API_KEY is not set in the default Hermes profile");
    return token;
  };
}

type Json = Record<string, unknown>;

export class NotionClient {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async request<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new NotionError(0, `Notion unreachable (${err instanceof Error ? err.name : "error"})`);
    }
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Json) : {};
    if (!res.ok) {
      const message = typeof data.message === "string" ? data.message : res.statusText;
      throw new NotionError(res.status, `Notion ${res.status}: ${redact(message, [token])}`);
    }
    return data as T;
  }

  /** All children of a block, following Notion's cursor pagination. */
  async children(blockId: string): Promise<Json[]> {
    const out: Json[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request<{ results: Json[]; has_more: boolean; next_cursor: string | null }>(
        "GET",
        `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
      );
      out.push(...page.results);
      cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return out;
  }

  /** Appends blocks in Notion's 100-per-request batches. */
  async append(blockId: string, blocks: readonly Json[]): Promise<void> {
    for (let i = 0; i < blocks.length; i += 100) {
      await this.request("PATCH", `/blocks/${blockId}/children`, { children: blocks.slice(i, i + 100) });
    }
  }
}

export const RICH_TEXT_MAX = 2000;

/** Notion caps one rich_text item at 2000 characters, so long text becomes several items. */
export function richText(text: string, annotations?: Json): Json[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += RICH_TEXT_MAX) chunks.push(text.slice(i, i + RICH_TEXT_MAX));
  return (chunks.length ? chunks : [""]).map((content) => ({ type: "text", text: { content }, ...(annotations ? { annotations } : {}) }));
}

export function paragraph(text: string): Json {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(text) } };
}

export function heading(text: string, level: 1 | 2 | 3 = 2): Json {
  const type = `heading_${level}`;
  return { object: "block", type, [type]: { rich_text: richText(text) } };
}

export function callout(speaker: string, text: string, emoji = "💬"): Json {
  return {
    object: "block",
    type: "callout",
    callout: { icon: { type: "emoji", emoji }, rich_text: [...richText(speaker, { bold: true }), ...richText(`\n${text}`)] },
  };
}

export function bullet(text: string): Json {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(text) } };
}

/** Long paragraphs as several blocks (Notion also caps rich_text arrays at 100 items). */
export function paragraphs(text: string): Json[] {
  const out: Json[] = [];
  const per = RICH_TEXT_MAX * 50;
  for (let i = 0; i < Math.max(text.length, 1); i += per) out.push(paragraph(text.slice(i, i + per)));
  return out;
}
