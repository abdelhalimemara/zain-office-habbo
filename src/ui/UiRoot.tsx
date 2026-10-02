import { useEffect } from "react";
import { railVisible } from "../state/rail";
import { useUiStore, type Panel } from "../state/store";
import { AgentCard } from "./AgentCard";
import { ApprovalsInbox } from "./ApprovalsInbox";
import { BoardPanel } from "./BoardPanel";
import { CallMeetingCta } from "./CallMeetingCta";
import { CallMeetingDialog } from "./CallMeetingDialog";
import { MeetingRoom } from "./MeetingRoom";
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
      return `board:${panel.members?.join(",") ?? ""}:${panel.tab ?? ""}`;
    case "meeting":
      return `meeting:${panel.id}`;
  }
}

function OpenPanel({ panel }: { panel: Panel }) {
  switch (panel.kind) {
    case "kanban":
      return <KanbanPanel division={panel.division} />;
    case "approvals":
      return <ApprovalsInbox />;
    case "board":
      return <BoardPanel members={panel.members} tab={panel.tab} />;
    case "meeting":
      return <MeetingRoom id={panel.id} />;
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
  const callMeetingOpen = useUiStore((s) => s.callMeetingOpen);
  const setCallMeetingOpen = useUiStore((s) => s.setCallMeetingOpen);

  useEffect(() => {
    if (!panel && !callMeetingOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (callMeetingOpen) setCallMeetingOpen(false);
      else closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, closePanel, callMeetingOpen, setCallMeetingOpen]);

  return (
    <div className="zui-root">
      <Hud />
      {railVisible(view, panel?.kind ?? null) && <MandatesRail />}
      {view.kind === "floor" && view.division === "hq" && <CallMeetingCta />}
      {panel && <OpenPanel key={panelKey(panel)} panel={panel} />}
      {callMeetingOpen && <CallMeetingDialog />}
    </div>
  );
}
