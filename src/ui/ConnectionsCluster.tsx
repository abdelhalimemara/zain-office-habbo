import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Connection, ConnectionKind, ConnectionStatus } from "@shared/api";
import { useConnections } from "../api/hooks";
import { checkedAgo, describeCounts, groupConnections, STATUS_META, worstStatus, type ConnectionGroup } from "./connections";

export function StatusMark({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`zui-conn-mark zui-conn-mark--${status}`} aria-hidden="true">
      {STATUS_META[status].icon}
    </span>
  );
}

function ConnectionRow({ c, now }: { c: Connection; now: number }) {
  return (
    <li className={`zui-conn zui-conn--${c.status}`}>
      <StatusMark status={c.status} />
      <div className="zui-conn__text">
        <div className="zui-conn__head">
          <span className="zui-conn__name">{c.name}</span>
          {c.profile && <span className="zui-tag">{c.profile}</span>}
          <span className="zui-sr-only">: {STATUS_META[c.status].label}</span>
        </div>
        <p className="zui-conn__detail">{c.detail}</p>
        <p className="zui-conn__checked">{checkedAgo(c.checkedAt, now)}</p>
      </div>
    </li>
  );
}

function GroupList({ group, now }: { group: ConnectionGroup; now: number }) {
  if (group.connections.length === 0) return <p className="zui-hint">No {group.label} connections configured.</p>;
  return (
    <ul className="zui-conn-list" aria-label={`${group.label} connections`}>
      {group.connections.map((c) => (
        <ConnectionRow key={c.id} c={c} now={now} />
      ))}
    </ul>
  );
}

function useDismiss(open: boolean, close: () => void, refs: RefObject<HTMLElement>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, refs]);
}

interface PopoverProps {
  groups: ConnectionGroup[];
  active: ConnectionKind | "all";
  onSelect: (kind: ConnectionKind) => void;
  sheet: boolean;
  titleId: string;
  popRef: RefObject<HTMLDivElement>;
}

function ConnectionsPopover({ groups, active, onSelect, sheet, titleId, popRef: ref }: PopoverProps) {
  const now = Date.now() / 1000;
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const shown = active === "all" ? groups : groups.filter((g) => g.kind === active);
  return (
    <div ref={ref} className={`zui-conn-pop${sheet ? " zui-conn-pop--sheet" : ""}`} role="dialog" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId} className="zui-conn-pop__title">
        Connections
      </h2>
      {!sheet && (
        <div role="tablist" aria-label="Connection type" className="zui-segmented zui-segmented--3">
          {groups.map((g) => (
            <button
              key={g.kind}
              type="button"
              role="tab"
              aria-selected={g.kind === active}
              className="zui-segmented__tab"
              onClick={() => onSelect(g.kind)}
            >
              <StatusMark status={g.status} /> {g.label} ({g.connections.length})
            </button>
          ))}
        </div>
      )}
      {shown.map((g) => (
        <section key={g.kind} className="zui-conn-group" aria-label={g.label}>
          {sheet && (
            <h3 className="zui-subheading">
              {g.label} · {describeCounts(g.counts)}
            </h3>
          )}
          <GroupList group={g} now={now} />
        </section>
      ))}
    </div>
  );
}

/** The HUD's backdrop blur traps fixed positioning, so the phone sheet renders at the overlay root. */
function SheetPortal({ anchor, children }: { anchor: RefObject<HTMLElement>; children: ReactNode }) {
  const root = anchor.current?.closest<HTMLElement>(".zui-root");
  return root ? createPortal(children, root) : <>{children}</>;
}

/** Channel / MCP / CLI health at a glance; each pill opens the full list for its group. */
export function ConnectionsCluster({ compact }: { compact: boolean }) {
  const { data, error, isPending } = useConnections();
  const [open, setOpen] = useState<ConnectionKind | "all" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [refs] = useState(() => [ref, popRef]);
  const titleId = useId();
  const close = useCallback(() => {
    setOpen(null);
    triggerRef.current?.focus();
  }, []);
  useDismiss(open !== null, close, refs);

  if (error) return null;
  const groups = groupConnections(data?.connections ?? []);
  const toggle = (kind: ConnectionKind | "all", el: HTMLButtonElement) => {
    triggerRef.current = el;
    setOpen(open === kind ? null : kind);
  };

  if (compact) {
    const all = data?.connections ?? [];
    const status = worstStatus(all);
    const counts = groups.reduce((acc, g) => ({ ok: acc.ok + g.counts.ok, warn: acc.warn + g.counts.warn, error: acc.error + g.counts.error, off: acc.off + g.counts.off }), { ok: 0, warn: 0, error: 0, off: 0 });
    return (
      <div className="zui-conns zui-conns--compact" ref={ref}>
        <button
          type="button"
          className="zui-conn-pill"
          aria-label={isPending ? "Connections: checking" : `Connections: ${STATUS_META[status].label}, ${describeCounts(counts)}`}
          aria-expanded={open !== null}
          aria-haspopup="dialog"
          onClick={(e) => toggle("all", e.currentTarget)}
        >
          <StatusMark status={isPending ? "off" : status} />
        </button>
        {open && (
          <SheetPortal anchor={ref}>
            <div className="zui-conn-scrim" aria-hidden="true" />
            <ConnectionsPopover groups={groups} active="all" onSelect={() => undefined} sheet titleId={titleId} popRef={popRef} />
          </SheetPortal>
        )}
      </div>
    );
  }

  return (
    <div className="zui-conns" role="group" aria-label="Connections" ref={ref}>
      {groups.map((g) => (
        <button
          key={g.kind}
          type="button"
          className={`zui-conn-pill zui-conn-pill--${g.status}`}
          aria-label={isPending ? `${g.label}: checking` : `${g.label}: ${STATUS_META[g.status].label}, ${describeCounts(g.counts)}`}
          title={isPending ? undefined : describeCounts(g.counts)}
          aria-expanded={open === g.kind}
          aria-haspopup="dialog"
          onClick={(e) => toggle(g.kind, e.currentTarget)}
        >
          <span className="zui-conn-pill__label">{g.label}</span>
          <StatusMark status={isPending ? "off" : g.status} />
          <span className="zui-conn-pill__count">{isPending ? "…" : g.connections.length}</span>
        </button>
      ))}
      {open && <ConnectionsPopover groups={groups} active={open} onSelect={(k) => setOpen(k)} sheet={false} titleId={titleId} popRef={popRef} />}
    </div>
  );
}
