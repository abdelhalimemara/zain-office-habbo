import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardMeeting } from "../../shared/meetings";
import { BOARD_MEMBERS } from "../../shared/board";
import type { LiveSessionResponse } from "../../shared/voice";
import type { FetchLike } from "../../server/src/hermes/client";
import { memoryMemoryStore, type MemoryStore } from "../../server/src/board/memory/notes";
import type { StoredMeeting } from "../../server/src/board/meetings/engine";
import { memoryRecordStore, type RecordStore } from "../../server/src/board/recordStore";
import { meetingBlocks, meetingProperties } from "../../server/src/notion/sync";
import { STATUS_OPTIONS } from "../../server/src/notion/boardRoom";
import { boardSoul } from "../../server/src/org/boardPersona";
import { memoryVoiceStore } from "../../server/src/voice/assignments";
import { ElevenLabsClient } from "../../server/src/voice/elevenlabs";
import { LiveService } from "../../server/src/voice/live";
import { BoardRoomAgent, fileAgentStore, speakerTag } from "../../server/src/voice/liveAgent";
import { condenseSoul, fileSouls, hasAgenda } from "../../server/src/voice/livePrompt";
import { fileBriefs } from "../../server/src/org/privateBriefs";
import { VoiceService } from "../../server/src/voice/service";
import { fakeKanban } from "./fakeKanban";
import { KANBAN, json, setup } from "./helpers";

const KEY = "sk_elevenlabsSecretKey0123456789abcdef";
const HORMOZI = "zain-board-hormozi";
const BUFFETT = "zain-board-buffett";
const OWN_VOICE = "OwnVoice0123456789ab";
const AGENT = "agent_boardroom00001";
const CONV = "conv_first0000000001";
const SIGNED = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_boardroom00001&conversation_signature=sig";
const PRIVATE_BRIEF = "BRIEFMARKER-ALPHA: a confidential line from the private brief.";

interface LabsCall {
  method: string;
  path: string;
  query: URLSearchParams;
  key: string | null;
  json?: Record<string, unknown>;
}

type Conversation = { agent_id?: string; status: string; metadata?: { start_time_unix_secs?: number }; transcript: { role: string; message: string | null; time_in_call_secs: number }[] };

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    agent_id: AGENT,
    status: "done",
    metadata: { start_time_unix_secs: 1_790_000_100 },
    transcript: [
      { role: "agent", message: "Welcome, Abdelhalim. The floor is open: who wants to start?", time_in_call_secs: 0 },
      { role: "user", message: "Should we open in Cairo?", time_in_call_secs: 4 },
      { role: "agent", message: "<Hormozi>Only with a grand slam offer.</Hormozi><Buffett>And only if the cash comes back.</Buffett>", time_in_call_secs: 7 },
      { role: "agent", message: null, time_in_call_secs: 9 },
      { role: "user", message: "Fair.", time_in_call_secs: 12 },
    ],
    ...overrides,
  };
}

/** A stand-in for the ElevenLabs Agents API. */
function fakeLabs() {
  const calls: LabsCall[] = [];
  const conversations = new Map<string, Conversation | (() => Conversation)>([[CONV, conversation()]]);
  const state = { agentGone: false, created: 0 };
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const call: LabsCall = {
      method,
      path: url.pathname,
      query: url.searchParams,
      key: new Headers(init?.headers).get("xi-api-key"),
      ...(typeof init?.body === "string" ? { json: JSON.parse(init.body) } : {}),
    };
    calls.push(call);
    if (method === "POST" && url.pathname === "/v1/convai/agents/create") {
      state.created += 1;
      state.agentGone = false;
      return json({ agent_id: state.created === 1 ? AGENT : `agent_boardroom0000${state.created}` });
    }
    if (method === "PATCH" && url.pathname.startsWith("/v1/convai/agents/")) {
      return state.agentGone ? json({ detail: { status: "agent_not_found", message: "gone" } }, 404) : json({});
    }
    if (method === "GET" && url.pathname === "/v1/convai/conversation/get-signed-url") return json({ signed_url: SIGNED });
    const conv = /^\/v1\/convai\/conversations\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && conv) {
      const found = conversations.get(conv[1]!);
      return found ? json(typeof found === "function" ? found() : found) : json({ detail: "Conversation not found" }, 404);
    }
    return json({ detail: `no route ${method} ${url.pathname}` }, 404);
  };
  const called = (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix));
  return { fetchImpl, calls, conversations, state, called };
}

