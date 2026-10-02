import { useEffect, useId, useState, type FormEvent } from "react";
import { AUDIT_MAX_COST_USD, type StartAuditRequest } from "@shared/audits";
import { useProspectSearch, useStartAudit } from "../api/auditHooks";
import type { ProspectHit } from "../api/client";
import { useUiStore } from "../state/store";
import { checkWebsite, domainOf, formatCost, SOCIALS, websiteRequest, type SocialInputs } from "./auditModel";
import { ErrorNote } from "./common";

export const SEARCH_DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

type Source = "crm" | "website";

function hitSocials(hit: ProspectHit): string {
  return SOCIALS.filter(({ key }) => hit[key]).map(({ label }) => label).join(" · ");
}

function ProspectPicker({ chosen, onChoose }: { chosen: ProspectHit | null; onChoose: (hit: ProspectHit | null) => void }) {
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), SEARCH_DEBOUNCE_MS);
  const search = useProspectSearch(query, !chosen);
  const hits = search.data?.prospects ?? [];
  const inputId = useId();

  if (chosen) {
    return (
      <div className="zui-prospect zui-prospect--chosen">
        <div className="zui-prospect__text">
          <strong>{chosen.name}</strong>
          <span className="zui-hint">
            {chosen.website ? domainOf(chosen.website) : "No website on the CRM record"}
            {hitSocials(chosen) && ` · ${hitSocials(chosen)}`}
          </span>
        </div>
        <button type="button" className="zui-link" onClick={() => onChoose(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="zui-prospect-search">
      <label className="zui-label" htmlFor={inputId}>
        Search the CRM
      </label>
      <input id={inputId} className="zui-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company or lead name" autoComplete="off" />
      <ErrorNote error={search.error} />
      {search.isPending && <p className="zui-hint">Searching…</p>}
      {search.data && hits.length === 0 && <p className="zui-hint">No CRM prospects match{query ? ` "${query}"` : ""}.</p>}
      {hits.length > 0 && (
        <ul className="zui-prospect-list" aria-label="CRM prospects">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <button type="button" className="zui-prospect" onClick={() => onChoose(hit)}>
                <span className="zui-prospect__text">
                  <strong>{hit.name}</strong>
                  <span className="zui-hint">
                    {hit.website ? domainOf(hit.website) : "No website"}
                    {hit.city && ` · ${hit.city}`}
                  </span>
                </span>
                <span className="zui-tag">{hit.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SocialFields({ socials, onChange }: { socials: SocialInputs; onChange: (next: SocialInputs) => void }) {
  const base = useId();
  return (
    <details className="zui-instructions">
      <summary>Socials (optional)</summary>
      <div className="zui-audit-socials">
        {SOCIALS.map(({ key, label, placeholder }) => (
          <div key={key} className="zui-form">
            <label className="zui-label" htmlFor={`${base}-${key}`}>
              {label}
            </label>
            <input
              id={`${base}-${key}`}
              className="zui-input"
              value={socials[key] ?? ""}
              onChange={(e) => onChange({ ...socials, [key]: e.target.value })}
              placeholder={placeholder}
              autoComplete="off"
            />
          </div>
        ))}
      </div>
    </details>
  );
}

/** Start an audit from a CRM prospect or a pasted website (with optional socials), then open it. */
export function NewAuditForm() {
  const openPanel = useUiStore((s) => s.openPanel);
  const start = useStartAudit();
  const [source, setSource] = useState<Source>("crm");
  const [chosen, setChosen] = useState<ProspectHit | null>(null);
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [socials, setSocials] = useState<SocialInputs>({});
  const [error, setError] = useState<string | null>(null);
  const ids = { website: useId(), name: useId(), error: useId() };
  const needsWebsite = source === "website" || (chosen !== null && !chosen.website);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let request: StartAuditRequest;
    if (source === "crm") {
      if (!chosen) return setError("Pick a prospect from the CRM.");
      request = chosen.kind === "lead" ? { leadId: chosen.id } : { companyId: chosen.id };
      if (needsWebsite) {
        const check = checkWebsite(website);
        if (!check.ok) return setError(check.error);
        request.website = check.url;
      }
    } else {
      const built = websiteRequest(website, name, socials);
      if ("error" in built) return setError(built.error);
      request = built.request;
    }
    start.mutate(request, { onSuccess: (data) => openPanel({ kind: "audits", id: data.audit.id }) });
  };

  const tab = (value: Source, label: string) => (
    <button type="button" role="radio" aria-checked={source === value} className="zui-segmented__tab" onClick={() => (setSource(value), setError(null))}>
      {label}
    </button>
  );

  return (
    <form className="zui-form zui-audit-form" onSubmit={submit} noValidate>
      <button type="button" className="zui-link zui-audit-back" onClick={() => openPanel({ kind: "audits" })}>
        ‹ All audits
      </button>
      <div role="radiogroup" aria-label="Start from" className="zui-segmented">
        {tab("crm", "CRM prospect")}
        {tab("website", "Website")}
      </div>
      {source === "crm" && <ProspectPicker chosen={chosen} onChoose={(hit) => (setChosen(hit), setError(null))} />}
      {source === "website" && (
        <>
          <label className="zui-label" htmlFor={ids.name}>
            Prospect name <span className="zui-hint">(optional)</span>
          </label>
          <input id={ids.name} className="zui-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Read from the site when left blank" autoComplete="off" />
        </>
      )}
      {needsWebsite && (
        <>
          <label className="zui-label" htmlFor={ids.website}>
            Website
          </label>
          <input
            id={ids.website}
            className="zui-input"
            type="url"
            inputMode="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="example.com"
            autoComplete="off"
            aria-invalid={error && !checkWebsite(website).ok ? true : undefined}
            aria-describedby={error ? ids.error : undefined}
          />
        </>
      )}
      {error && (
        <p id={ids.error} className="zui-error" role="alert">
          {error}
        </p>
      )}
      {source === "website" && <SocialFields socials={socials} onChange={setSocials} />}
      <ErrorNote error={start.error} />
      <p className="zui-hint">{`Takes a few minutes. Apify spend is capped at ${formatCost(AUDIT_MAX_COST_USD)} per audit.`}</p>
      <div className="zui-row">
        <button type="submit" className="zui-btn zui-btn--primary" disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Start audit"}
        </button>
      </div>
    </form>
  );
}
