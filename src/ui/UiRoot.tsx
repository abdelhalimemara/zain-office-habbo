import { useEffect } from "react";
import { railVisible } from "../state/rail";
import { useUiStore, type Panel } from "../state/store";
import { AgentCard } from "./AgentCard";
import { ApprovalsInbox } from "./ApprovalsInbox";
import { BoardPanel } from "./BoardPanel";
import { HireDialog } from "./HireDialog";
import { Hud } from "./Hud";
import { KanbanPanel } from "./KanbanPanel";
import { MandatesRail } from "./MandatesRail";
import { NewMandateDialog } from "./NewMandateDialog";
import { TaskDrawer } from "./TaskDrawer";
import "./styles.css";

function panelKey(panel: Panel): string {
  switch (panel.kind) {
    case "kanban":
      return `kanban:${panel.division}`;
    case "agent":
      return `agent:${panel.profile}`;
    case "task":
      return `task:${panel.id}`;
    case "hire":
      return `hire:${panel.division ?? ""}:${panel.prefill?.profile ?? ""}`;
    case "mandate":
      return `mandate:${panel.division ?? ""}`;
    case "approvals":
      return "approvals";
    case "board":
      return `board:${panel.members?.join(",") ?? ""}`;
  }
}

function OpenPanel({ panel }: { panel: Panel }) {
  switch (panel.kind) {
    case "kanban":
      return <KanbanPanel division={panel.division} />;
    case "approvals":
      return <ApprovalsInbox />;
    case "board":
      return <BoardPanel members={panel.members} />;
    case "agent":
      return <AgentCard profile={panel.profile} />;
    case "task":
      return <TaskDrawer id={panel.id} />;
    case "mandate":
      return <NewMandateDialog division={panel.division} />;
    case "hire":
      return <HireDialog division={panel.division} prefill={panel.prefill} />;
  }
}

export function UiRoot() {
  const panel = useUiStore((s) => s.panel);
  const closePanel = useUiStore((s) => s.closePanel);
  const view = useUiStore((s) => s.view);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, closePanel]);

  return (
    <div className="zui-root">
      <Hud />
      {railVisible(view, panel?.kind ?? null) && <MandatesRail />}
      {panel && <OpenPanel key={panelKey(panel)} panel={panel} />}
    </div>
  );
}
