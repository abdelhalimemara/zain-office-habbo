import { Conversation, type Mode, type PartialOptions, type Status } from "@elevenlabs/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardMeeting } from "@shared/meetings";
import type { LiveSpeaker } from "@shared/voice";
import { api, ApiRequestError } from "../api/client";
import { meetingKeys } from "../api/meetingHooks";
import { addMessage, currentSpeaker, joinError, latestAgentParts, nextUserTalking, type Caption, type LiveError } from "./liveModel";

type Session = Awaited<ReturnType<typeof Conversation.startSession>>;

/**
 * idle: not in the room (before joining, or after leaving). joining: mic, signed URL, socket.
 * connected: in the room. dropped: the call ended without the founder leaving; rejoining starts a new session.
 * ending: closing the call and handing the transcript to the board. ended: the meeting has moved on to the vote.
 */
export type LivePhase = "idle" | "joining" | "connected" | "dropped" | "ending" | "ended";

export interface LiveRoom {
  phase: LivePhase;
  status: Status;
  mode: Mode;
  captions: readonly Caption[];
  /** The members the agent voices, from the session; empty until joined. */
  speakers: readonly LiveSpeaker[];
  /** Profile (or FOUNDER) to light in the seat strip. */
  speaker: string | null;
  muted: boolean;
  /** Mic input level, 0..1. */
  inputLevel: number;
  /** Unix ms the current call connected, for the timer. */
  connectedAt: number | null;
  now: number;
  error: LiveError | null;
  /** True once there is a session to hand to the board, so "End meeting & vote" can work. */
  canEnd: boolean;
  /** Posting an ended session's transcript to the server; joining waits for it. */
  saving: boolean;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
  end: () => void;
}

/** How often the mic meter, speaker estimate and call timer refresh. */
export const LIVE_TICK_MS = 100;

/** sessionStorage key for a meeting's sessions not yet handed to the server, so a reload doesn't lose them. */
export const UNSAVED_KEY_PREFIX = "zui.live.unsaved.";

