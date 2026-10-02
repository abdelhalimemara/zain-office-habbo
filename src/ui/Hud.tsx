import { useEffect, useRef, useState } from "react";
import type { HealthResponse } from "@shared/api";
import { getDivision } from "@shared/divisions";
import { pendingApprovals } from "@shared/flow";
import { useBoard, useHealth } from "../api/hooks";
import { useUiStore } from "../state/store";
import { useRosterAgents } from "./common";
import { PHONE_QUERY } from "./KanbanPanel";
import { useMediaQuery } from "./useMediaQuery";
import { usePublishHudBottom } from "./useHudBottom";

type DotState = "ok" | "warn" | "bad" | "unknown";

const HERMES_DOT: Record<HealthResponse["hermes"], DotState> = { reachable: "ok", unauthorized: "warn", unreachable: "bad" };
const TELEGRAM_DOT: Record<HealthResponse["telegram"], DotState> = { connected: "ok", disconnected: "bad", unknown: "unknown" };

function StatusDot({ label, state, detail }: { label: string; state: DotState; detail: string }) {
  return (
    <span className="zui-dot-item" title={`${label}: ${detail}`}>
      <span className={`zui-dot zui-dot--${state}`} aria-hidden="true" />
      <span className="zui-dot-item__label">{label}</span>
      <span className="zui-sr-only">: {detail}</span>
    </span>
  );
}

function MoreMenu({ onBoard }: { onBoard: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div className="zui-hud__more" ref={ref}>
      <button type="button" className="zui-btn zui-btn--icon" aria-label="More" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="zui-menu">
          <button
            type="button"
            className="zui-menu__item"
            onClick={() => {
              setOpen(false);
              onBoard();
            }}
          >
            Board
          </button>
        </div>
      )}
    </div>
  );
}

export function Hud() {
  const view = useUiStore((s) => s.view);
  const goToCity = useUiStore((s) => s.goToCity);
  const openPanel = useUiStore((s) => s.openPanel);
  const board = useBoard();
  const health = useHealth();
  const { agents } = useRosterAgents();
  const approvals = board.data ? pendingApprovals(board.data, agents).length : 0;
  const division = view.kind === "floor" ? view.division : undefined;
  const d = division ? getDivision(division) : undefined;
  const hermes = health.data?.hermes;
  const telegram = health.data?.telegram;
  const phone = useMediaQuery(PHONE_QUERY);
  const ref = useRef<HTMLElement>(null);
  usePublishHudBottom(ref);
  const openBoard = () => openPanel({ kind: "board" });

  return (
    <header className="zui-hud" ref={ref}>
      <div className="zui-hud__left">
        <span className="zui-wordmark">
          <span className="zui-wordmark__mark" aria-hidden="true">
            Z
          </span>
          <span className="zui-wordmark__text">ZAIN GROUP</span>
        </span>
        <nav aria-label="Breadcrumb" className="zui-breadcrumb">
          {d ? (
            <>
              <button type="button" className="zui-link" onClick={goToCity}>
                ‹ City
              </button>
              <span className="zui-breadcrumb__sep" aria-hidden="true">
                /
              </span>
              <span className="zui-dot-mark" style={{ background: d.color }} aria-hidden="true" />
              <span aria-current="page">{d.name}</span>
            </>
          ) : (
            <span aria-current="page">City</span>
          )}
        </nav>
      </div>
      <div className="zui-hud__status">
        <StatusDot label="Hermes" state={hermes ? HERMES_DOT[hermes] : health.isError ? "bad" : "unknown"} detail={hermes ?? (health.isError ? "server offline" : "checking")} />
        <StatusDot label="Telegram" state={telegram ? TELEGRAM_DOT[telegram] : "unknown"} detail={telegram ?? "unknown"} />
      </div>
      {phone && <MoreMenu onBoard={openBoard} />}
      <div className="zui-hud__actions">
        {division && (
          <button type="button" className="zui-btn" onClick={() => openPanel({ kind: "kanban", division })}>
            Kanban
          </button>
        )}
        <button type="button" className="zui-btn" onClick={() => openPanel({ kind: "approvals" })} aria-label={`Approvals, ${approvals} pending`}>
          Approvals
          {approvals > 0 && (
            <span className="zui-count zui-count--alert" aria-hidden="true">
              {approvals}
            </span>
          )}
        </button>
        {!phone && (
          <button type="button" className="zui-btn" onClick={openBoard}>
            Board
          </button>
        )}
        <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "mandate", division })}>
          New mandate
        </button>
        <button type="button" className="zui-btn" onClick={() => openPanel({ kind: "hire", division })}>
          Hire
        </button>
      </div>
      {health.data?.reviewDispatch === "on" && (
        <p className="zui-banner zui-banner--warn" role="alert">
          Hermes review agent is on: it can approve mandates before HQ sees them.
        </p>
      )}
      {health.data?.telegramApprovals === "needs-sethome" && (
        <p className="zui-banner zui-banner--info" role="status">
          Telegram approvals are off: send <code>/sethome</code> to your Hermes bot in Telegram.
        </p>
      )}
    </header>
  );
}
