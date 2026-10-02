import { Conversation, type Mode, type PartialOptions, type Status } from "@elevenlabs/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardMeeting } from "@shared/meetings";
import type { LiveSpeaker } from "@shared/voice";
import { api } from "../api/client";
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
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
  end: () => void;
}

/** How often the mic meter, speaker estimate and call timer refresh. */
export const LIVE_TICK_MS = 100;

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
  const [conversationId, setConversationId] = useState<string | null>(null);

  const convRef = useRef<Session | null>(null);
  /** Bumped on every join, leave and end, so callbacks from an older session are ignored. */
  const genRef = useRef(0);
  const speakersRef = useRef<LiveSpeaker[]>([]);
  const mutedRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const resetCall = useCallback(() => {
    setStatus("disconnected");
    setMode("listening");
    setUserTalking(false);
    setInputLevel(0);
    setConnectedAt(null);
  }, []);

  const hangUp = useCallback(() => {
    genRef.current++;
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
            setConversationId(id);
            setConnectedAt(Date.now());
            setPhase("connected");
          },
          onDisconnect: (details) => {
            if (stale()) return;
            convRef.current = null;
            resetCall();
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
        setConversationId((id) => id ?? (conv.getId() || null));
        setConnectedAt((at) => at ?? Date.now());
        setPhase("connected");
      } catch (err) {
        if (stale()) return;
        resetCall();
        setPhase("idle");
        setError(joinError(err));
      }
    })();
  }, [meeting.id, hangUp, resetCall]);

  const leave = useCallback(() => {
    void hangUp();
    resetCall();
    setPhase("idle");
  }, [hangUp, resetCall]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    convRef.current?.setMicMuted(mutedRef.current);
    setMuted(mutedRef.current);
  }, []);

  const handoverId = conversationId ?? meeting.liveConversationIds?.at(-1) ?? null;

  const end = useCallback(() => {
    if (!handoverId || phaseRef.current === "ending") return;
    setError(null);
    setPhase("ending");
    phaseRef.current = "ending";
    void (async () => {
      await hangUp();
      resetCall();
      try {
        const res = await api.endLive(meeting.id, { conversationId: handoverId });
        qc.setQueryData(meetingKeys.one(meeting.id), res);
        void qc.invalidateQueries({ queryKey: meetingKeys.list });
        setPhase("ended");
      } catch (err) {
        setPhase("idle");
        setError({ kind: "end", message: `Couldn't hand the meeting to the board: ${err instanceof Error ? err.message : String(err)}` });
      }
    })();
  }, [handoverId, meeting.id, hangUp, resetCall, qc]);

  // Leaving the panel or the page ends the call; rejoining opens a new session.
  useEffect(() => {
    const onHide = () => void hangUp();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void hangUp();
    };
  }, [hangUp]);

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
    join,
    leave,
    toggleMute,
    end,
  };
}
