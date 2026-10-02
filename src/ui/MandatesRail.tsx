import { useId, useState } from "react";
import { useBoard } from "../api/hooks";
import { useUiStore } from "../state/store";
import { ErrorNote, useRosterAgents } from "./common";
import { PHONE_QUERY } from "./KanbanPanel";
import { MandateCard } from "./MandateCard";
import { groupMandates } from "./mandates";
import { useMediaQuery } from "./useMediaQuery";

export const FINISHED_PAGE = 30;

type Tab = "ongoing" | "finished";

function RailBody() {
  const board = useBoard();
  const { agents } = useRosterAgents();
  const [tab, setTab] = useState<Tab>("ongoing");
  const [finishedShown, setFinishedShown] = useState(FINISHED_PAGE);
  const base = useId();
  const { ongoing, finished } = board.data ? groupMandates(board.data, agents) : { ongoing: [], finished: [] };
  const now = board.data?.now ?? Date.now() / 1000;
  const list = tab === "ongoing" ? ongoing : finished.slice(0, finishedShown);
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "ongoing", label: "Ongoing", count: ongoing.length },
    { id: "finished", label: "Finished", count: finished.length },
  ];

  return (
    <>
      <div role="tablist" aria-label="Mandate status" className="zui-segmented">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${base}-panel`}
            className="zui-segmented__tab"
            onClick={() => setTab(t.id)}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} className="zui-rail__list">
        <ErrorNote error={board.error} />
        {board.isPending && <p className="zui-hint">Loading mandates…</p>}
        {board.data && list.length === 0 && (
          <div className="zui-rail__empty">
            <p>{tab === "ongoing" ? "No mandates in progress." : "No finished mandates yet."}</p>
            <p className="zui-hint">
              {tab === "ongoing"
                ? "Send a mandate to a division and it will show up here while the team works on it."
                : "Mandates you approve and close will collect here."}
            </p>
          </div>
        )}
        <ul className="zui-mandates" aria-label={tab === "ongoing" ? "Ongoing mandates" : "Finished mandates"}>
          {list.map((t) => (
            <MandateCard key={t.id} task={t} agents={agents} now={now} />
          ))}
        </ul>
        {tab === "finished" && finished.length > finishedShown && (
          <button type="button" className="zui-btn zui-rail__more" onClick={() => setFinishedShown(finishedShown + FINISHED_PAGE)}>
            Show more ({finished.length - finishedShown})
          </button>
        )}
      </div>
    </>
  );
}

function useOngoingCount(): number {
  const board = useBoard();
  const { agents } = useRosterAgents();
  return board.data ? groupMandates(board.data, agents).ongoing.length : 0;
}

export function MandatesRail() {
  const phone = useMediaQuery(PHONE_QUERY);
  const collapsed = useUiStore((s) => s.railCollapsed);
  const sheetOpen = useUiStore((s) => s.railSheetOpen);
  const setCollapsed = useUiStore((s) => s.setRailCollapsed);
  const setSheetOpen = useUiStore((s) => s.setRailSheetOpen);
  const ongoing = useOngoingCount();
  const bodyId = useId();

  if (phone) {
    return (
      <section className={`zui-rail zui-rail--sheet${sheetOpen ? " zui-rail--open" : ""}`} aria-label="Mandates">
        <button type="button" className="zui-rail__bar" aria-expanded={sheetOpen} aria-controls={bodyId} onClick={() => setSheetOpen(!sheetOpen)}>
          <span className="zui-rail__grip" aria-hidden="true" />
          Mandates ({ongoing})
        </button>
        {sheetOpen && (
          <div id={bodyId} className="zui-rail__body">
            <RailBody />
          </div>
        )}
      </section>
    );
  }

  if (collapsed) {
    return (
      <button type="button" className="zui-rail-toggle" aria-expanded={false} onClick={() => setCollapsed(false)}>
        Mandates <span className="zui-count">{ongoing}</span>
      </button>
    );
  }

  return (
    <section className="zui-rail" aria-labelledby={`${bodyId}-title`}>
      <header className="zui-rail__header">
        <h2 id={`${bodyId}-title`} className="zui-heading">
          Mandates
        </h2>
        <button type="button" className="zui-btn zui-btn--icon" aria-label="Collapse mandates" aria-expanded={true} onClick={() => setCollapsed(true)}>
          ›
        </button>
      </header>
      <div className="zui-rail__body">
        <RailBody />
      </div>
    </section>
  );
}
