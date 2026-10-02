import { createApp } from "../../server/src/app";
import { ConsultationLog, type ConsultationRecord, type ConsultationSink } from "../../server/src/board/consultLog";
import { MeetingEngine, type MeetingSink, type StoredMeeting } from "../../server/src/board/meetings/engine";
import { memoryMemoryStore, type MemoryStore } from "../../server/src/board/memory/notes";
import { memoryRecordStore, type RecordStore } from "../../server/src/board/recordStore";
import type { GuardOptions } from "../../server/src/guard";
import { fileBriefs, type BriefReader } from "../../server/src/org/privateBriefs";
import { ConnectionsService, type ConnectionsOptions } from "../../server/src/connections/service";
import { CeoWake, type ExecFileLike } from "../../server/src/telegram/ceoWake";
import { HEADCOUNT_REF, HeadcountSource } from "../../server/src/headcount/catalog";
import { HermesClient, type FetchLike } from "../../server/src/hermes/client";
import { memoryHireStore, type HireStore } from "../../server/src/org/hireStore";
import { memoryTeamStore, type TeamStore } from "../../server/src/org/teamStore";
import type { GhCheck } from "../../server/src/org/techTeams";
import type { KanbanTask } from "../../shared/hermes";
import type { BoardMeeting } from "../../shared/meetings";
import { ROSTER } from "../../shared/roster";
import { SKILL_SOURCES, skillSourceFor } from "../../shared/skillSources";
import { memoryVoiceStore } from "../../server/src/voice/assignments";
import { ElevenLabsClient } from "../../server/src/voice/elevenlabs";
import type { LiveService } from "../../server/src/voice/live";
import type { LeadershipService } from "../../server/src/leadership/service";
import { VoiceService } from "../../server/src/voice/service";

export const TOKEN = "tok-secret-123";
export const KANBAN = "/api/plugins/kanban";

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  auth: string | null;
}

export type Handler = (call: Call, n: number) => Response | unknown | Promise<Response | unknown>;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch stub routed on `METHOD /path`; unrouted requests answer 404 like Hermes. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url.pathname}`;
    const headers = new Headers(init?.headers);
    const call: Call = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      auth: headers.get("Authorization"),
    };
    calls.push(call);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const handler = routes[key];
    if (!handler) return json({ detail: `no route ${key}` }, 404);
    const out = await handler(call, n);
    return out instanceof Response ? out : json(out);
  };
  return { fetchImpl, calls, called: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key) };
}

export const dashboardHtml = (token = TOKEN) =>
  new Response(`<html><script>window.__HERMES_SESSION_TOKEN__="${token}";</script></html>`);

export const hermesBase: Record<string, Handler> = {
  [`GET ${KANBAN}/home-channels`]: () => ({ home_channels: [] }),
  "GET /": () => dashboardHtml(),
  [`GET ${KANBAN}/boards`]: () => ({ boards: [{ slug: "default" }, { slug: "zain-group" }], current: "default" }),
};

export function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "t_abc",
    title: "Launch campaign",
    body: null,
    assignee: "zain-growth-vp",
    status: "review",
    priority: 0,
    created_by: "dashboard",
    created_at: 1,
    started_at: null,
    completed_at: null,
    tenant: "zain-growth",
    result: "Rolled-up result",
    ...overrides,
  };
}

function skillMarkdown(skill: string): string {
  return `---\nname: ${skill}\ndescription: Long upstream description for ${skill}. Use it often.\n---\n\n# ${skill}\n\nDo the thing well.\n`;
}

export function githubFetch(options: { down?: boolean } = {}) {
  const tree = [
    ...new Set(ROSTER.flatMap((a) => a.skills).filter((id) => !skillSourceFor(id))),
    "security:incident-response",
  ].map((id) => {
    const [dept, skill] = id.split(":");
    return { path: `plugins/${dept}/skills/${skill}/SKILL.md`, type: "blob" };
  });
  return mockFetch({
    [`GET /repos/cbrock84/headcount/git/trees/${HEADCOUNT_REF}`]: () =>
      options.down ? json({ message: "rate limited" }, 403) : { tree: [{ path: "README.md", type: "blob" }, ...tree] },
    ...Object.fromEntries(
      tree.map(({ path }) => [
        `GET /cbrock84/headcount/${HEADCOUNT_REF}/${path}`,
        () => new Response(skillMarkdown(path.split("/")[3]!)),
      ]),
    ),
    ...Object.fromEntries(
      SKILL_SOURCES.flatMap((source) =>
        source.skills.map((skill) => [`GET /${source.repo}/${source.ref}/${source.skillPath(skill)}`, () => new Response(skillMarkdown(skill))]),
      ),
    ),
  });
}

export interface ExecCall {
  file: string;
  args: readonly string[];
  timeout: number;
}

/** A stand-in for execFile that records calls and fails when `fail` says so. */
export function mockExec(fail: (args: readonly string[]) => boolean = () => false) {
  const calls: ExecCall[] = [];
  const execFile: ExecFileLike = async (file, args, { timeout }) => {
    calls.push({ file, args, timeout });
    if (fail(args)) throw Object.assign(new Error("exit 1"), { name: "ExecError" });
    return { stdout: "", stderr: "" };
  };
  return { execFile, calls };
}