let root: string;
let home: string;
const logs: string[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zain-live-"));
  home = join(root, "hermes-home");
  logs.length = 0;
  const hormozi = BOARD_MEMBERS.find((m) => m.profile === HORMOZI)!;
  await mkdir(join(home, "profiles", HORMOZI), { recursive: true });
  await writeFile(join(home, "profiles", HORMOZI, "SOUL.md"), boardSoul(hormozi, PRIVATE_BRIEF));
});
afterEach(() => rm(root, { recursive: true, force: true }));

function liveRoom(opts: { key?: string | null; memory?: MemoryStore; meetingStore?: RecordStore<StoredMeeting>; dashboard?: string } = {}) {
  const labs = fakeLabs();
  const key = opts.key === undefined ? KEY : opts.key;
  const client = new ElevenLabsClient(async () => key, labs.fetchImpl, (l) => logs.push(l));
  const voice = new VoiceService({ root, client, store: memoryVoiceStore({ [HORMOZI]: OWN_VOICE }), log: (l) => logs.push(l) });
  const agent = new BoardRoomAgent(client, fileAgentStore(root), (l) => logs.push(l));
  const kanban = fakeKanban([HORMOZI, BUFFETT]);
  const sleeps: number[] = [];
  const s = setup(kanban.routes, {
    voice,
    now: () => 1_790_000_000,
    ...(opts.memory ? { memory: opts.memory } : {}),
    ...(opts.meetingStore ? { meetingStore: opts.meetingStore } : {}),
    live: (meetings, v, memory) =>
      new LiveService({ client, agent, voice: v, meetings, souls: fileSouls(home), briefs: fileBriefs(root), memory, dashboard: async () => opts.dashboard ?? null, sleep: async (ms) => void sleeps.push(ms) }),
  });
  const start = async (body: Record<string, unknown> = {}) => {
    const res = await s.send("POST", "/api/board/meetings", { topic: "Cairo office", brief: "Should we open one in 2027?", mode: "voice", ...body });
    return { res, meeting: (await res.json()).meeting as BoardMeeting };
  };
  const session = (id: string) => s.send("POST", `/api/board/meetings/${id}/live`, {});
  const end = (id: string, body: Record<string, unknown>) => s.send("POST", `/api/board/meetings/${id}/live/end`, body);
  return { ...s, labs, kanban, sleeps, start, session, end };
}

describe("starting a voice meeting", () => {
  it("opens it live, with no written opening round", async () => {
    const r = liveRoom();
    const { res, meeting } = await r.start();
    expect(res.status).toBe(201);
    expect(meeting).toMatchObject({ mode: "voice", status: "live", currentRound: 1, turns: [], liveConversationIds: [] });
    expect(r.kanban.tasks.size).toBe(0);
  });

  it("can be cancelled while live", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    const res = await r.send("POST", `/api/board/meetings/${meeting.id}/cancel`, {});
    expect(res.status).toBe(200);
    expect((await res.json()).meeting.status).toBe("cancelled");
    expect((await r.session(meeting.id)).status).toBe(409);
  });
});

