import { useId, useMemo, useRef, useState } from "react";
import type { RosterEntry } from "@shared/api";
import { ACTIONS_MAX, PRIORITIES_MAX } from "@shared/leadership";
import type { BoardMeeting } from "@shared/meetings";
import { useBoard } from "../api/hooks";
import { useAssignActions, useUpdateActions } from "../api/leadershipHooks";
import type { AssignActionsResult } from "../api/client";
import { ActionRow, ActionSummary } from "./ActionRow";
import { ErrorNote } from "./common";
import {
  draftsFrom,
  findTask,
  hasErrors,
  mandatesQuestion,
  newDraft,
  pendingRows,
  PRIORITIES,
  priorityCounts,
  sortByPriority,
  toUpdateRequest,
  validateReview,
  type DraftAction,
  type ReviewErrors,
} from "./leadershipModel";

const NO_ERRORS: ReviewErrors = { rows: {} };

/** Per-action failures from an assign: the server's reasons, else "not assigned" for ids that stayed proposed. */
export function assignFailures(requested: readonly string[], res: AssignActionsResult): Record<string, string> {
  const actions = res.meeting.outcome?.actions ?? [];
  const out: Record<string, string> = {};
  for (const id of requested) {
    const result = res.results?.find((r) => r.id === id);
    const action = actions.find((a) => a.id === id);
    if (result && !result.ok) out[id] = result.error ?? "The mandate wasn't created.";
    else if (!result && action?.status !== "assigned") out[id] = "The mandate wasn't created.";
  }
  return out;
}

