import { useCallback, useMemo } from "react";
import type { DivisionId } from "../../shared/divisions";
import { findAgent } from "../../shared/roster";
import { useBoard, useRoster } from "../api/hooks";
import { useUiStore } from "../state/store";
import { UiRoot } from "../ui/UiRoot";
import { WorldCanvas } from "../world/WorldCanvas";
import { isManager, rosterOrFallback, toWorldAgents, toWorldStats } from "./worldModel";
import "./app.css";

export function App() {
  const board = useBoard().data;
  const rosterData = useRoster().data;
  const view = useUiStore((s) => s.view);
  const selectedAgent = useUiStore((s) => s.selectedAgent);
  const enterDivision = useUiStore((s) => s.enterDivision);
  const selectAgent = useUiStore((s) => s.selectAgent);
  const openPanel = useUiStore((s) => s.openPanel);

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
        onSelectBuilding={onSelectBuilding}
        onSelectAgent={onSelectAgent}
      />
      <UiRoot />
    </main>
  );
}
