import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOARD_ROOM_TITLE, DATABASE_TITLE, PARENT_PAGE_ID, databaseProperties, setupBoardRoom } from "../../server/src/notion/boardRoom";
import { NotionClient, RICH_TEXT_MAX, envToken, richText } from "../../server/src/notion/client";
import { NotionBoardSink, consultationProperties, meetingBlocks, meetingProperties } from "../../server/src/notion/sync";
import type { FetchLike } from "../../server/src/hermes/client";
import type { BoardMeeting } from "../../shared/meetings";
import { json } from "./helpers";

const TOKEN = "ntn_supersecrettoken0123";

interface NotionCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  auth: string | null;
  version: string | null;
}

function fakeNotion(handle: (call: NotionCall) => unknown) {
  const calls: NotionCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const headers = new Headers(init?.headers);
    const call: NotionCall = {
      method: init?.method ?? "GET",
      path: `${u.pathname.replace("/v1", "")}${u.search}`,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      auth: headers.get("Authorization"),
      version: headers.get("Notion-Version"),
    };
    calls.push(call);
    const out = handle(call);
    return out instanceof Response ? out : json(out ?? {});
  };
  return { notion: new NotionClient(async () => TOKEN, fetchImpl), calls };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zain-notion-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const writes = (calls: NotionCall[]) => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);

describe("Notion client", () => {
  it("sends the token and Notion-Version 2025-09-03, and keeps the token out of errors", async () => {
    const { notion, calls } = fakeNotion(() => json({ message: `bad token ${TOKEN}` }, 401));
    const err = await notion.request("GET", "/users/me").catch((e: Error) => e);
    expect(calls[0]).toMatchObject({ auth: `Bearer ${TOKEN}`, version: "2025-09-03" });
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect((err as Error).message).toContain("Notion 401");
  });

  it("reads NOTION_API_KEY from the default profile's .env", async () => {
    await writeFile(join(root, ".env"), `NOTION_API_KEY='${TOKEN}'\n`);
    expect(await envToken(root)()).toBe(TOKEN);
    await expect(envToken(join(root, "missing"))()).rejects.toThrow("NOTION_API_KEY is not set");
  });

  it("chunks text into 2000-character rich_text items", () => {
    const items = richText("x".repeat(4500));
    expect(items.map((i) => ((i.text as { content: string }).content.length))).toEqual([RICH_TEXT_MAX, RICH_TEXT_MAX, 500]);
  });
});

describe("npm run board:notion", () => {
  const page = { id: "page-1", type: "child_page", child_page: { title: BOARD_ROOM_TITLE } };
  const db = { id: "db-1", type: "child_database", child_database: { title: DATABASE_TITLE } };
  const children = (results: unknown[]) => ({ results, has_more: false, next_cursor: null });

  it("dry run only reads and reports what is missing", async () => {
    const lines: string[] = [];
    const { notion, calls } = fakeNotion(() => children([{ id: "x", type: "child_page", child_page: { title: "Projects & Tasks" } }]));
    expect(await setupBoardRoom({ notion, apply: false, root, log: (l) => lines.push(l) })).toBeNull();
    expect(writes(calls)).toEqual([]);
    expect(calls[0]!.path).toBe(`/blocks/${PARENT_PAGE_ID}/children?page_size=100`);
    expect(lines).toContain(`Page "${BOARD_ROOM_TITLE}" is missing.`);
  });

  it("creates the page and an inline database with the schema, then stores the ids", async () => {
    const { notion, calls } = fakeNotion((c) => {
      if (c.method === "GET") return children([]);
      if (c.path === "/pages") return { id: "page-new" };
      if (c.path === "/databases") return { id: "db-new", data_sources: [{ id: "ds-new", name: DATABASE_TITLE }] };
      return {};
    });
    const ids = await setupBoardRoom({ notion, apply: true, root, log: () => undefined });
    expect(ids).toEqual({ boardRoomPageId: "page-new", databaseId: "db-new", dataSourceId: "ds-new" });
    expect(writes(calls)).toEqual(["POST /pages", "POST /databases"]);
    expect(calls.find((c) => c.path === "/pages")!.body).toMatchObject({ parent: { type: "page_id", page_id: PARENT_PAGE_ID } });
    const dbBody = calls.find((c) => c.path === "/databases")!.body!;
    expect(dbBody).toMatchObject({ parent: { type: "page_id", page_id: "page-new" }, initial_data_source: { properties: databaseProperties() } });
    const props = databaseProperties();
    expect(Object.keys(props)).toEqual(["Name", "Type", "Status", "Date", "Requested by", "Members", "Decision", "Votes", "Conclusion", "Zain HQ ID"]);
    expect(JSON.stringify(props.Members)).toContain("Alex Hormozi");
    expect(JSON.parse(await readFile(join(root, ".zain", "notion.json"), "utf8"))).toEqual(ids);
  });

  it("is idempotent: finds both by title and only refreshes the schema", async () => {
    const { notion, calls } = fakeNotion((c) => {
      if (c.path.startsWith(`/blocks/${PARENT_PAGE_ID}/children`)) return children([page]);
      if (c.path.startsWith("/blocks/page-1/children")) return children([db]);
      if (c.path === "/databases/db-1") return { id: "db-1", data_sources: [{ id: "ds-1" }] };
      return {};
    });
    expect(await setupBoardRoom({ notion, apply: true, root, log: () => undefined })).toEqual({
      boardRoomPageId: "page-1",
      databaseId: "db-1",
      dataSourceId: "ds-1",
    });
    expect(writes(calls)).toEqual(["PATCH /data_sources/ds-1"]);
  });
});