/** The review screen: the week's priorities and the drafted actions, edited, saved and assigned as mandates. */
export function ActionReview({ meeting, agents }: { meeting: BoardMeeting; agents: readonly RosterEntry[] }) {
  const save = useUpdateActions(meeting.id);
  const assign = useAssignActions(meeting.id);
  const board = useBoard();
  const [priorities, setPriorities] = useState(meeting.outcome?.priorities ?? "");
  const [rows, setRows] = useState<DraftAction[]>(() => draftsFrom(meeting.outcome?.actions));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toUpdateRequest(meeting.outcome?.priorities ?? "", draftsFrom(meeting.outcome?.actions))));
  const [errors, setErrors] = useState<ReviewErrors>(NO_ERRORS);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Set from the click until the request settles, so a second click can never send a second assign. */
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const prioritiesId = useId();

  const dirty = JSON.stringify(toUpdateRequest(priorities, rows)) !== baseline;
  const pending = pendingRows(rows);
  const counts = priorityCounts(rows);
  const live = useMemo(() => (Object.keys(errors.rows).length || errors.priorities || errors.list ? validateReview(priorities, rows) : NO_ERRORS), [errors, priorities, rows]);

  const adopt = (m: BoardMeeting) => {
    const next = draftsFrom(m.outcome?.actions);
    const p = m.outcome?.priorities ?? priorities;
    setRows(next);
    setPriorities(p);
    setBaseline(JSON.stringify(toUpdateRequest(p, next)));
  };

  const update = (key: string, patch: Partial<DraftAction>) => {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const check = (): boolean => {
    const found = validateReview(priorities, rows);
    setErrors(found);
    return !hasErrors(found);
  };

  /** Saves edits when there are any; resolves to the meeting as the server has it. */
  const persist = async (): Promise<BoardMeeting> => {
    if (!dirty) return meeting;
    const res = await save.mutateAsync(toUpdateRequest(priorities, rows));
    adopt(res.meeting);
    return res.meeting;
  };

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      // The mutation's error is shown below the buttons.
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onSave = () => {
    if (!check()) return;
    void run(async () => {
      await persist();
      setSaved(true);
    });
  };

  const doAssign = (ids?: string[]) =>
    run(async () => {
      setConfirming(false);
      const current = await persist();
      const target = ids ?? (current.outcome?.actions ?? []).filter((a) => a.status === "proposed").map((a) => a.id);
      if (!target.length) return;
      let found: Record<string, string>;
      try {
        const res = await assign.mutateAsync({ ids: target });
        adopt(res.meeting);
        found = assignFailures(target, res);
      } catch (err) {
        // The server answers an error only when no action could be assigned: every target failed for that reason.
        const why = err instanceof Error ? err.message : String(err);
        found = Object.fromEntries(target.map((id) => [id, why]));
      }
      setFailures((f) => {
        const next = { ...f };
        for (const id of target) delete next[id];
        return { ...next, ...found };
      });
    });

  const onAssign = () => {
    if (!check() || pending.length === 0) return;
    setConfirming(true);
  };

  const remove = (key: string) => {
    setSaved(false);
    setRows((rs) => rs.filter((r) => r.key !== key));
  };

  const add = () => {
    setSaved(false);
    setRows((rs) => [...rs, newDraft()]);
  };

  return (
    <section className="zui-review" aria-label="Review tasks">
      <div className="zui-review__intro">
        <h3 className="zui-subheading">This week's priorities</h3>
        <p className="zui-hint">Drafted by Susu, your CEO agent, from the meeting. Edit anything, then assign: each action becomes a mandate for its division.</p>
      </div>
      <label className="zui-sr-only" htmlFor={prioritiesId}>
        This week's priorities
      </label>
      <textarea
        id={prioritiesId}
        className="zui-input zui-review__priorities"
        rows={4}
        dir="auto"
        value={priorities}
        disabled={busy}
        onChange={(e) => {
          setSaved(false);
          setPriorities(e.target.value);
        }}
        aria-invalid={live.priorities ? true : undefined}
      />
      {(live.priorities ?? errors.priorities) && <p className="zui-error">{live.priorities ?? errors.priorities}</p>}
      {priorities.length > PRIORITIES_MAX * 0.9 && (
        <p className="zui-hint">
          {priorities.length}/{PRIORITIES_MAX}
        </p>
      )}

      <div className="zui-review__bar">
        <h3 className="zui-subheading">Actions</h3>
        <span className="zui-review__counts" aria-label={PRIORITIES.map((p) => `${counts[p]} ${p}`).join(", ")}>
          {PRIORITIES.map((p) => (
            <span key={p} className={`zui-prio zui-prio--${p}`}>
              {p} · {counts[p]}
            </span>
          ))}
        </span>
        <button type="button" className="zui-link" disabled={busy || rows.length < 2} onClick={() => setRows((rs) => sortByPriority(rs))}>
          Sort by priority
        </button>
      </div>
      {rows.length === 0 && <p className="zui-hint">No actions. Add the first one.</p>}
      <ol className="zui-actions" aria-label="Actions">
        {rows.map((r, i) =>
          r.status === "assigned" ? (
            <ActionSummary key={r.key} row={r} agents={agents} task={findTask(board.data, r.taskId)} />
          ) : (
            <ActionRow
              key={r.key}
              row={r}
              index={i}
              agents={agents}
              errors={live.rows[r.key]}
              failure={r.id ? failures[r.id] : undefined}
              disabled={busy}
              onChange={(patch) => update(r.key, patch)}
              onRemove={() => remove(r.key)}
              onRetry={() => r.id && void doAssign([r.id])}
            />
          ),
        )}
      </ol>
      <button type="button" className="zui-btn zui-review__add" disabled={busy || rows.length >= ACTIONS_MAX} onClick={add} title={rows.length >= ACTIONS_MAX ? `At most ${ACTIONS_MAX} actions` : undefined}>
        + Add action
      </button>
      {live.list && <p className="zui-error">{live.list}</p>}

      <div className="zui-review__footer">
        {confirming ? (
          <div className="zui-confirm" role="group" aria-label="Confirm assign">
            <span>{mandatesQuestion(pending.length)}</span>
            <button type="button" className="zui-btn zui-btn--primary" disabled={busy} onClick={() => void doAssign()}>
              Create mandates
            </button>
            <button type="button" className="zui-btn" disabled={busy} onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        ) : (
          <div className="zui-row">
            <button type="button" className="zui-btn zui-btn--primary" disabled={busy || pending.length === 0} onClick={onAssign}>
              {assign.isPending ? "Assigning…" : "Assign & start"}
            </button>
            <button type="button" className="zui-btn" disabled={busy || !dirty} onClick={onSave}>
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        )}
        <p className="zui-status" role="status" aria-live="polite">
          {busy ? (assign.isPending ? "Creating mandates…" : "Saving…") : saved && !dirty ? "Saved." : dirty ? "Unsaved changes." : ""}
        </p>
        <ErrorNote error={save.error ?? assign.error} />
      </div>
    </section>
  );
}