/** Connections that never run real binaries or read real tokens. */
export function stubConnections(hermes: HermesClient, ceoWake: CeoWake, overrides: Partial<ConnectionsOptions> = {}): ConnectionsService {
  const missing = async () => ({ code: 127, stdout: "", stderr: "" });
  return new ConnectionsService({
    hermes,
    ceoWake,
    run: missing,
    ahmadPython: async () => ({ code: 1, stdout: "" }),
    defaultPython: async () => ({ code: 1, stdout: "" }),
    tokens: { hermesToken: async () => false, mcpRemoteToken: async () => false },
    home: "/nonexistent/zain-test-home",
    hermesBin: "/nonexistent/hermes",
    fetchImpl: async () => {
      throw new TypeError("no network in tests");
    },
    ...overrides,
  });
}

/** Voices with no ElevenLabs key and no network; nothing is read from or written to a real home. */
export function stubVoice(): VoiceService {
  const client = new ElevenLabsClient(async () => null, async () => {
    throw new TypeError("no network in tests");
  });
  return new VoiceService({ root: "/nonexistent/zain-test-root", client, store: memoryVoiceStore(), log: () => undefined });
}

/** Meetings and consultations kept in memory, with no Notion sink. */
export function stubBoardRoom(hermes: HermesClient) {
  const ceoWake = new CeoWake({ hermes, execFile: mockExec().execFile, log: () => undefined });
  return {
    meetings: new MeetingEngine({ hermes, hires: memoryHireStore(), ceoWake, store: memoryRecordStore<StoredMeeting>(), log: () => undefined }),
    consultations: new ConsultationLog({ hermes, store: memoryRecordStore<ConsultationRecord>(), log: () => undefined }),
    voice: stubVoice(),
  };
}

/** Tests never read the real `.zain/board` briefs: this root has none. */
export const NO_BRIEFS = fileBriefs("/nonexistent/zain-test-root");

export const TELEGRAM_HOME = { platform: "telegram", chat_id: "6606232800", thread_id: "", name: "Home" };

export function setup(
  routes: Record<string, Handler>,
  options: {
    hires?: HireStore;
    githubDown?: boolean;
    guard?: GuardOptions;
    exec?: ReturnType<typeof mockExec>;
    briefs?: BriefReader;
    connections?: (hermes: HermesClient, ceoWake: CeoWake) => ConnectionsService;
    teams?: TeamStore;
    gh?: GhCheck;
    meetingStore?: RecordStore<StoredMeeting>;
    consultationStore?: RecordStore<ConsultationRecord>;
    sink?: MeetingSink & ConsultationSink;
    now?: () => number;
    voice?: VoiceService;
    /** Built once the meeting engine exists, e.g. a LiveService over a fake ElevenLabs. */
    live?: (meetings: MeetingEngine, voice: VoiceService, memory: MemoryStore, leadership?: LeadershipService) => LiveService;
    /** Built once the meeting engine exists: leadership (VP) meetings over the same store. */
    leadership?: (deps: { meetings: MeetingEngine; hermes: HermesClient; hires: HireStore; ceoWake: CeoWake }) => LeadershipService;
    /** Board members' notes; an empty in-memory store by default. */
    memory?: MemoryStore;
    onTurns?: (meeting: BoardMeeting, from: number) => void;
  } = {},
) {
  const hermesFetch = mockFetch({ ...hermesBase, ...routes });
  const githubCalls = githubFetch({ down: options.githubDown });
  const hermes = new HermesClient({ baseUrl: "http://hermes.test", fetchImpl: hermesFetch.fetchImpl });
  const headcount = new HeadcountSource({ fetchImpl: githubCalls.fetchImpl });
  const hires = options.hires ?? memoryHireStore();
  const exec = options.exec ?? mockExec();
  const ceoWake = new CeoWake({ hermes, execFile: exec.execFile, hermesBin: "/opt/hermes/bin/hermes", log: () => undefined });
  const briefs = options.briefs ?? NO_BRIEFS;
  const connections = options.connections?.(hermes, ceoWake) ?? stubConnections(hermes, ceoWake);
  const teams = options.teams ?? memoryTeamStore();
  const gh = options.gh ?? { execFile: mockExec(() => true).execFile, ghBin: "/opt/gh" };
  const meetingStore = options.meetingStore ?? memoryRecordStore<StoredMeeting>();
  const consultationStore = options.consultationStore ?? memoryRecordStore<ConsultationRecord>();
  const quiet = () => undefined;
  const memory = options.memory ?? memoryMemoryStore();
  const meetings = new MeetingEngine({
    hermes,
    hires,
    ceoWake,
    store: meetingStore,
    sink: options.sink,
    now: options.now,
    log: quiet,
    onTurns: options.onTurns,
    memory,
    newId: (() => {
      let n = 0;
      return () => `mtg_${String(++n).padStart(10, "0")}`;
    })(),
  });
  const consultations = new ConsultationLog({ hermes, store: consultationStore, sink: options.sink, now: options.now, log: quiet });
  const voice = options.voice ?? stubVoice();
  const leadership = options.leadership?.({ meetings, hermes, hires, ceoWake });
  const live = options.live?.(meetings, voice, memory, leadership);
  const app = createApp({ hermes, headcount, hires, ceoWake, briefs, connections, guard: options.guard, teams, gh, meetings, consultations, memory, voice, live, leadership });
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: {
        Host: "127.0.0.1:8787",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    app,
    send,
    hermes,
    headcount,
    hires,
    hermesFetch,
    gh: githubCalls,
    exec,
    ceoWake,
    briefs,
    connections,
    teams,
    meetings,
    meetingStore,
    consultations,
    consultationStore,
    voice,
    live,
    leadership,
    memory,
  };
}