const concluded: BoardMeeting = {
  id: "mtg_0000000007",
  topic: "Enter Egypt",
  brief: "b".repeat(2500),
  members: ["zain-board-hormozi", "zain-board-buffett"],
  boardOnly: false,
  discussionRounds: 1,
  status: "concluded",
  currentRound: 3,
  turns: [
    { round: 1, kind: "opening", speaker: "zain-board-hormozi", text: "Go.", at: 1 },
    { round: 1, kind: "opening", speaker: "founder", text: "Mind cash.", at: 2 },
    { round: 3, kind: "vote", speaker: "default", text: "c".repeat(2500), at: 3 },
  ],
  votes: [
    { member: "zain-board-hormozi", vote: "approve-with-conditions", conditions: "Partner first", rationale: "Volume." },
    { member: "zain-board-buffett", vote: "reject", rationale: "Moat unclear." },
  ],
  decision: "no-decision",
  conclusion: "c".repeat(2500),
  requestedBy: "ceo",
  createdAt: 1_790_000_000,
  updatedAt: 1_790_000_100,
};

describe("meeting rows", () => {
  it("maps a meeting to the Board Meetings properties", () => {
    const props = meetingProperties(concluded) as Record<string, Record<string, unknown>>;
    expect(props.Type).toEqual({ select: { name: "Meeting" } });
    expect(props.Status).toEqual({ select: { name: "Concluded" } });
    expect(props["Requested by"]).toEqual({ select: { name: "CEO" } });
    expect(props.Decision).toEqual({ select: { name: "No decision" } });
    expect(props.Members).toEqual({ multi_select: [{ name: "Alex Hormozi" }, { name: "Warren Buffett" }] });
    expect(props.Votes).toEqual({ rich_text: richText("Conditions 1 · Reject 1") });
    expect(((props.Conclusion!.rich_text as { text: { content: string } }[])[0]!.text.content).length).toBe(2000);
    expect(props["Zain HQ ID"]).toEqual({ rich_text: richText(concluded.id) });
    expect(props.Date).toEqual({ date: { start: new Date(1_790_000_000_000).toISOString() } });
  });

  it("writes the brief, rounds as callouts, votes and the conclusion", () => {
    const blocks = meetingBlocks(concluded);
    const kinds = blocks.map((b) => b.type);
    expect(kinds).toEqual(["heading_2", "paragraph", "heading_2", "callout", "callout", "heading_2", "bulleted_list_item", "bulleted_list_item", "paragraph", "heading_2", "paragraph"]);
    const brief = (blocks[1]!.paragraph as { rich_text: unknown[] }).rich_text;
    expect(brief).toHaveLength(2);
    expect(JSON.stringify(blocks[3])).toContain("Alex Hormozi");
    expect(JSON.stringify(blocks[4])).toContain("Founder (Abdelhalim)");
    expect(JSON.stringify(blocks).split("c".repeat(2000)).length - 1).toBe(1);
    expect(JSON.stringify(blocks[6])).toContain("Approve with conditions (conditions: Partner first): Volume.");
  });

  it("maps consultations as Consultation rows", () => {
    const props = consultationProperties({
      id: "cns_1",
      question: "Should we raise prices?",
      members: ["zain-board-hormozi"],
      tasks: {},
      createdAt: 1_790_000_000,
      status: "answered",
      answers: [],
    }) as Record<string, unknown>;
    expect(props.Type).toEqual({ select: { name: "Consultation" } });
    expect(props.Status).toEqual({ select: { name: "Answered" } });
    expect(JSON.stringify(props.Name)).toContain("Consultation: Should we raise prices?");
  });
});

