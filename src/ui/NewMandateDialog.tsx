import { useState, type FormEvent } from "react";
import { DIVISIONS, getDivision, type DivisionId } from "@shared/divisions";
import { useCreateMandate } from "../api/hooks";
import { useUiStore } from "../state/store";
import { divisionManager, ErrorNote, useRosterAgents } from "./common";
import { Dialog } from "./Panel";

export const TITLE_MAX = 200;
export const BRIEF_MAX = 20000;
const PRIORITIES = [
  { value: 0, label: "Low" },
  { value: 1, label: "Normal" },
  { value: 2, label: "High" },
  { value: 3, label: "Urgent" },
];

export function NewMandateDialog({ division: initial }: { division?: DivisionId }) {
  const [division, setDivision] = useState<DivisionId>(initial ?? "studio");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [priority, setPriority] = useState(1);
  const [titleError, setTitleError] = useState<string | null>(null);
  const create = useCreateMandate();
  const { agents } = useRosterAgents();
  const openPanel = useUiStore((s) => s.openPanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const d = getDivision(division);
  const manager = divisionManager(division, agents);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return setTitleError("Title is required.");
    if (t.length > TITLE_MAX) return setTitleError(`Title must be ${TITLE_MAX} characters or fewer.`);
    setTitleError(null);
    create.mutate({ division, title: t, body: brief.trim() || undefined, priority });
  };

  if (create.data) {
    const task = create.data.task;
    return (
      <Dialog key="sent" title="Mandate sent" accent={d.color} onClose={closePanel}>
        <p role="status" aria-live="polite">
          “{task.title}” is with {manager.title} in {d.name}.
        </p>
        <p className="zui-hint">
          {create.data.telegramSubscribed
            ? "You'll get Telegram updates as it moves."
            : "Telegram updates are off — no home channel is configured. The mandate was still created."}
        </p>
        <div className="zui-row">
          <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "task", id: task.id })}>
            Open task
          </button>
          <button type="button" className="zui-btn" onClick={closePanel}>
            Close
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="New mandate" accent={d.color} onClose={closePanel}>
      <form className="zui-form" onSubmit={submit} noValidate>
        <label className="zui-label" htmlFor="mandate-division">
          Division
        </label>
        <select id="mandate-division" className="zui-input" value={division} onChange={(e) => setDivision(e.target.value as DivisionId)}>
          {DIVISIONS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <p className="zui-hint">Assigned to {manager.title} ({manager.profile})</p>
        <label className="zui-label" htmlFor="mandate-title">
          Title
        </label>
        <input
          id="mandate-title"
          className="zui-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? "mandate-title-error" : undefined}
        />
        {titleError && (
          <p id="mandate-title-error" className="zui-error">
            {titleError}
          </p>
        )}
        <label className="zui-label" htmlFor="mandate-brief">
          Brief <span className="zui-hint">({brief.length}/{BRIEF_MAX})</span>
        </label>
        <textarea id="mandate-brief" className="zui-input" rows={6} maxLength={BRIEF_MAX} value={brief} onChange={(e) => setBrief(e.target.value)} />
        <label className="zui-label" htmlFor="mandate-priority">
          Priority
        </label>
        <select id="mandate-priority" className="zui-input" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <ErrorNote error={create.error} />
        <div className="zui-row">
          <button type="submit" className="zui-btn zui-btn--primary" disabled={create.isPending}>
            {create.isPending ? "Sending…" : "Send mandate"}
          </button>
          <button type="button" className="zui-btn" onClick={closePanel}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
