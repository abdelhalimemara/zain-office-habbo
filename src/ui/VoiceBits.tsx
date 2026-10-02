import { VOICE_STATUS_LABEL, type VoiceStatus } from "./voiceModel";

const ICON = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function SpeakerIcon({ off = false }: { off?: boolean }) {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      {off ? <path d="m23 9-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg {...ICON} width={22} height={22} aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}

/** Animated bars for whoever is speaking now; still under reduced motion. */
export function Equalizer() {
  return (
    <span className="zui-eq" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function VoiceTag({ status }: { status: VoiceStatus }) {
  return <span className={`zui-voice-tag zui-voice-tag--${status}`}>{VOICE_STATUS_LABEL[status]}</span>;
}

/** A voice meeting in a list: a small speaker chip. */
export function VoiceModeBadge() {
  return (
    <span className="zui-voice-badge" title="Voice meeting">
      <SpeakerIcon />
      <span>Voice</span>
    </span>
  );
}

export function VoicesOffNotice({ detail = "Voice meetings can still start; they just won't play until it is." }: { detail?: string }) {
  return (
    <p className="zui-voice-off" role="status">
      <strong>ElevenLabs isn't connected.</strong> Add <code>ELEVENLABS_API_KEY</code> to the Hermes <code>.env</code>. {detail}
    </p>
  );
}
