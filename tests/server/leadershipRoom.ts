import { join } from "node:path";
import type { BoardMeeting } from "../../shared/meetings";
import type { FetchLike } from "../../server/src/hermes/client";
import { LeadershipService } from "../../server/src/leadership/service";
import { execSouls } from "../../server/src/leadership/prompt";
import { memoryVoiceStore } from "../../server/src/voice/assignments";
import { ElevenLabsClient } from "../../server/src/voice/elevenlabs";
import { LiveService } from "../../server/src/voice/live";
import { BoardRoomAgent, LEADERSHIP_ROOM, fileAgentStore } from "../../server/src/voice/liveAgent";
import { fileSouls } from "../../server/src/voice/livePrompt";
import { VoiceService } from "../../server/src/voice/service";
import { fakeKanban } from "./fakeKanban";
import { KANBAN, NO_BRIEFS, json, setup, type Handler } from "./helpers";

export const KEY = "sk_elevenlabsSecretKey0123456789abcdef";
export const CONV = "conv_leaders00000001";
/** Fri 2 Oct 2026, 12:00 in Riyadh. */
export const NOW = 1_790_931_600;
export const EXECS = ["zain-hq-coo", "zain-studio-vp", "zain-growth-vp", "zain-labs-vp", "zain-tech-vp"];

export type Conversation = { agent_id?: string; status: string; metadata?: { start_time_unix_secs?: number }; transcript: { role: string; message: string | null; time_in_call_secs: number }[] };

export interface LabsCall {
  method: string;
  path: string;
  query: URLSearchParams;
  json?: Record<string, any>;
}

/** A stand-in for the ElevenLabs Agents API: created agents are agent_room000000000N in order. */
export function fakeLabs() {
  const calls: LabsCall[] = [];
  const conversations = new Map<string, Conversation>();
  let created = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, query: url.searchParams, ...(typeof init?.body === "string" ? { json: JSON.parse(init.body) } : {}) });
    if (method === "POST" && url.pathname === "/v1/convai/agents/create") return json({ agent_id: `agent_room000000000${++created}` });
    if (method === "PATCH" && url.pathname.startsWith("/v1/convai/agents/")) return json({});
    if (method === "GET" && url.pathname === "/v1/convai/conversation/get-signed-url") return json({ signed_url: `wss://labs.test/?agent_id=${url.searchParams.get("agent_id")}` });
    const conv = /^\/v1\/convai\/conversations\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && conv) return conversations.has(conv[1]!) ? json(conversations.get(conv[1]!)) : json({ detail: "Conversation not found" }, 404);
    return json({ detail: `no route ${method} ${url.pathname}` }, 404);
  };
  const called = (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix));
  return { fetchImpl, calls, conversations, called };
}

export interface RoomOptions {
  root: string;
  home: string;
  prioritiesPath: string;
  hired?: readonly string[];
  dashboard?: string | null;
  /** Wraps the fake kanban's routes, e.g. to fail some task creations. */
  routes?: (routes: Record<string, Handler>) => Record<string, Handler>;
}

/** The app with leadership meetings, the live room over a fake ElevenLabs and a fake kanban. */
export function leadershipRoom(opts: RoomOptions) {
  const labs = fakeLabs();
  const client = new ElevenLabsClient(async () => KEY, labs.fetchImpl, () => undefined);
  const voice = new VoiceService({ root: opts.root, client, store: memoryVoiceStore(), log: () => undefined });
  const kanban = fakeKanban(opts.hired ?? EXECS);
  const logs: string[] = [];
  const boardAgent = new BoardRoomAgent(client, fileAgentStore(opts.root), () => undefined);
  const leadershipAgent = new BoardRoomAgent(client, fileAgentStore(opts.root, LEADERSHIP_ROOM.key), () => undefined, LEADERSHIP_ROOM);
  const s = setup(opts.routes ? opts.routes(kanban.routes) : kanban.routes, {
    voice,
    now: () => NOW,
    leadership: ({ meetings, hermes, hires, ceoWake }) =>
      new LeadershipService({
        meetings,
        hermes,
        hires,
        ceoWake,
        souls: execSouls(opts.home),
        dashboard: async () => opts.dashboard ?? null,
        prioritiesPath: opts.prioritiesPath,
        now: () => NOW,
        log: (l) => logs.push(l),
      }),
    live: (meetings, v, memory, leadership) =>
      new LiveService({
        client,
        agent: boardAgent,
        leadership: { agent: leadershipAgent, prompt: (m) => leadership!.prompt(m) },
        voice: v,
        meetings,
        souls: fileSouls(opts.home),
        briefs: NO_BRIEFS,
        memory,
        sleep: async () => undefined,
        now: () => NOW,
      }),
  });
  const start = async (body: Record<string, unknown> = {}) => {
    const res = await s.send("POST", "/api/leadership/meetings", body);
    return { res, meeting: (await res.clone().json()).meeting as BoardMeeting };
  };
  const session = (id: string) => s.send("POST", `/api/board/meetings/${id}/live`, {});
  const end = (id: string, body: Record<string, unknown>) => s.send("POST", `/api/board/meetings/${id}/live/end`, body);
  const putActions = (id: string, body: unknown) => s.send("PUT", `/api/leadership/meetings/${id}/actions`, body);
  const assign = (id: string, body: unknown = {}) => s.send("POST", `/api/leadership/meetings/${id}/actions/assign`, body);
  const meeting = async (id: string) => (await (await s.send("GET", `/api/board/meetings/${id}`)).json()).meeting as BoardMeeting;
  return { ...s, labs, kanban, logs, start, session, end, putActions, assign, meeting, agentsFile: join(opts.root, ".zain", "elevenlabs.json") };
}

export const tasksPath = `POST ${KANBAN}/tasks`;
