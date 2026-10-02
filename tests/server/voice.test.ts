import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardMeeting } from "../../shared/meetings";
import { CHAIR_PROFILE, TRANSCRIBE_MAX_BYTES, type VoicesResponse } from "../../shared/voice";
import type { FetchLike } from "../../server/src/hermes/client";
import { STOCK_VOICES, fileVoiceStore, memoryVoiceStore } from "../../server/src/voice/assignments";
import { ElevenLabsClient, envApiKey } from "../../server/src/voice/elevenlabs";
import { VoiceService } from "../../server/src/voice/service";
import { fakeKanban } from "./fakeKanban";
import { json, setup } from "./helpers";

const KEY = "sk_elevenlabsSecretKey0123456789abcdef";
const HORMOZI = "zain-board-hormozi";
const BUFFETT = "zain-board-buffett";
const OWN_VOICE = "OwnVoice0123456789ab";
const MP3: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1, 2, 3]);

interface LabsCall {
  url: URL;
  key: string | null;
  json?: Record<string, unknown>;
  form?: FormData;
}

/** A stand-in for api.elevenlabs.io; `respond` may return a Response, or nothing for the default success. */
function fakeLabs(respond: (call: LabsCall) => Response | undefined | Promise<Response | undefined> = () => undefined) {
  const calls: LabsCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const headers = new Headers(init?.headers);
    const call: LabsCall = {
      url: new URL(input),
      key: headers.get("xi-api-key"),
      ...(typeof init?.body === "string" ? { json: JSON.parse(init.body) } : {}),
      ...(init?.body instanceof FormData ? { form: init.body } : {}),
    };
    calls.push(call);
    const out = await respond(call);
    if (out) return out;
    return call.url.pathname.endsWith("/speech-to-text") ? json({ text: " مرحبا, let's vote. " }) : new Response(MP3);
  };
  return { fetchImpl, calls };
}

let root: string;
const logs: string[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zain-voice-"));
  logs.length = 0;
});
afterEach(() => rm(root, { recursive: true, force: true }));

