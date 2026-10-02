import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Connection, ConnectionKind, ConnectionStatus } from "@shared/api";
import { useConnections } from "../api/hooks";
import { checkedAgo, CONNECTION_GROUPS, describeCounts, groupConnections, STATUS_META, worstStatus, type ConnectionGroup } from "./connections";

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

/** Phones: one mark for the worst status; it opens every connection as a bottom sheet. */
export function ConnectionsSummary() {
  const { data, error, isPending } = useConnections();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [refs] = useState(() => [ref, popRef]);
  const titleId = useId();
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useDismiss(open, close, refs);

  if (error) return null;
  const all = data?.connections ?? [];
  const groups = groupConnections(all);
  const status = worstStatus(all);
  const counts = groups.reduce(
    (acc, g) => ({ ok: acc.ok + g.counts.ok, warn: acc.warn + g.counts.warn, error: acc.error + g.counts.error, off: acc.off + g.counts.off }),
    { ok: 0, warn: 0, error: 0, off: 0 },
  );
  return (
    <div className="zui-conns zui-conns--compact" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="zui-conn-pill"
        aria-label={isPending ? "Connections: checking" : `Connections: ${STATUS_META[status].label}, ${describeCounts(counts)}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
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

function useScrollFades(ref: RefObject<HTMLElement>, deps: unknown): string {
  const [fades, setFades] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setFades(`${left ? " zui-conn-row__scroll--fade-left" : ""}${right ? " zui-conn-row__scroll--fade-right" : ""}`);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ref, deps]);
  return fades;
}

const POPOVER_WIDTH = 320;

/** Every connection as its own pill, channels → MCP → CLI, in a slim scrolling row under the HUD bar. */
export function ConnectionsRow() {
  const { data, error } = useConnections();
  const [openId, setOpenId] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [refs] = useState(() => [wrapRef]);
  const close = useCallback(() => {
    setOpenId(null);
    triggerRef.current?.focus();
  }, []);
  useDismiss(openId !== null, close, refs);
  const fades = useScrollFades(scrollRef, data);
  useEffect(() => {
    if (openId) popRef.current?.focus();
  }, [openId]);

  const connections = data?.connections ?? [];
  if (error || connections.length === 0) return null;
  const kinds = CONNECTION_GROUPS.map((g) => connections.filter((c) => c.kind === g.kind)).filter((list) => list.length > 0);
  const open = connections.find((c) => c.id === openId);

  const toggle = (c: Connection, el: HTMLButtonElement) => {
    if (openId === c.id) return close();
    triggerRef.current = el;
    const wrap = wrapRef.current!.getBoundingClientRect();
    const pill = el.getBoundingClientRect();
    setLeft(Math.max(0, Math.min(pill.left - wrap.left, wrap.width - POPOVER_WIDTH)));
    setOpenId(c.id);
  };

  return (
    <div className="zui-conn-row" ref={wrapRef}>
      <div ref={scrollRef} className={`zui-conn-row__scroll${fades}`} role="group" aria-label="Connections">
        {kinds.map((list, i) => (
          <Fragment key={list[0]!.kind}>
            {i > 0 && <span className="zui-conn-row__divider" aria-hidden="true" />}
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`zui-conn-pill zui-conn-pill--${c.status}`}
                aria-label={`${c.name}: ${STATUS_META[c.status].label}`}
                title={c.detail}
                aria-expanded={openId === c.id}
                aria-haspopup="dialog"
                onClick={(e) => toggle(c, e.currentTarget)}
              >
                <StatusMark status={c.status} />
                <span className="zui-conn-pill__label">{c.name}</span>
              </button>
            ))}
          </Fragment>
        ))}
      </div>
      {open && (
        <div ref={popRef} className="zui-conn-pop zui-conn-pop--one" role="dialog" aria-label={`${open.name} connection`} tabIndex={-1} style={{ left }}>
          <ul className="zui-conn-list">
            <ConnectionRow c={open} now={Date.now() / 1000} />
          </ul>
        </div>
      )}
    </div>
  );
}
