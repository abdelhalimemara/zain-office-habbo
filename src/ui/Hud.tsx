import type { HealthResponse } from "@shared/api";
import { getDivision } from "@shared/divisions";
import { pendingApprovals } from "@shared/flow";
import { useBoard, useHealth } from "../api/hooks";
import { useUiStore } from "../state/store";

type DotState = "ok" | "warn" | "bad" | "unknown";

const HERMES_DOT: Record<HealthResponse["hermes"], DotState> = { reachable: "ok", unauthorized: "warn", unreachable: "bad" };
const TELEGRAM_DOT: Record<HealthResponse["telegram"], DotState> = { connected: "ok", disconnected: "bad", unknown: "unknown" };

function StatusDot({ label, state, detail }: { label: string; state: DotState; detail: string }) {
  return (
    <span className="zui-dot-item" title={`${label}: ${detail}`}>
      <span className={`zui-dot zui-dot--${state}`} aria-hidden="true" />
      <span>{label}</span>
      <span className="zui-sr-only">: {detail}</span>
    </span>
  );
}

export function Hud() {
  const view = useUiStore((s) => s.view);
  const goToCity = useUiStore((s) => s.goToCity);
  const openPanel = useUiStore((s) => s.openPanel);
  const board = useBoard();
  const health = useHealth();
  const approvals = board.data ? pendingApprovals(board.data).length : 0;
  const division = view.kind === "floor" ? view.division : undefined;
  const d = division ? getDivision(division) : undefined;
  const hermes = health.data?.hermes;
  const telegram = health.data?.telegram;

  return (
    <header className="zui-hud">
      <div className="zui-hud__left">
        <span className="zui-wordmark">ZAIN GROUP</span>
        <nav aria-label="Breadcrumb" className="zui-breadcrumb">
          {d ? (
            <>
              <button type="button" className="zui-link" onClick={goToCity}>
                ‹ City
              </button>
              <span aria-hidden="true">›</span>
              <span aria-current="page" style={{ color: d.color }}>
                {d.name}
              </span>
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
      <div className="zui-hud__actions">
        {division && (
          <button type="button" className="zui-btn" onClick={() => openPanel({ kind: "kanban", division })}>
            Kanban
          </button>
        )}
        <button type="button" className="zui-btn" onClick={() => openPanel({ kind: "approvals" })} aria-label={`Approvals, ${approvals} pending`}>
          Approvals
          {approvals > 0 && <span className="zui-count zui-count--alert" aria-hidden="true">{approvals}</span>}
        </button>
        <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "mandate", division })}>
          New mandate
        </button>
        <button type="button" className="zui-btn" onClick={() => openPanel({ kind: "hire", division })}>
          Hire
        </button>
      </div>
    </header>
  );
}
