import { useState } from "react";
import type { RosterEntry } from "@shared/api";
import { findBoardMember } from "@shared/board";
import type { MemberMemory, MemoryNote } from "@shared/boardMemory";
import { useBoardMemory, useDeleteMemoryNote } from "../api/memoryHooks";
import { useUiStore } from "../state/store";
import { ErrorNote } from "./common";
import { absoluteTime, relativeTime } from "./mandates";
import { Portrait } from "./Portrait";

const BOARD_COLOR = "#C9A227";

function Note({ profile, note, now }: { profile: string; note: MemoryNote; now: number }) {
  const openPanel = useUiStore((s) => s.openPanel);
  const remove = useDeleteMemoryNote();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="zui-memory-note">
      <p className="zui-memory-note__text" dir="auto">
        {note.text}
      </p>
      <div className="zui-memory-note__meta">
        <time dateTime={new Date(note.at * 1000).toISOString()} title={absoluteTime(note.at)}>
          {relativeTime(note.at, now)}
        </time>
        {note.meetingId && (
          <button type="button" className="zui-link zui-memory-note__meeting" onClick={() => openPanel({ kind: "meeting", id: note.meetingId! })}>
            {note.meetingTopic ?? "Meeting"}
          </button>
        )}
        {confirming ? (
          <span className="zui-confirm zui-memory-note__confirm" role="group" aria-label="Confirm forget">
            <span>Forget this?</span>
            <button type="button" className="zui-btn zui-btn--danger zui-btn--sm" disabled={remove.isPending} onClick={() => remove.mutate({ profile, id: note.id })}>
              {remove.isPending ? "Forgetting…" : "Forget"}
            </button>
            <button type="button" className="zui-btn zui-btn--sm" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="zui-btn zui-btn--sm zui-memory-note__delete" aria-label={`Forget: ${note.text}`} onClick={() => setConfirming(true)}>
            Forget
          </button>
        )}
      </div>
      <ErrorNote error={remove.error} />
    </li>
  );
}

function Member({ memory, agents, now }: { memory: MemberMemory; agents: readonly RosterEntry[]; now: number }) {
  const agent = agents.find((a) => a.profile === memory.profile);
  const name = findBoardMember(memory.profile)?.name ?? agent?.title ?? memory.profile;
  return (
    <li className="zui-memory-member">
      <div className="zui-memory-member__head">
        <Portrait agent={agent} name={name} color={BOARD_COLOR} size="md" />
        <h4 className="zui-memory-member__name">{name}</h4>
        <span className="zui-count">{memory.notes.length}</span>
      </div>
      {memory.notes.length === 0 ? (
        <p className="zui-hint">Nothing remembered yet.</p>
      ) : (
        <ul className="zui-memory-notes" aria-label={`${name}'s notes`}>
          {memory.notes.map((n) => (
            <Note key={n.id} profile={memory.profile} note={n} now={now} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** What each board member remembers from earlier meetings; the founder can forget any note that is wrong. */
export function MemoryTab({ agents }: { agents: readonly RosterEntry[] }) {
  const { data, error, isPending } = useBoardMemory();
  const now = Date.now() / 1000;
  return (
    <div className="zui-memory">
      <p className="zui-hint">
        Members note what matters when they vote, and bring it to every meeting and consultation after. Forget anything that's wrong or out of date.
      </p>
      <ErrorNote error={error} />
      {isPending && <p className="zui-hint">Loading memory…</p>}
      <ul className="zui-memory-members" aria-label="Board memory">
        {data?.members.map((m) => (
          <Member key={m.profile} memory={m} agents={agents} now={now} />
        ))}
      </ul>
    </div>
  );
}
