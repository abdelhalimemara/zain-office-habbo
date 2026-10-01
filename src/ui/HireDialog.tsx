import { useState, type FormEvent } from "react";
import { DIVISIONS, getDivision, type DivisionId } from "@shared/divisions";
import { hireFieldErrors, type HireFieldErrors } from "@shared/hireRules";
import type { Rank } from "@shared/roster";
import { useHire } from "../api/hooks";
import { useUiStore, type HirePrefill } from "../state/store";
import { divisionManager, ErrorNote, RANK_LABEL, useRosterAgents } from "./common";
import { deriveProfile } from "./hireForm";
import { Dialog } from "./Panel";
import { SkillPicker } from "./SkillPicker";

const RANKS: Rank[] = ["specialist", "lead", "vp"];

interface Props {
  division?: DivisionId;
  prefill?: HirePrefill;
}

export function HireDialog({ division: initialDivision, prefill }: Props) {
  const [division, setDivision] = useState<DivisionId>(initialDivision ?? "studio");
  const [rank, setRank] = useState<Rank>(prefill?.rank && prefill.rank !== "ceo" ? prefill.rank : "specialist");
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [profileOverride, setProfileOverride] = useState<string | null>(prefill?.profile ?? null);
  const [reportsOverride, setReportsOverride] = useState<string | null>(prefill?.reportsTo ?? null);
  const [skills, setSkills] = useState<string[]>(prefill?.skills ? [...prefill.skills] : []);
  const [errors, setErrors] = useState<HireFieldErrors>({});
  const hire = useHire();
  const { agents } = useRosterAgents();
  const closePanel = useUiStore((s) => s.closePanel);
  const d = getDivision(division);
  const profile = profileOverride ?? deriveProfile(division, title);
  const isBoard = rank === "board";
  const reportsTo = isBoard ? null : (reportsOverride ?? divisionManager(division, agents).profile);
  const bosses = agents.filter((a) => a.rank !== "specialist" && a.rank !== "board" && a.profile !== profile);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = hireFieldErrors({ title, profile, skills });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    hire.mutate({ profile, title: title.trim(), division, rank, reportsTo, skills });
  };

  if (hire.data) {
    return (
      <Dialog key="result" title={hire.data.ok ? "Hired" : "Hire incomplete"} accent={d.color} onClose={closePanel}>
        <p role="status" aria-live="polite">
          {hire.data.ok ? `${title.trim()} joined ${d.name} as ${hire.data.profile}.` : `Some steps failed for ${hire.data.profile}.`}
        </p>
        <ol className="zui-steps" aria-label="Hire steps">
          {hire.data.steps.map((s, i) => (
            <li key={i} className={s.ok ? "zui-step zui-step--ok" : "zui-step zui-step--fail"}>
              <span aria-hidden="true">{s.ok ? "✔" : "✘"}</span> {s.step} <span className="zui-mono">{s.target}</span>
              {s.error && <span className="zui-error"> — {s.error}</span>}
            </li>
          ))}
        </ol>
        <button type="button" className="zui-btn zui-btn--primary" onClick={closePanel}>
          Done
        </button>
      </Dialog>
    );
  }

  const field = (name: keyof HireFieldErrors) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `hire-${name}-error` : undefined,
  });
  const fieldError = (name: keyof HireFieldErrors) =>
    errors[name] && (
      <p id={`hire-${name}-error`} className="zui-error">
        {errors[name]}
      </p>
    );

  return (
    <Dialog title="Hire an agent" accent={d.color} onClose={closePanel}>
      <form className="zui-form" onSubmit={submit} noValidate>
        <div className="zui-grid2">
          <div>
            <label className="zui-label" htmlFor="hire-division">
              Division
            </label>
            <select id="hire-division" className="zui-input" value={division} onChange={(e) => setDivision(e.target.value as DivisionId)}>
              {DIVISIONS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="zui-label" htmlFor="hire-rank">
              Rank
            </label>
            <select id="hire-rank" className="zui-input" value={rank} onChange={(e) => setRank(e.target.value as Rank)} disabled={isBoard}>
              {(isBoard ? (["board"] as Rank[]) : RANKS).map((r) => (
                <option key={r} value={r}>
                  {RANK_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="zui-label" htmlFor="hire-title">
          Title
        </label>
        <input id="hire-title" className="zui-input" value={title} onChange={(e) => setTitle(e.target.value)} {...field("title")} />
        {fieldError("title")}
        <label className="zui-label" htmlFor="hire-profile">
          Profile slug
        </label>
        <input
          id="hire-profile"
          className="zui-input zui-mono"
          value={profile}
          onChange={(e) => setProfileOverride(e.target.value)}
          spellCheck={false}
          {...field("profile")}
        />
        {fieldError("profile")}
        {reportsTo === null ? (
          <p className="zui-hint">Board seat: advises the CEO and founder; reports to no one.</p>
        ) : (
          <>
            <label className="zui-label" htmlFor="hire-reports">
              Reports to
            </label>
            <select id="hire-reports" className="zui-input" value={reportsTo} onChange={(e) => setReportsOverride(e.target.value)}>
              {!bosses.some((b) => b.profile === reportsTo) && <option value={reportsTo}>{reportsTo}</option>}
              {bosses.map((b) => (
                <option key={b.profile} value={b.profile}>
                  {b.title} ({b.profile})
                </option>
              ))}
            </select>
          </>
        )}
        <SkillPicker value={skills} onChange={setSkills} error={errors.skills} />
        <ErrorNote error={hire.error} />
        <div className="zui-row">
          <button type="submit" className="zui-btn zui-btn--primary" disabled={hire.isPending}>
            {hire.isPending ? "Hiring…" : "Hire"}
          </button>
          <button type="button" className="zui-btn" onClick={closePanel}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
