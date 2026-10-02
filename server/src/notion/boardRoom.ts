import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BOARD_MEMBERS } from "../../../shared/board";
import { NotionClient, paragraph } from "./client";

export const PARENT_PAGE_ID = "338448a0-4ab7-80e4-9258-c60049e47991";
export const BOARD_ROOM_TITLE = "Zain Group · Board Room";
export const DATABASE_TITLE = "Board Meetings";

export interface BoardRoomIds {
  boardRoomPageId: string;
  databaseId: string;
  dataSourceId: string;
}

export const STATUS_OPTIONS = ["Live", "In round", "Awaiting founder", "Voting", "Minutes", "Concluded", "Cancelled", "Awaiting answers", "Answered"];
export const DECISION_OPTIONS = ["Approved", "Approved with conditions", "Rejected", "No decision"];
export const REQUESTED_BY_OPTIONS = ["HQ", "CEO", "Board"];

const select = (names: readonly string[]) => ({ select: { options: names.map((name) => ({ name })) } });

/** The Board Meetings schema; re-sending it is harmless (Notion merges properties and options). */
export function databaseProperties(): Record<string, unknown> {
  return {
    Name: { title: {} },
    Type: select(["Meeting", "Consultation"]),
    Status: select(STATUS_OPTIONS),
    Date: { date: {} },
    "Requested by": select(REQUESTED_BY_OPTIONS),
    Members: { multi_select: { options: BOARD_MEMBERS.map((m) => ({ name: m.name })) } },
    Decision: select(DECISION_OPTIONS),
    Votes: { rich_text: {} },
    Conclusion: { rich_text: {} },
    "Zain HQ ID": { rich_text: {} },
  };
}

export function boardRoomIdsPath(root: string): string {
  return join(root, ".zain", "notion.json");
}

export async function readBoardRoomIds(root: string): Promise<BoardRoomIds | null> {
  try {
    const data = JSON.parse(await readFile(boardRoomIdsPath(root), "utf8")) as Partial<BoardRoomIds>;
    return data.boardRoomPageId && data.databaseId && data.dataSourceId ? (data as BoardRoomIds) : null;
  } catch {
    return null;
  }
}

async function writeBoardRoomIds(root: string, ids: BoardRoomIds): Promise<void> {
  const path = boardRoomIdsPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(ids, null, 2)}\n`, "utf8");
  await rename(`${path}.tmp`, path);
}

type Block = Record<string, unknown> & { id: string; type: string };
const childTitle = (b: Block) => ((b[b.type] as { title?: string } | undefined)?.title ?? "").trim();

export interface BoardRoomSetupOptions {
  notion: NotionClient;
  apply: boolean;
  root: string;
  log?: (line: string) => void;
}

/**
 * Finds or creates "Zain Group · Board Room" under Zain Studio OS and the "Board Meetings" database
 * inside it, matching existing ones by title so re-runs change nothing. Notion-Version 2025-09-03:
 * a database is a container whose rows live in its first data source.
 */
export async function setupBoardRoom({ notion, apply, root, log = console.log }: BoardRoomSetupOptions): Promise<BoardRoomIds | null> {
  const parent = (await notion.children(PARENT_PAGE_ID)) as Block[];
  let pageId = parent.find((b) => b.type === "child_page" && childTitle(b) === BOARD_ROOM_TITLE)?.id;
  log(pageId ? `Found page "${BOARD_ROOM_TITLE}".` : `Page "${BOARD_ROOM_TITLE}" is missing.`);
  let databaseId = pageId
    ? ((await notion.children(pageId)) as Block[]).find((b) => b.type === "child_database" && childTitle(b) === DATABASE_TITLE)?.id
    : undefined;
  log(databaseId ? `Found database "${DATABASE_TITLE}".` : `Database "${DATABASE_TITLE}" is missing.`);
  if (!apply) {
    log("Dry run. Re-run with --apply to create what is missing and update the database schema.");
    return null;
  }
  if (!pageId) {
    const page = await notion.request<{ id: string }>("POST", "/pages", {
      parent: { type: "page_id", page_id: PARENT_PAGE_ID },
      icon: { type: "emoji", emoji: "🏛️" },
      properties: { title: { title: [{ type: "text", text: { content: BOARD_ROOM_TITLE } }] } },
      children: [
        paragraph(
          "Zain Group's board of advisors at work: every board meeting (rounds, votes, minutes) and every board consultation, kept in sync by Zain HQ. The advisors are AI personas modelled on public figures' published thinking.",
        ),
      ],
    });
    pageId = page.id;
    log(`Created page "${BOARD_ROOM_TITLE}".`);
  }
  let dataSourceId: string;
  if (!databaseId) {
    const db = await notion.request<{ id: string; data_sources: { id: string }[] }>("POST", "/databases", {
      parent: { type: "page_id", page_id: pageId },
      title: [{ type: "text", text: { content: DATABASE_TITLE } }],
      is_inline: true,
      initial_data_source: { properties: databaseProperties() },
    });
    databaseId = db.id;
    dataSourceId = db.data_sources[0]!.id;
    log(`Created database "${DATABASE_TITLE}".`);
  } else {
    const db = await notion.request<{ data_sources: { id: string }[] }>("GET", `/databases/${databaseId}`);
    dataSourceId = db.data_sources[0]!.id;
    await notion.request("PATCH", `/data_sources/${dataSourceId}`, { properties: databaseProperties() });
    log(`Updated the "${DATABASE_TITLE}" schema.`);
  }
  const ids = { boardRoomPageId: pageId, databaseId, dataSourceId };
  await writeBoardRoomIds(root, ids);
  log(`Saved ids to ${boardRoomIdsPath(root)}.`);
  return ids;
}
