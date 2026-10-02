import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MEETINGS_API } from "../../../shared/meetings";
import { TRANSCRIBE_MAX_BYTES, VOICE_API, VOICE_ID_PATTERN, type TranscribeResponse } from "../../../shared/voice";
import type { MeetingEngine } from "../board/meetings/engine";
import { meetingIdParam } from "../board/meetings/validate";
import { HttpError, badRequest, readJsonObject } from "../http";
import { parseEndLive, type LiveService } from "./live";
import type { VoiceService } from "./service";

const TURN_INDEX = /^(0|[1-9][0-9]{0,5})$/;

export function parseVoiceId(body: Record<string, unknown>): string | null {
  const { voiceId } = body;
  if (voiceId === null) return null;
  if (typeof voiceId !== "string" || !VOICE_ID_PATTERN.test(voiceId)) throw badRequest("voiceId must be an ElevenLabs voice id or null");
  return voiceId;
}

/**
 * Voice board meetings (shared/voice.ts VOICE_API and LIVE_API). Audio is served with an ETag of its cache key
 * and `no-cache`, so a changed voice assignment is picked up on the next play.
 */
export function voiceRoutes(app: Hono, voice: VoiceService, meetings: MeetingEngine, live?: LiveService): void {
  const liveRoom = () => {
    if (!live) throw new HttpError(503, "live meetings are not set up on this server");
    return live;
  };
  app.get(VOICE_API.voices, async (c) => c.json(await voice.voices()));

  app.put(`${VOICE_API.voices}/:profile`, async (c) => {
    const voiceId = parseVoiceId(await readJsonObject(c));
    const res = await voice.setVoice(c.req.param("profile"), voiceId);
    // The board room agent picks up the new voice now; failing that, at the next session.
    live?.refreshVoices().catch((err: unknown) => console.warn(`voice: board room voices not updated (${err instanceof Error ? err.message : "error"})`));
    return c.json(res);
  });

  app.post(`${MEETINGS_API.list}/:id/live`, async (c) => c.json(await liveRoom().session(meetingIdParam(c.req.param("id")))));

  app.post(`${MEETINGS_API.list}/:id/live/end`, async (c) => {
    const id = meetingIdParam(c.req.param("id"));
    return c.json({ meeting: await liveRoom().end(id, parseEndLive(await readJsonObject(c))) });
  });

  app.get(`${MEETINGS_API.list}/:id/turns/:index/audio`, async (c) => {
    const meeting = await meetings.get(meetingIdParam(c.req.param("id")));
    const index = c.req.param("index");
    if (!TURN_INDEX.test(index)) throw new HttpError(404, `meeting ${meeting.id} has no turn ${index}`);
    const clip = await voice.clip(meeting, Number(index));
    const etag = `"${clip.key}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    const audio = await voice.audio(clip);
    return c.body(audio as Uint8Array<ArrayBuffer>, 200, { ...headers, "Content-Type": "audio/mpeg", "Content-Length": String(audio.byteLength) });
  });

  app.post(
    VOICE_API.transcribe,
    bodyLimit({
      maxSize: TRANSCRIBE_MAX_BYTES,
      onError: () => {
        throw new HttpError(413, "recording is too large");
      },
    }),
    async (c) => {
      // The origin guard has already required an audio/* Content-Type here.
      const audio = new Uint8Array(await c.req.arrayBuffer());
      if (audio.byteLength === 0) throw badRequest("recording is empty");
      const res: TranscribeResponse = { text: await voice.transcribe(audio, c.req.header("content-type")!) };
      return c.json(res);
    },
  );
}
