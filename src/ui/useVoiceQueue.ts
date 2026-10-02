import { useCallback, useEffect, useRef, useState } from "react";
import type { MeetingTurn } from "@shared/meetings";
import { api, ApiRequestError } from "../api/client";
import { audioFailure, loadMuted, loadPlayed, nextUnplayed, saveMuted, savePlayed, unplayedCount } from "./voiceModel";

/**
 * idle: nothing loaded, the queue picks the next unheard turn. loading: fetching audio. playing / paused.
 * blocked: the browser refused autoplay; a click on "Start listening" resumes.
 */
export type QueueStatus = "idle" | "loading" | "playing" | "paused" | "blocked";

export interface VoiceQueue {
  status: QueueStatus;
  /** Index into meeting.turns of the turn loaded or speaking, else null. */
  current: number | null;
  muted: boolean;
  /** Turns that fell back to text this visit, with why. */
  failed: ReadonlyMap<number, string>;
  /** Unheard turns still queued after the current one. */
  remaining: number;
  /** Play / resume (also the "Start listening" gesture). */
  play: () => void;
  pause: () => void;
  skip: () => void;
  replay: (index: number) => void;
  toggleMute: () => void;
}

/** Plays every non-founder turn of a voice meeting in order, once, remembering what was heard per meeting. */
export function useVoiceQueue(meetingId: string, turns: readonly MeetingTurn[], enabled: boolean): VoiceQueue {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [played, setPlayed] = useState<Set<number>>(() => loadPlayed(meetingId));
  const [failed, setFailed] = useState<Map<number, string>>(() => new Map());
  const [current, setCurrent] = useState<number | null>(null);
  const [status, setStatus] = useState<QueueStatus>("idle");
  const [muted, setMuted] = useState(loadMuted);
  const currentRef = useRef(current);
  currentRef.current = current;
  const statusRef = useRef(status);
  statusRef.current = status;

  const audio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const release = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute("src");
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const markPlayed = useCallback(
    (index: number) =>
      setPlayed((prev) => {
        if (prev.has(index)) return prev;
        const next = new Set(prev).add(index);
        savePlayed(meetingId, next);
        return next;
      }),
    [meetingId],
  );

  const fail = useCallback((index: number, why: string) => {
    setFailed((prev) => new Map(prev).set(index, why));
    setCurrent(null);
    setStatus("idle");
  }, []);

  const finish = useCallback(
    (index: number) => {
      release();
      markPlayed(index);
      setCurrent(null);
      setStatus("idle");
    },
    [release, markPlayed],
  );

  const start = useCallback(
    (index: number) => {
      release();
      setFailed((prev) => {
        if (!prev.has(index)) return prev;
        const next = new Map(prev);
        next.delete(index);
        return next;
      });
      const controller = new AbortController();
      abortRef.current = controller;
      setCurrent(index);
      setStatus("loading");
      api
        .turnAudio(meetingId, index, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return;
          const a = audio();
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          a.src = url;
          a.onended = () => finish(index);
          a.onerror = () => {
            release();
            fail(index, audioFailure(0));
          };
          if (statusRef.current === "paused") return;
          return a.play().then(
            () => !controller.signal.aborted && setStatus("playing"),
            (err: unknown) => {
              if (controller.signal.aborted) return;
              if (err instanceof DOMException && err.name === "NotAllowedError") setStatus("blocked");
              else {
                release();
                fail(index, audioFailure(0));
              }
            },
          );
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          fail(index, audioFailure(err instanceof ApiRequestError ? err.status : 0));
        });
    },
    [meetingId, audio, release, finish, fail],
  );

  const failedSet = new Set(failed.keys());
  const next = enabled ? nextUnplayed(turns, played, failedSet) : null;

  useEffect(() => {
    if (status === "idle" && next !== null) start(next);
  }, [status, next, start]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted, current]);

  useEffect(() => release, [release]);

  const play = useCallback(() => {
    if (status !== "paused" && status !== "blocked") return;
    if (!audioRef.current?.getAttribute("src")) {
      setStatus("loading");
      return;
    }
    audio()
      .play()
      .then(
        () => setStatus("playing"),
        () => setStatus("blocked"),
      );
  }, [status, audio]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    if (status === "playing" || status === "loading") setStatus("paused");
  }, [status]);

  const skip = useCallback(() => {
    const index = currentRef.current;
    if (index !== null) finish(index);
  }, [finish]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      saveMuted(!m);
      return !m;
    });
  }, []);

  return {
    status,
    current,
    muted,
    failed,
    remaining: enabled ? unplayedCount(turns, played, failedSet) - (current !== null && !played.has(current) && !failedSet.has(current) ? 1 : 0) : 0,
    play,
    pause,
    skip,
    replay: start,
    toggleMute,
  };
}