describe("upserting a row", () => {
  async function sinkWith(handle: (c: NotionCall) => unknown) {
    await mkdir(join(root, ".zain"), { recursive: true });
    await writeFile(join(root, ".zain", "notion.json"), JSON.stringify({ boardRoomPageId: "p", databaseId: "d", dataSourceId: "ds-1" }));
    const fake = fakeNotion(handle);
    return { ...fake, sink: new NotionBoardSink(fake.notion, root) };
  }

  it("creates the row when no page has the Zain HQ ID, then writes the body in batches of 100", async () => {
    const big = { ...concluded, turns: Array.from({ length: 150 }, (_, i) => ({ round: 1, kind: "opening" as const, speaker: "zain-board-hormozi", text: `t${i}`, at: i })) };
    const { sink, calls } = await sinkWith((c) => {
      if (c.path === "/data_sources/ds-1/query") return { results: [] };
      if (c.path === "/pages") return { id: "row-1", url: "https://notion.so/row-1" };
      if (c.method === "GET") return { results: [], has_more: false, next_cursor: null };
      return {};
    });
    expect(await sink.syncMeeting(big, undefined)).toEqual({ pageId: "row-1", url: "https://notion.so/row-1" });
    expect(calls.find((c) => c.path === "/data_sources/ds-1/query")!.body).toEqual({
      filter: { property: "Zain HQ ID", rich_text: { equals: concluded.id } },
      page_size: 1,
    });
    expect(calls.find((c) => c.path === "/pages")!.body).toMatchObject({ parent: { type: "data_source_id", data_source_id: "ds-1" } });
    const appends = calls.filter((c) => c.method === "PATCH" && c.path === "/blocks/row-1/children");
    expect(appends.map((c) => (c.body!.children as unknown[]).length)).toEqual([100, meetingBlocks(big).length - 100]);
  });

  it("updates the existing row found by Zain HQ ID and replaces its body", async () => {
    const { sink, calls } = await sinkWith((c) => {
      if (c.path === "/data_sources/ds-1/query") return { results: [{ id: "row-9" }] };
      if (c.path === "/pages/row-9") return { id: "row-9", url: "https://notion.so/row-9" };
      if (c.path.startsWith("/blocks/row-9/children") && c.method === "GET") return { results: [{ id: "b1" }, { id: "b2" }], has_more: false, next_cursor: null };
      return {};
    });
    await sink.syncMeeting(concluded, undefined);
    expect(writes(calls)).toEqual(["POST /data_sources/ds-1/query", "PATCH /pages/row-9", "DELETE /blocks/b1", "DELETE /blocks/b2", "PATCH /blocks/row-9/children"]);
    const second = await sinkWith((c) => (c.path === "/pages/row-9" ? { id: "row-9", url: "u" } : { results: [], has_more: false, next_cursor: null }));
    await second.sink.syncMeeting(concluded, "row-9");
    expect(second.calls.some((c) => c.path.includes("/query"))).toBe(false);
  });

  it("fails clearly before setup", async () => {
    const { notion } = fakeNotion(() => ({}));
    await expect(new NotionBoardSink(notion, root).syncMeeting(concluded, undefined)).rejects.toThrow("npm run board:notion -- --apply");
  });
});