function loadUnsaved(meetingId: string): string[] {
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(UNSAVED_KEY_PREFIX + meetingId) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

function saveUnsaved(meetingId: string, ids: readonly string[]): void {
  try {
    if (ids.length) window.sessionStorage.setItem(UNSAVED_KEY_PREFIX + meetingId, JSON.stringify(ids));
    else window.sessionStorage.removeItem(UNSAVED_KEY_PREFIX + meetingId);
  } catch {
    return;
  }
}

/** The server answers 409 while ElevenLabs still has the call open; one more try after it hangs up. */
export const END_RETRY_MS = 1500;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkMic(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("No microphone API", "NotFoundError");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

/** One live board room on @elevenlabs/client: always-on mic, captions per speaker, and the hand-over to the vote. */
export function useLiveRoom(meeting: Pick<BoardMeeting, "id" | "liveConversationIds">): LiveRoom {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [status, setStatus] = useState<Status>("disconnected");
  const [mode, setMode] = useState<Mode>("listening");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [speakers, setSpeakers] = useState<LiveSpeaker[]>([]);
  const [muted, setMuted] = useState(false);
  const [userTalking, setUserTalking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [agentSince, setAgentSince] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<LiveError | null>(null);
  /** Sessions held but not yet posted to /live/end; each must reach the server or its turns are lost. */
  const [unsaved, setUnsavedState] = useState<string[]>(() => loadUnsaved(meeting.id));
  const unsavedRef = useRef(unsaved);
  const [saving, setSaving] = useState(false);
  /** The session connected right now; it is saved once it ends, never while it runs. */
  const activeRef = useRef<string | null>(null);
  const flushRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  const convRef = useRef<Session | null>(null);
  /** Bumped on every join, leave and end, so callbacks from an older session are ignored. */
  const genRef = useRef(0);
  const speakersRef = useRef<LiveSpeaker[]>([]);
  const mutedRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const setUnsaved = useCallback(
    (ids: string[]) => {
      unsavedRef.current = ids;
      saveUnsaved(meeting.id, ids);
      setUnsavedState(ids);
    },
    [meeting.id],
  );
  const remember = useCallback((id: string) => !unsavedRef.current.includes(id) && setUnsaved([...unsavedRef.current, id]), [setUnsaved]);

  const postEnd = useCallback(
    async (conversationId: string, final: boolean, keepalive = false) => {
      try {
        return await api.endLive(meeting.id, { conversationId, final }, keepalive);
      } catch (err) {
        if (!(err instanceof ApiRequestError && err.status === 409)) throw err;
        await new Promise((r) => setTimeout(r, END_RETRY_MS));
        return api.endLive(meeting.id, { conversationId, final }, keepalive);
      }
    },
    [meeting.id],
  );

  /**
   * Posts every ended, unsaved session with final:false: its turns join the meeting, which stays live, and the next
   * session's prompt includes them. Runs one at a time; `except` is left for the caller (the final hand-over).
   */
  const flush = useCallback(
    (except?: string): Promise<void> => {
      const run = flushRef.current
        .catch(() => undefined)
        .then(async () => {
          const ids = unsavedRef.current.filter((id) => id !== activeRef.current && id !== except);
          if (!ids.length) return;
          if (mountedRef.current) setSaving(true);
          try {
            for (const id of ids) {
              const res = await postEnd(id, false);
              setUnsaved(unsavedRef.current.filter((x) => x !== id));
              if (mountedRef.current) qc.setQueryData(meetingKeys.one(meeting.id), res);
            }
          } finally {
            if (mountedRef.current) setSaving(false);
          }
        });
      flushRef.current = run;
      return run;
    },
    [meeting.id, qc, postEnd, setUnsaved],
  );

  const saveEnded = useCallback(() => {
    flush().catch((err: unknown) => {
      if (mountedRef.current) setError({ kind: "save", message: `Couldn't save the last session for the board: ${errorText(err)}` });
    });
  }, [flush]);

  const resetCall = useCallback(() => {
    setStatus("disconnected");
    setMode("listening");
    setUserTalking(false);
    setInputLevel(0);
    setConnectedAt(null);
  }, []);

  const hangUp = useCallback(() => {
    genRef.current++;
    activeRef.current = null;
    const conv = convRef.current;
    convRef.current = null;
    return conv ? conv.endSession().catch(() => undefined) : Promise.resolve();
  }, []);

  const join = useCallback(() => {
    if (phaseRef.current === "joining" || phaseRef.current === "connected" || phaseRef.current === "ending") return;
    void hangUp();
    const gen = genRef.current;
    const stale = () => gen !== genRef.current;
    setError(null);
    setPhase("joining");
    phaseRef.current = "joining";
    void (async () => {
      try {
        await checkMic();
        try {
          await flush();
        } catch (err) {
          if (stale()) return;
          resetCall();
          setPhase("idle");
          setError({ kind: "save", message: `Couldn't save the last session, so the board can't pick up from it: ${errorText(err)}` });
          return;
        }
        if (stale()) return;
        const session = await api.liveSession(meeting.id);
        if (stale()) return;
        speakersRef.current = session.speakers;
        setSpeakers(session.speakers);
        const conv = await Conversation.startSession({
          signedUrl: session.signedUrl,
          connectionType: "websocket",
          overrides: session.overrides as PartialOptions["overrides"],
          onConnect: ({ conversationId: id }) => {
            if (stale()) return;
            activeRef.current = id;
            remember(id);
            setConnectedAt(Date.now());
            setPhase("connected");
          },
          onDisconnect: (details) => {
            if (stale()) return;
            convRef.current = null;
            activeRef.current = null;
            resetCall();
            saveEnded();
            if (details.reason === "user") return setPhase("idle");
            setPhase("dropped");
            setError({
              kind: "session",
              message: details.reason === "error" ? `The connection dropped: ${details.message}` : "The room closed the call.",
            });
          },
          onError: (message) => {
            if (!stale()) setError({ kind: "session", message });
          },
          onMessage: (msg) => {
            if (stale()) return;
            setCaptions((c) => addMessage(c, msg, speakersRef.current));
            if (msg.role === "agent") setAgentSince(Date.now());
          },
          onModeChange: ({ mode: next }) => {
            if (stale()) return;
            setMode(next);
            if (next === "speaking") {
              setAgentSince(Date.now());
              setUserTalking(false);
            }
          },
          onStatusChange: ({ status: next }) => {
            if (!stale()) setStatus(next);
          },
          onVadScore: ({ vadScore }) => {
            if (!stale()) setUserTalking((t) => nextUserTalking(t, vadScore));
          },
        });
        if (stale()) {
          void conv.endSession().catch(() => undefined);
          return;
        }
        convRef.current = conv;
        conv.setMicMuted(mutedRef.current);
        if (conv.getId()) {
          activeRef.current = conv.getId();
          remember(conv.getId());
        }
        setConnectedAt((at) => at ?? Date.now());
        setPhase("connected");
      } catch (err) {
        if (stale()) return;
        resetCall();
        setPhase("idle");
        setError(joinError(err));
      }
    })();
  }, [meeting.id, hangUp, resetCall, flush, remember, saveEnded]);

  const leave = useCallback(() => {
    void hangUp().then(saveEnded);
    resetCall();
    setPhase("idle");
  }, [hangUp, resetCall, saveEnded]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    convRef.current?.setMicMuted(mutedRef.current);
    setMuted(mutedRef.current);
  }, []);

  const handoverId = unsaved.at(-1) ?? meeting.liveConversationIds?.at(-1) ?? null;

  const end = useCallback(() => {
    if (!handoverId || phaseRef.current === "ending") return;
    const last = unsavedRef.current.at(-1) ?? handoverId;
    setError(null);
    setPhase("ending");
    phaseRef.current = "ending";
    void (async () => {
      await hangUp();
      resetCall();
      try {
        await flush(last);
        const res = await postEnd(last, true);
        setUnsaved([]);
        qc.setQueryData(meetingKeys.one(meeting.id), res);
        void qc.invalidateQueries({ queryKey: meetingKeys.list });
        setPhase("ended");
      } catch (err) {
        setPhase("idle");
        setError({ kind: "end", message: `Couldn't hand the meeting to the board: ${errorText(err)}` });
      }
    })();
  }, [handoverId, meeting.id, hangUp, resetCall, qc, flush, postEnd, setUnsaved]);

  // A session left unsaved by an earlier visit (reload, crash) is saved before the founder can rejoin.
  useEffect(() => {
    mountedRef.current = true;
    if (unsavedRef.current.length) saveEnded();
    return () => {
      mountedRef.current = false;
    };
  }, [saveEnded]);

  // Closing the panel or the page ends the call and saves it; keepalive lets the save outlive the page.
  useEffect(() => {
    const saveOnExit = () => {
      for (const id of unsavedRef.current)
        void api.endLive(meeting.id, { conversationId: id, final: false }, true).then(
          () => setUnsaved(unsavedRef.current.filter((x) => x !== id)),
          () => undefined,
        );
    };
    const onHide = () => {
      void hangUp();
      saveOnExit();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void hangUp().then(saveOnExit);
    };
  }, [hangUp, meeting.id, setUnsaved]);

  useEffect(() => {
    if (phase !== "connected") return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      const level = convRef.current?.getInputVolume();
      setInputLevel(typeof level === "number" && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0);
    }, LIVE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  const speaker = phase === "connected" ? currentSpeaker({ mode, userTalking: userTalking && !muted, parts: latestAgentParts(captions), elapsedMs: now - agentSince }) : null;

  return {
    phase,
    status,
    mode,
    captions,
    speakers,
    speaker,
    muted,
    inputLevel: muted ? 0 : inputLevel,
    connectedAt,
    now,
    error,
    canEnd: handoverId !== null,
    saving,
    join,
    leave,
    toggleMute,
    end,
  };
}
