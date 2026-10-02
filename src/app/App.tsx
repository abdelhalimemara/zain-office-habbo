import { useCallback, useMemo } from "react";
import type { DivisionId } from "../../shared/divisions";
import { findAgent } from "../../shared/roster";
import { useBoard, useRoster } from "../api/hooks";
import { railVisible } from "../state/rail";
import { useUiStore } from "../state/store";
import { UiRoot } from "../ui/UiRoot";
import { useHudBottom } from "../ui/useHudBottom";
import { WorldCanvas } from "../world/WorldCanvas";
import { useViewport } from "./useViewport";
import { isManager, rosterOrFallback, toWorldAgents, toWorldStats, worldInsets } from "./worldModel";
import "./app.css";

export function App() {
  const board = useBoard().data;
  const rosterData = useRoster().data;
  const view = useUiStore((s) => s.view);
  const selectedAgent = useUiStore((s) => s.selectedAgent);
  const enterDivision = useUiStore((s) => s.enterDivision);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const openPanel = useUiStore((s) => s.openPanel);
  const panelKind = useUiStore((s) => s.panel?.kind ?? null);
  const viewport = useViewport();
  const hudBottom = useHudBottom();
  const railCollapsed = useUiStore((s) => s.railCollapsed);
  const railSheetOpen = useUiStore((s) => s.railSheetOpen);
  const rail = railVisible(view, panelKind);
  const insets = useMemo(
    () => worldInsets(panelKind, viewport, hudBottom, rail ? { collapsed: railCollapsed, sheetOpen: railSheetOpen } : null),
    [panelKind, viewport, hudBottom, rail, railCollapsed, railSheetOpen],
  );

  const roster = useMemo(() => rosterOrFallback(rosterData?.agents), [rosterData]);
  const agents = useMemo(() => toWorldAgents(roster, board), [roster, board]);
  const stats = useMemo(() => toWorldStats(board), [board]);

  const onSelectBuilding = useCallback((division: DivisionId) => enterDivision(division), [enterDivision]);

  const onSelectAgent = useCallback(
    (profile: string) => {
      const agent = findAgent(profile, roster);
      if (agent && isManager(agent)) openPanel({ kind: "kanban", division: agent.division });
      else selectAgent(profile);
    },
    [roster, openPanel, selectAgent],
  );

  return (
    <main className="app">
      <WorldCanvas
        className="app-world"
        view={view}
        agents={agents}
        stats={stats}
        selectedAgent={selectedAgent}
        insets={insets}
        onSelectBuilding={onSelectBuilding}
        onSelectAgent={onSelectAgent}
      />
      <UiRoot />
    </main>
  );
}