describe("a live session", () => {
  it("creates the board room agent once, with every member's voice and per-session overrides", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    const res = await r.session(meeting.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LiveSessionResponse;
    expect(body.signedUrl).toBe(SIGNED);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body.speakers).toEqual([
      { tag: "Hormozi", profile: HORMOZI, name: "Alex Hormozi" },
      { tag: "Buffett", profile: BUFFETT, name: "Warren Buffett" },
    ]);

    const [create] = r.labs.called("POST", "/v1/convai/agents/create");
    expect(create!.key).toBe(KEY);
    const config = create!.json as { name: string; conversation_config: Record<string, any>; platform_settings: Record<string, any> };
    expect(config.name).toBe("Zain Board Room");
    const { tts, turn, conversation: convo, agent } = config.conversation_config;
    const labels = (tts.supported_voices as { label: string; voice_id: string }[]).map((v) => v.label);
    expect(labels).toEqual(["Hormozi", "Alwaleed", "Bezos", "Buffett", "Jobs"]);
    expect(tts.supported_voices[0].voice_id).toBe(OWN_VOICE);
    // No chair voice: the default is the first member's, and the founder opens (empty first message).
    expect(tts.voice_id).toBe(OWN_VOICE);
    expect(agent.first_message).toBe("");
    expect(config.conversation_config.language_presets.ar.overrides.agent.first_message).toBe("");
    expect(JSON.stringify(config)).not.toMatch(/Chair|chair/);
    expect(tts.model_id).toBe("eleven_flash_v2");
    expect(config.conversation_config.language_presets.ar).toBeDefined();
    expect(agent.prompt.llm).toBe("claude-haiku-4-5");
    expect(convo.client_events).toContain("interruption");
    expect(turn.turn_timeout).toBeGreaterThan(0);
    expect(config.platform_settings.auth.enable_auth).toBe(true);
    expect(config.platform_settings.overrides.conversation_config_override.agent).toEqual({ prompt: { prompt: true }, first_message: true, language: true });
    expect(JSON.parse(await readFile(join(root, ".zain", "elevenlabs.json"), "utf8")).boardRoom.agentId).toBe(AGENT);
    expect(r.labs.called("GET", "/v1/convai/conversation/get-signed-url")[0]!.query.get("agent_id")).toBe(AGENT);

    await r.session(meeting.id);
    expect(r.labs.called("POST", "/v1/convai/agents/create")).toHaveLength(1);
    expect(r.labs.called("PATCH", "/v1/convai/agents/")).toHaveLength(0);
  });

  it("builds the meeting's prompt from the members' SOULs, the topic and the brief, as an open floor", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    const { overrides } = (await (await r.session(meeting.id)).json()) as LiveSessionResponse;
    const { prompt } = overrides.agent.prompt;
    expect(overrides.agent.language).toBe("en");
    expect(overrides.agent.firstMessage).toBe("");
    expect(prompt).toContain("Cairo office");
    expect(prompt).toContain("Should we open one in 2027?");
    expect(prompt).not.toContain("BRIEFMARKER");
    expect(prompt).toContain("<Hormozi>: Alex Hormozi. Seat: Offers, pricing");
    expect(prompt).toContain("Grand Slam Offers");
    expect(prompt).toContain("<Buffett>: Warren Buffett. Seat: Business finance");
    expect(prompt).toContain("open-floor discussion");
    expect(prompt).toContain("Abdelhalim, the founder, is the CEO of Zain Group. He leads this meeting");
    expect(prompt).toContain("There is no chair");
    expect(prompt).toContain("wait for him to speak first");
    expect(prompt).not.toMatch(/<Chair>|chairs the meeting|the chair (opens|names)/);
    expect(prompt).not.toContain("What the board already knows");
    expect(prompt).toMatch(/Wrap every line in its speaker's tag/);
    expect(prompt).toMatch(/no stage directions/);
    expect(prompt).toMatch(/answers in Arabic/);
    expect(prompt).not.toMatch(/kanban_complete|Hard limits|## Your lens/);
  });

  it("goes item by item when the brief has an agenda", async () => {
    const r = liveRoom();
    const { meeting } = await r.start({ brief: "Agenda:\n1. Budget\n2. Hiring" });
    const { overrides } = (await (await r.session(meeting.id)).json()) as LiveSessionResponse;
    expect(overrides.agent.prompt.prompt).toContain("takes it item by item");
    expect(overrides.agent.firstMessage).toBe("");
  });

  it("updates the agent when a voice changes, and recreates it if it was deleted", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    await r.session(meeting.id);
    const put = await r.send("PUT", `/api/board/voices/${BUFFETT}`, { voiceId: "BuffettVoice0123456789" });
    expect(put.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [patch] = r.labs.called("PATCH", `/v1/convai/agents/${AGENT}`);
    expect((patch!.json as any).conversation_config.tts.supported_voices[3]).toMatchObject({ label: "Buffett", voice_id: "BuffettVoice0123456789" });

    r.labs.state.agentGone = true;
    await r.send("PUT", `/api/board/voices/${BUFFETT}`, { voiceId: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.labs.called("POST", "/v1/convai/agents/create")).toHaveLength(1);
    expect((await r.session(meeting.id)).status).toBe(200);
    expect(r.labs.called("POST", "/v1/convai/agents/create")).toHaveLength(2);
  });

  it("is only for live voice meetings, and needs the key", async () => {
    const r = liveRoom();
    const chat = await r.send("POST", "/api/board/meetings", { topic: "Chat", brief: "Written." });
    expect((await r.session((await chat.json()).meeting.id)).status).toBe(409);
    expect((await r.session("mtg_9999999999")).status).toBe(404);
    expect((await r.session("nope")).status).toBe(400);
    const keyless = liveRoom({ key: null });
    const { meeting } = await keyless.start();
    const res = await keyless.session(meeting.id);
    expect(res.status).toBe(503);
    expect(keyless.labs.calls).toEqual([]);
  });
});

describe("ending a live session", () => {
  it("appends the transcript by speaker and sends the meeting to the board's vote", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    await r.session(meeting.id);
    const res = await r.end(meeting.id, { conversationId: CONV });
    expect(res.status).toBe(200);
    const ended = (await res.json()).meeting as BoardMeeting;
    expect(ended).toMatchObject({ status: "voting", currentRound: 2, discussionRounds: 0, liveConversationIds: [CONV] });
    expect(ended.turns.map((t) => [t.speaker, t.text, t.at, t.round, t.kind])).toEqual([
      ["founder", "Should we open in Cairo?", 1_790_000_104, 1, "discussion"],
      [HORMOZI, "Only with a grand slam offer.", 1_790_000_107, 1, "discussion"],
      [BUFFETT, "And only if the cash comes back.", 1_790_000_107, 1, "discussion"],
      ["founder", "Fair.", 1_790_000_112, 1, "discussion"],
    ]);
    const votes = r.kanban.byTitle("· Vote");
    expect(votes.map((t) => t.assignee)).toEqual([HORMOZI, BUFFETT]);
    const body = votes[0]!.body!;
    expect(body).toContain("Round 2 of 2 · Vote");
    expect(body).toContain("--- Round 1 · Live discussion ---");
    expect(body).toContain("Alex Hormozi: Only with a grand slam offer.");
    expect(body).toContain("Founder (Abdelhalim): Should we open in Cairo?");
    expect(body).toContain("## Live discussion");
    expect(body).not.toContain("## Founder remarks");
    expect(body).toContain("VOTE:");
  });

  it("is idempotent per conversation id", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    await r.session(meeting.id);
    const [a, b] = await Promise.all([r.end(meeting.id, { conversationId: CONV }), r.end(meeting.id, { conversationId: CONV })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const again = (await (await r.end(meeting.id, { conversationId: CONV })).json()).meeting as BoardMeeting;
    expect(again.turns).toHaveLength(4);
    expect(r.kanban.byTitle("· Vote")).toHaveLength(2);
    expect(r.labs.called("GET", "/v1/convai/conversations/")).toHaveLength(1);
    expect((await r.end(meeting.id, { conversationId: "conv_another000000001" })).status).toBe(409);
  });

  it("checkpoints a dropped session so the reconnect carries the discussion on", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    await r.session(meeting.id);
    const checkpoint = (await (await r.end(meeting.id, { conversationId: CONV, final: false })).json()).meeting as BoardMeeting;
    expect(checkpoint).toMatchObject({ status: "live", liveConversationIds: [CONV] });
    expect(checkpoint.turns).toHaveLength(4);
    expect(r.kanban.tasks.size).toBe(0);

    const { overrides } = (await (await r.session(meeting.id)).json()) as LiveSessionResponse;
    expect(overrides.agent.firstMessage).toBe("");
    expect(overrides.agent.prompt.prompt).toContain("## Earlier in this meeting");
    expect(overrides.agent.prompt.prompt).toContain("Hormozi: Only with a grand slam offer.\nBuffett: And only if the cash comes back.\nAbdelhalim: Fair.");

    r.labs.conversations.set("conv_second000000001", conversation({ transcript: [{ role: "user", message: "Let's vote.", time_in_call_secs: 1 }] }));
    const ended = (await (await r.end(meeting.id, { conversationId: "conv_second000000001" })).json()).meeting as BoardMeeting;
    expect(ended.status).toBe("voting");
    expect(ended.liveConversationIds).toEqual([CONV, "conv_second000000001"]);
    expect(ended.turns.at(-1)).toMatchObject({ speaker: "founder", text: "Let's vote." });
  });

  it("waits for the call to finish, then gives up while it is still connected", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    await r.session(meeting.id);
    let polls = 0;
    r.labs.conversations.set(CONV, () => (++polls < 3 ? conversation({ status: "in-progress" }) : conversation({ status: "processing" })));
    expect((await r.end(meeting.id, { conversationId: CONV })).status).toBe(200);
    expect(r.sleeps).toHaveLength(2);

    const s = liveRoom();
    const { meeting: m2 } = await s.start();
    await s.session(m2.id);
    s.labs.conversations.set(CONV, conversation({ status: "in-progress" }));
    const res = await s.end(m2.id, { conversationId: CONV });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("still connected");
    expect((await s.meetings.get(m2.id)).status).toBe("live");
  });

  it("validates the conversation id and its origin", async () => {
    const r = liveRoom();
    const { meeting } = await r.start();
    await r.session(meeting.id);
    for (const body of [{}, { conversationId: "abc" }, { conversationId: "conv_../../x" }, { conversationId: CONV, final: "yes" }]) {
      expect((await r.end(meeting.id, body)).status).toBe(400);
    }
    r.labs.conversations.set("conv_otheragent000001", conversation({ agent_id: "agent_someoneelse001" }));
    expect((await r.end(meeting.id, { conversationId: "conv_otheragent000001" })).status).toBe(400);
    expect((await r.end(meeting.id, { conversationId: "conv_missing000000001" })).status).toBe(404);
    const chat = (await (await r.send("POST", "/api/board/meetings", { topic: "Chat", brief: "Written." })).json()).meeting as BoardMeeting;
    expect((await r.end(chat.id, { conversationId: CONV })).status).toBe(409);
    expect(r.hermesFetch.called(`POST ${KANBAN}/tasks`)).toHaveLength(2);
  });
});