function voiceRoom(opts: { key?: string | null; respond?: Parameters<typeof fakeLabs>[0]; own?: Record<string, string> } = {}) {
  const labs = fakeLabs(opts.respond);
  const key = opts.key === undefined ? KEY : opts.key;
  const client = new ElevenLabsClient(async () => key, labs.fetchImpl, (l) => logs.push(l));
  const voice = new VoiceService({ root, client, store: memoryVoiceStore(opts.own), log: (l) => logs.push(l) });
  const kanban = fakeKanban([HORMOZI, BUFFETT]);
  const s = setup(kanban.routes, { voice, onTurns: (m, from) => voice.prefetch(m, from) });
  const audio = (id: string, index: number | string, headers: Record<string, string> = {}) =>
    s.send("GET", `/api/board/meetings/${id}/turns/${index}/audio`, undefined, headers);
  const transcribe = (body: Uint8Array<ArrayBuffer>, type = "audio/webm;codecs=opus", headers: Record<string, string> = {}) =>
    s.app.request("/api/board/voice/transcribe", { method: "POST", headers: { Host: "127.0.0.1:8787", "Content-Type": type, ...headers }, body });
  /** A meeting whose opening round is answered (turns 0, 1) and the founder has spoken (turn 2). */
  const meetingWithTurns = async (mode: "chat" | "voice" = "chat") => {
    const res = await s.send("POST", "/api/board/meetings", { topic: "Cairo office", brief: "Open one in 2027?", mode });
    const { meeting } = (await res.json()) as { meeting: BoardMeeting };
    kanban.completeAll("· Opening", (t) => `**${t.assignee}** says: see [the plan](https://x.test/plan). Cairo is promising.`);
    await s.meetings.tick();
    await s.send("POST", `/api/board/meetings/${meeting.id}/remarks`, { text: "Go on.", next: "continue" });
    return s.meetings.get(meeting.id);
  };
  return { ...s, labs, audio, transcribe, meetingWithTurns };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("ElevenLabs client", () => {
  it("speaks with the multilingual model and the key in xi-api-key", async () => {
    const labs = fakeLabs();
    const audio = await new ElevenLabsClient(async () => KEY, labs.fetchImpl).speak("JBFqnCBsd6RMkjVDRZzb", "Hello");
    expect([...audio]).toEqual([...MP3]);
    const call = labs.calls[0]!;
    expect(`${call.url.origin}${call.url.pathname}`).toBe("https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb");
    expect(call.url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(call.key).toBe(KEY);
    expect(call.json).toEqual({ text: "Hello", model_id: "eleven_multilingual_v2" });
  });

  it("transcribes a multipart upload with scribe_v1", async () => {
    const labs = fakeLabs();
    const text = await new ElevenLabsClient(async () => KEY, labs.fetchImpl).transcribe(MP3, "audio/webm;codecs=opus");
    expect(text).toBe("مرحبا, let's vote.");
    const form = labs.calls[0]!.form!;
    expect(labs.calls[0]!.url.href).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(form.get("model_id")).toBe("scribe_v1");
    const file = form.get("file") as File;
    expect(file.name).toBe("speech.webm");
    expect(file.size).toBe(MP3.byteLength);
  });

  it("gives 503 without a key and never calls out", async () => {
    const labs = fakeLabs();
    const client = new ElevenLabsClient(async () => null, labs.fetchImpl);
    await expect(client.speak("JBFqnCBsd6RMkjVDRZzb", "Hi")).rejects.toMatchObject({ status: 503, message: "ElevenLabs is not configured" });
    expect(labs.calls).toEqual([]);
  });

  it.each([
    [401, { detail: { status: "invalid_api_key", message: `bad key ${KEY}` } }, 502, "rejected the API key"],
    [401, { detail: { status: "quota_exceeded", message: "out of credits" } }, 429, "quota exceeded"],
    [429, { detail: "slow down" }, 429, "busy"],
    [404, { detail: { status: "voice_not_found" } }, 502, "could not find this voice"],
    [500, "oops", 502, "speech failed (HTTP 500)"],
  ])("maps upstream %i to a clean error %#", async (status, body, mapped, message) => {
    const labs = fakeLabs(() => (typeof body === "string" ? new Response(body, { status }) : json(body, status)));
    const lines: string[] = [];
    const err = (await new ElevenLabsClient(async () => KEY, labs.fetchImpl, (l) => lines.push(l)).speak("JBFqnCBsd6RMkjVDRZzb", "x").catch((e) => e)) as Error & { status: number };
    expect(err.status).toBe(mapped);
    expect(err.message).toContain(message);
    expect(err.message).not.toContain(KEY);
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("maps unreadable audio to 422 and timeouts to 504", async () => {
    const bad = fakeLabs(() => json({ detail: { message: "invalid audio" } }, 400));
    await expect(new ElevenLabsClient(async () => KEY, bad.fetchImpl, () => undefined).transcribe(MP3, "audio/ogg")).rejects.toMatchObject({ status: 422 });
    const slow = fakeLabs(() => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })));
    await expect(new ElevenLabsClient(async () => KEY, slow.fetchImpl).speak("JBFqnCBsd6RMkjVDRZzb", "x")).rejects.toMatchObject({ status: 504 });
    const down = fakeLabs(() => Promise.reject(new TypeError("fetch failed")));
    await expect(new ElevenLabsClient(async () => KEY, down.fetchImpl).speak("JBFqnCBsd6RMkjVDRZzb", "x")).rejects.toMatchObject({ status: 502 });
  });

  it("reads ELEVENLABS_API_KEY from the profile's .env at call time", async () => {
    const source = envApiKey(root);
    expect(await source()).toBeNull();
    await writeFile(join(root, ".env"), `NOTION_API_KEY=x\nELEVENLABS_API_KEY="${KEY}"\n`);
    expect(await source()).toBe(KEY);
  });
});

describe("voice assignments", () => {
  it("gives the chair and every board seat a distinct stock voice by default", async () => {
    const r = voiceRoom();
    const res = (await (await r.send("GET", "/api/board/voices")).json()) as VoicesResponse;
    expect(res.configured).toBe(true);
    expect(res.voices[0]).toEqual({ profile: CHAIR_PROFILE, voiceId: STOCK_VOICES[0], fallback: true });
    expect(res.voices.map((v) => v.profile)).toContain(HORMOZI);
    expect(res.voices.every((v) => v.fallback)).toBe(true);
    expect(new Set(res.voices.map((v) => v.voiceId)).size).toBe(res.voices.length);
    expect(r.labs.calls).toEqual([]);
  });

  it("reports configured: false without a key", async () => {
    const r = voiceRoom({ key: null });
    expect(((await (await r.send("GET", "/api/board/voices")).json()) as VoicesResponse).configured).toBe(false);
  });

  it("sets and clears a member's own voice, validating the id and the speaker", async () => {
    const r = voiceRoom();
    const put = (profile: string, body: unknown) => r.send("PUT", `/api/board/voices/${profile}`, body);
    let res = (await (await put(HORMOZI, { voiceId: OWN_VOICE })).json()) as VoicesResponse;
    expect(res.voices.find((v) => v.profile === HORMOZI)).toEqual({ profile: HORMOZI, voiceId: OWN_VOICE, fallback: false });
    res = (await (await put(HORMOZI, { voiceId: null })).json()) as VoicesResponse;
    expect(res.voices.find((v) => v.profile === HORMOZI)!.fallback).toBe(true);

    expect((await put(HORMOZI, { voiceId: "short" })).status).toBe(400);
    expect((await put(HORMOZI, { voiceId: "has spaces in it!!" })).status).toBe(400);
    expect((await put(HORMOZI, {})).status).toBe(400);
    expect((await put("zain-hq-coo", { voiceId: OWN_VOICE })).status).toBe(404);
    expect((await put("founder", { voiceId: OWN_VOICE })).status).toBe(404);
    expect((await put(CHAIR_PROFILE, { voiceId: OWN_VOICE })).status).toBe(200);
  });

  it("persists to .zain/voices.json and ignores invalid entries", async () => {
    const store = fileVoiceStore(root);
    expect(await store.read()).toEqual({});
    await Promise.all([store.set(HORMOZI, OWN_VOICE), store.set(BUFFETT, STOCK_VOICES[1])]);
    expect(JSON.parse(await readFile(join(root, ".zain", "voices.json"), "utf8"))).toEqual({ [HORMOZI]: OWN_VOICE, [BUFFETT]: STOCK_VOICES[1] });
    await writeFile(join(root, ".zain", "voices.json"), JSON.stringify({ [HORMOZI]: "bad id!", [BUFFETT]: OWN_VOICE }));
    expect(await store.read()).toEqual({ [BUFFETT]: OWN_VOICE });
  });
});

describe("turn audio", () => {
  it("speaks a board turn in its member's voice, cleaned of markdown, and caches it on disk", async () => {
    const r = voiceRoom({ own: { [HORMOZI]: OWN_VOICE } });
    const m = await r.meetingWithTurns();
    expect(m.turns.map((t) => t.speaker)).toEqual([HORMOZI, BUFFETT, "founder"]);
    const res = await r.audio(m.id, 0);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...MP3]);
    expect(r.labs.calls).toHaveLength(1);
    expect(r.labs.calls[0]!.url.pathname).toBe(`/v1/text-to-speech/${OWN_VOICE}`);
    expect(r.labs.calls[0]!.json!.text).toBe(`${HORMOZI} says: see the plan. Cairo is promising.`);
    const cached = await readdir(join(root, ".zain", "voice-cache"));
    expect(cached).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.mp3$/)]);

    const again = await r.audio(m.id, 0);
    expect(again.status).toBe(200);
    expect(again.headers.get("etag")).toBe(`"${cached[0]!.replace(".mp3", "")}"`);
    expect(r.labs.calls).toHaveLength(1);
    expect((await r.audio(m.id, 0, { "If-None-Match": again.headers.get("etag")! })).status).toBe(304);

    await r.audio(m.id, 1);
    const buffettVoice = (await r.voice.voices()).voices.find((v) => v.profile === BUFFETT)!;
    expect(buffettVoice.fallback).toBe(true);
    expect(r.labs.calls[1]!.url.pathname).toBe(`/v1/text-to-speech/${buffettVoice.voiceId}`);
  });

  it("dedupes concurrent requests for the same clip", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const r = voiceRoom({ respond: async () => (await gate, undefined) });
    const m = await r.meetingWithTurns();
    const pending = Promise.all([r.audio(m.id, 0), r.audio(m.id, 0), r.audio(m.id, 0)]);
    await flush();
    release();
    expect((await pending).map((x) => x.status)).toEqual([200, 200, 200]);
    expect(r.labs.calls).toHaveLength(1);
  });

  it("404s founder turns and bad indexes; 503s without a key", async () => {
    const r = voiceRoom();
    const m = await r.meetingWithTurns();
    for (const index of [2, 3, 99, "-1", "1.5", "x", "01"]) expect((await r.audio(m.id, index)).status).toBe(404);
    expect((await r.audio("mtg_9999999999", 0)).status).toBe(404);
    expect((await r.audio("nope", 0)).status).toBe(400);
    expect(r.labs.calls).toEqual([]);

    const unconfigured = voiceRoom({ key: null });
    const m2 = await unconfigured.meetingWithTurns();
    const res = await unconfigured.audio(m2.id, 0);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ElevenLabs is not configured" });
  });

  it("passes upstream failures through as JSON errors without the key", async () => {
    const r = voiceRoom({ respond: () => json({ detail: { status: "invalid_api_key", message: KEY } }, 401) });
    const m = await r.meetingWithTurns();
    const res = await r.audio(m.id, 0);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("prefetches new board turns of voice meetings only", async () => {
    const chat = voiceRoom();
    await chat.meetingWithTurns("chat");
    await flush();
    expect(chat.labs.calls).toEqual([]);

    const live = voiceRoom();
    const m = await live.meetingWithTurns("voice");
    await flush();
    expect(m.mode).toBe("voice");
    expect(live.labs.calls).toHaveLength(2);
    expect((await live.audio(m.id, 0)).status).toBe(200);
    expect(live.labs.calls).toHaveLength(2);
  });
});

