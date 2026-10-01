import { useId, useState } from "react";
import { useHeadcountCatalog } from "../api/hooks";
import { ErrorNote } from "./common";
import { MAX_SKILLS } from "./hireForm";

interface Props {
  value: readonly string[];
  onChange: (skills: string[]) => void;
  error?: string;
}

export function SkillPicker({ value, onChange, error }: Props) {
  const catalog = useHeadcountCatalog();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const errorId = useId();
  const full = value.length >= MAX_SKILLS;
  const q = query.trim().toLowerCase();

  const toggle = (skill: string) =>
    onChange(value.includes(skill) ? value.filter((s) => s !== skill) : full ? [...value] : [...value, skill]);

  const departments = (catalog.data?.departments ?? [])
    .map((d) => ({ id: d.id, skills: d.skills.map((s) => (s.includes(":") ? s : `${d.id}:${s}`)).filter((s) => !q || s.includes(q)) }))
    .filter((d) => d.skills.length > 0);

  return (
    <fieldset className="zui-fieldset" aria-describedby={error ? errorId : undefined}>
      <legend className="zui-label">
        Skills{" "}
        <span className="zui-hint" aria-live="polite">
          ({value.length}/{MAX_SKILLS})
        </span>
      </legend>
      {value.length > 0 && (
        <ul className="zui-chips" aria-label="Selected skills">
          {value.map((s) => (
            <li key={s}>
              <button type="button" className="zui-chip zui-chip--removable" onClick={() => toggle(s)} aria-label={`Remove ${s}`}>
                {s} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={errorId} className="zui-error">
          {error}
        </p>
      )}
      <label htmlFor={searchId} className="zui-label">
        Search headcount catalog
      </label>
      <input id={searchId} type="search" className="zui-input" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ErrorNote error={catalog.error} />
      {catalog.isPending && <p className="zui-hint">Loading catalog…</p>}
      <div className="zui-skill-list">
        {departments.map((d) => (
          <div key={d.id} role="group" aria-label={d.id} className="zui-skill-group">
            <h4 className="zui-skill-group__title">{d.id}</h4>
            {d.skills.map((s) => {
              const checked = value.includes(s);
              return (
                <label key={s} className="zui-check">
                  <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(s)} />
                  {s.slice(s.indexOf(":") + 1)}
                </label>
              );
            })}
          </div>
        ))}
        {catalog.data && departments.length === 0 && <p className="zui-hint">No skills match “{query}”.</p>}
      </div>
    </fieldset>
  );
}