describe("Notion for live meetings", () => {
  it("has a Live status and labels the live round", async () => {
    expect(STATUS_OPTIONS).toContain("Live");
    const r = liveRoom();
    const { meeting } = await r.start();
    expect((meetingProperties(meeting).Status as { select: { name: string } }).select.name).toBe("Live");
    await r.session(meeting.id);
    const ended = (await (await r.end(meeting.id, { conversationId: CONV })).json()).meeting as BoardMeeting;
    expect(JSON.stringify(meetingBlocks(ended))).toContain("Round 1 · Live discussion");
  });
});

describe("live prompt parts", () => {
  it("tags speakers with letters only", () => {
    expect(["default", HORMOZI, "zain-board-alwaleed", "x-2b"].map(speakerTag)).toEqual(["", "Hormozi", "Alwaleed", "B"]);
  });

  it("tells an agenda from a plain brief", () => {
    expect(hasAgenda("Should we open in Cairo? Budget SAR 2m.")).toBe(false);
    expect(hasAgenda("Items:\n- Budget\n- Hiring")).toBe(true);
    expect(hasAgenda("1) Budget\n2) Hiring")).toBe(true);
    expect(hasAgenda("- one bullet only")).toBe(false);
    expect(hasAgenda("Our agenda is short.")).toBe(true);
    expect(hasAgenda("جدول الأعمال: الميزانية")).toBe(true);
  });

  it("condenses a SOUL to the seat and lens, without the brief or the kanban procedure, within the cap", () => {
    const buffett = BOARD_MEMBERS.find((m) => m.profile === BUFFETT)!;
    const text = condenseSoul(boardSoul(buffett, `BRIEFMARKER-BETA.\n\n## Tone\nBRIEFMARKER-GAMMA ${"long words ".repeat(400)}`));
    expect(text.startsWith("Seat: Business finance")).toBe(true);
    expect(text).toContain("Pricing power and moats.");
    expect(text).not.toMatch(/BRIEFMARKER|kanban|Hermes profile|Hard limits|You are Warren|long words/);
    expect(condenseSoul(boardSoul(BOARD_MEMBERS[0]!), null, 200).length).toBeLessThanOrEqual(200);
  });

  it("drops any persona line that repeats the private brief file, even outside the brief section", () => {
    const leaked = "Our private margin target on Cairo retainers is forty two percent.";
    const soul = [
      "# Board · Test",
      "Seat: Offers. Your Hermes profile is `zain-board-hormozi`.",
      "## Your brief",
      "BRIEFMARKER-DELTA",
      "### Private notes",
      "BRIEFMARKER-EPSILON",
      "## Your lens",
      "- Value equation first.",
      `- ${leaked.toUpperCase()}`,
      "- Part of it: *our private margin target* on cairo retainers is forty two percent, as noted.",
    ].join("\n");
    const brief = `Intro BRIEFMARKER-DELTA.\n\n${leaked}\n\n## Private notes\nBRIEFMARKER-EPSILON`;
    const text = condenseSoul(soul, brief);
    expect(text).toBe("Seat: Offers. Value equation first.");
  });

  it("keeps the private brief file's text out of a real session prompt", async () => {
    const leaked = "BRIEFMARKER-ZETA a paragraph only the private brief file should hold.";
    const hormozi = BOARD_MEMBERS.find((m) => m.profile === HORMOZI)!;
    const soul = boardSoul({ ...hormozi, lens: [...hormozi.lens, leaked] }, `## Notes\n${PRIVATE_BRIEF}`);
    await writeFile(join(home, "profiles", HORMOZI, "SOUL.md"), soul);
    await mkdir(join(root, ".zain", "board"), { recursive: true });
    await writeFile(join(root, ".zain", "board", `${HORMOZI}.md`), `${PRIVATE_BRIEF}\n\n${leaked}\n`);
    const r = liveRoom();
    const { meeting } = await r.start();
    const res = await r.session(meeting.id);
    const sent = JSON.stringify(await res.json()) + JSON.stringify(r.labs.calls.map((c) => c.json ?? null));
    expect(sent).not.toContain("BRIEFMARKER");
    expect(sent).toContain("Grand Slam Offers");
  });

  it("tells the room what the board already knows, but never a note or ledger line that repeats a private brief", async () => {
    const secret = "MEMMARKER-OMEGA the founder's private salary floor is SAR 90k a month";
    await mkdir(join(root, ".zain", "board"), { recursive: true });
    await writeFile(join(root, ".zain", "board", `${HORMOZI}.md`), `${PRIVATE_BRIEF}\n\n${secret}\n`);
    const memory = memoryMemoryStore();
    await memory.add(HORMOZI, { insights: ["Founder wants Studio priced as a premium brand.", `Remember: ${secret}, keep it quiet.`], at: 1_789_000_000 });
    await memory.add(BUFFETT, { insights: ["Founder will not take on debt.", "MEMMARKER-OMEGA the founder's private salary floor"], at: 1_789_000_000 });
    const past: BoardMeeting = {
      id: "mtg_00000000aa", topic: "Studio pricing", brief: "b", members: [HORMOZI, BUFFETT], boardOnly: true, discussionRounds: 1,
      status: "concluded", currentRound: 3, turns: [], decision: "approved", conclusion: "Raise retainers by 20%.", requestedBy: "hq", createdAt: 1_789_000_000, updatedAt: 1_789_000_100,
      votes: [
        { member: HORMOZI, vote: "approve", rationale: `As noted, ${secret}.` },
        { member: BUFFETT, vote: "approve", rationale: "Pricing power is the best moat." },
      ],
    };
    const r = liveRoom({ memory, meetingStore: memoryRecordStore<StoredMeeting>([{ id: past.id, meeting: past, rounds: [] }]) });
    const { meeting } = await r.start();
    const res = await r.session(meeting.id);
    const body = (await res.json()) as LiveSessionResponse;
    const sent = JSON.stringify(body) + JSON.stringify(r.labs.calls.map((c) => c.json ?? null));
    expect(sent).not.toMatch(/MEMMARKER|BRIEFMARKER|salary floor/);
    const { prompt } = body.overrides.agent.prompt;
    expect(prompt).toContain("## What the board already knows");
    expect(prompt).toContain(`"Studio pricing" → approved`);
    expect(prompt).toContain("Warren Buffett: approve — Pricing power is the best moat.");
    expect(prompt).not.toContain("Alex Hormozi: approve");
    expect(prompt).toContain("### Alex Hormozi remembers\n- 2026-09-10: Founder wants Studio priced as a premium brand.");
    expect(prompt).toContain("Founder will not take on debt.");
    expect(prompt.length).toBeLessThan(12_000);
  });

  it("keeps the live prompt under 12k characters with a full memory", async () => {
    const memory = memoryMemoryStore();
    for (const p of [HORMOZI, BUFFETT]) {
      for (let i = 0; i < 40; i++) await memory.add(p, { insights: [`Insight ${i} for ${p}: ${"durable detail ".repeat(12)}`], at: 1_789_000_000 + i });
    }
    const stored = Array.from({ length: 12 }, (_, i): StoredMeeting => {
      const id = `mtg_00000001${String(i).padStart(2, "0")}`;
      const m: BoardMeeting = {
        id, topic: `Past topic ${i} ${"x".repeat(100)}`, brief: "b", members: [HORMOZI, BUFFETT], boardOnly: true, discussionRounds: 1, status: "concluded",
        currentRound: 3, turns: [], decision: "rejected", conclusion: "long minutes ".repeat(200), requestedBy: "hq", createdAt: 1_789_000_000 + i, updatedAt: 1_789_000_000 + i,
        votes: [{ member: HORMOZI, vote: "reject", rationale: "because ".repeat(100) }, { member: BUFFETT, vote: "reject", rationale: "no ".repeat(100) }],
      };
      return { id, meeting: m, rounds: [] };
    });
    const dashboard = `Updated: ${new Date().toISOString()} · by coo\n\n| Metric | Value |\n|---|---|\n| Active clients | 5 |\n${"| Detail | row |\n".repeat(400)}`;
    const r = liveRoom({ memory, meetingStore: memoryRecordStore(stored), dashboard });
    const { meeting } = await r.start({ brief: "Should we open one in 2027? ".repeat(10) });
    const { prompt } = ((await (await r.session(meeting.id)).json()) as LiveSessionResponse).overrides.agent.prompt;
    expect(prompt).toContain("Insight 39 for zain-board-hormozi");
    expect(prompt).toContain("## Company dashboard");
    expect(prompt).toContain("| Active clients | 5 |");
    expect(prompt.length).toBeLessThan(14_000);
  });

  it("reads no SOUL for a profile that is not a plain name", async () => {
    expect(await fileSouls(home)("../../etc")).toBeNull();
    expect(await fileSouls(home)(HORMOZI)).toContain(PRIVATE_BRIEF);
  });
});
