import { useState } from "react";
import type { MeetingMode } from "@shared/meetings";
import { useVoices } from "../api/voiceHooks";
import { useUiStore } from "../state/store";
import { useRosterAgents } from "./common";
import { ConveneForm } from "./ConveneForm";
import { Dialog } from "./Panel";
import { ChatIcon, MicIcon } from "./VoiceBits";

const BOARD_COLOR = "#C9A227";

const CHOICES: readonly { mode: MeetingMode; title: string; text: string }[] = [
  { mode: "chat", title: "Chat meeting", text: "The board discusses in a written transcript you read and reply to." },
  { mode: "voice", title: "Voice meeting", text: "Each member speaks in their own voice, and you can talk back." },
];

function ModeChoice({ chosen, onChoose }: { chosen: MeetingMode | null; onChoose: (mode: MeetingMode) => void }) {
  const voices = useVoices();
  return (
    <div className="zui-mode-choice" role="group" aria-label="Meeting type">
      {CHOICES.map((c) => (
        <button
          key={c.mode}
          type="button"
          className={`zui-mode-card zui-mode-card--${c.mode}`}
          autoFocus={c.mode === (chosen ?? "chat")}
          onClick={() => onChoose(c.mode)}
        >
          <span className="zui-mode-card__icon">{c.mode === "voice" ? <MicIcon /> : <ChatIcon />}</span>
          <span className="zui-mode-card__title">{c.title}</span>
          <span className="zui-mode-card__text">{c.text}</span>
          {c.mode === "voice" && voices.data && !voices.data.configured && <span className="zui-mode-card__note">ElevenLabs not connected</span>}
        </button>
      ))}
    </div>
  );
}

/** "Call a meeting": pick chat or voice, then the topic, brief and members. Opens the room on success. */
export function CallMeetingDialog() {
  const close = useUiStore((s) => s.setCallMeetingOpen);
  const openPanel = useUiStore((s) => s.openPanel);
  const { agents } = useRosterAgents();
  const advisors = agents.filter((a) => a.rank === "board");
  const [mode, setMode] = useState<MeetingMode | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const onClose = () => close(false);
  const choose = (m: MeetingMode) => {
    setMode(m);
    setStep(2);
  };

  return (
    <Dialog title="Call a board meeting" accent={BOARD_COLOR} onClose={onClose} initialFocus=".zui-mode-card">
      <p className="zui-step-label">
        Step {step} of 2 · {step === 1 ? "How should the board meet?" : mode === "voice" ? "Voice meeting" : "Chat meeting"}
      </p>
      {step === 1 || !mode ? (
        <ModeChoice chosen={mode} onChoose={choose} />
      ) : advisors.some((a) => a.hired) ? (
        <ConveneForm
          advisors={advisors}
          mode={mode}
          cancelLabel="Back"
          onCancel={() => setStep(1)}
          onStarted={(meeting) => {
            onClose();
            openPanel({ kind: "meeting", id: meeting.id });
          }}
        />
      ) : (
        <>
          <p className="zui-hint">No board member is hired yet. Hire one to call a meeting.</p>
          <button type="button" className="zui-btn" onClick={() => setStep(1)}>
            Back
          </button>
        </>
      )}
    </Dialog>
  );
}