describe("transcription", () => {
  it("returns the transcript of a recording larger than the JSON body limit", async () => {
    const r = voiceRoom();
    const res = await r.transcribe(new Uint8Array(200 * 1024), "audio/mp4");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "مرحبا, let's vote." });
    expect((r.labs.calls[0]!.form!.get("file") as File).name).toBe("speech.mp4");
  });

  it("refuses oversize, empty, non-audio and cross-origin uploads", async () => {
    const r = voiceRoom();
    expect((await r.transcribe(new Uint8Array(TRANSCRIBE_MAX_BYTES + 1))).status).toBe(413);
    expect((await r.transcribe(new Uint8Array(0))).status).toBe(400);
    expect((await r.transcribe(MP3, "application/json")).status).toBe(415);
    expect((await r.transcribe(MP3, "text/plain")).status).toBe(415);
    expect((await r.transcribe(MP3, "audio/webm", { Origin: "https://evil.test" })).status).toBe(403);
    expect(r.labs.calls).toEqual([]);
  });

  it("does not let other writes use an audio content type", async () => {
    const r = voiceRoom();
    const res = await r.app.request("/api/board/meetings", { method: "POST", headers: { Host: "127.0.0.1:8787", "Content-Type": "audio/webm" }, body: MP3 });
    expect(res.status).toBe(415);
  });
});

describe("meeting mode", () => {
  it("defaults to chat and rejects unknown modes", async () => {
    const r = voiceRoom();
    const start = (body: Record<string, unknown>) => r.send("POST", "/api/board/meetings", { topic: "T", brief: "B", ...body });
    expect(((await (await start({})).json()).meeting as BoardMeeting).mode).toBe("chat");
    expect(((await (await start({ mode: "voice" })).json()).meeting as BoardMeeting).mode).toBe("voice");
    const bad = await start({ mode: "video" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("mode");
  });
});
