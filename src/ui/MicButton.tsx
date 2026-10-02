import { useEffect, useRef, useState } from "react";
import { TRANSCRIBE_MAX_BYTES } from "@shared/voice";
import { useTranscribe } from "../api/voiceHooks";
import { MicIcon } from "./VoiceBits";
import { formatDuration, pickRecordingType, uploadType } from "./voiceModel";

/** Long remarks are cut here so an upload stays well under the transcription limit. */
export const MAX_RECORDING_SECONDS = 180;

type MicState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; startedAt: number }
  | { kind: "transcribing" }
  | { kind: "denied" }
  | { kind: "error"; message: string };

function supported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function micError(err: unknown): MicState {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "denied" };
  if (name === "NotFoundError") return { kind: "error", message: "No microphone found." };
  return { kind: "error", message: "The microphone couldn't start." };
}

/** Toggle mic for the founder's remarks: records, transcribes, and hands the text back to edit before sending. */
/** `onRecord` fires as recording starts, e.g. to pause the board's voices so the mic doesn't hear them. */
export function MicButton({ onText, onRecord, disabled }: { onText: (text: string) => void; onRecord?: () => void; disabled?: boolean }) {
  const transcribe = useTranscribe();
  const [state, setState] = useState<MicState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);

  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(
    () => () => {
      if (recorder.current) recorder.current.onstop = null;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stopTracks();
    },
    [],
  );

  const recording = state.kind === "recording";
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const elapsed = state.kind === "recording" ? (now - state.startedAt) / 1000 : 0;
  useEffect(() => {
    if (recording && elapsed >= MAX_RECORDING_SECONDS) recorder.current?.stop();
  }, [recording, elapsed]);

  const upload = (blob: Blob) => {
    if (blob.size === 0) return setState({ kind: "error", message: "Nothing was recorded." });
    if (blob.size > TRANSCRIBE_MAX_BYTES) return setState({ kind: "error", message: "That recording is too long. Try a shorter remark." });
    setState({ kind: "transcribing" });
    transcribe.mutate(
      { audio: blob, contentType: uploadType(blob.type) },
      {
        onSuccess: ({ text }) => {
          const said = text.trim();
          if (said) onText(said);
          setState(said ? { kind: "idle" } : { kind: "error", message: "No words were heard. Try again closer to the mic." });
        },
        onError: (err) => setState({ kind: "error", message: `Couldn't transcribe: ${err instanceof Error ? err.message : String(err)}` }),
      },
    );
  };

  const start = async () => {
    setState({ kind: "requesting" });
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return setState(micError(err));
    }
    const mimeType = pickRecordingType((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    } catch {
      stopTracks();
      return setState({ kind: "error", message: "This browser can't record audio." });
    }
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      stopTracks();
      upload(new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" }));
    };
    recorder.current = rec;
    onRecord?.();
    rec.start();
    const t = Date.now();
    setNow(t);
    setState({ kind: "recording", startedAt: t });
  };

  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();

  if (!supported()) {
    return (
      <div className="zui-mic">
        <button type="button" className="zui-btn zui-mic__btn" disabled title="Voice input isn't supported in this browser">
          <MicIcon /> Speak
        </button>
      </div>
    );
  }

  const busy = state.kind === "requesting" || state.kind === "transcribing";
  return (
    <div className="zui-mic">
      <button
        type="button"
        className={`zui-btn zui-mic__btn${recording ? " zui-mic__btn--on" : ""}`}
        aria-pressed={recording}
        disabled={disabled || busy}
        onClick={recording ? stop : () => void start()}
      >
        <MicIcon />
        {recording ? "Stop" : "Speak"}
      </button>
      <span className="zui-mic__status" role="status" aria-live="polite">
        {state.kind === "requesting" && "Waiting for the microphone…"}
        {state.kind === "recording" && (
          <>
            <span className="zui-mic__rec" aria-hidden="true" /> Recording {formatDuration(elapsed)}
          </>
        )}
        {state.kind === "transcribing" && "Transcribing…"}
      </span>
      {state.kind === "denied" && (
        <p className="zui-error" role="alert">
          Microphone access is blocked. Allow it in your browser's site settings, or type your remarks.
        </p>
      )}
      {state.kind === "error" && (
        <p className="zui-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
