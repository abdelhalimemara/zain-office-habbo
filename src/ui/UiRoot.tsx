import { useEffect } from "react";
import { railVisible } from "../state/rail";
import { useUiStore, type Panel } from "../state/store";
import { AgentCard } from "./AgentCard";
import { AuditsCta } from "./AuditsCta";
import { AuditsPanel } from "./AuditsPanel";
import { ApprovalsInbox } from "./ApprovalsInbox";
import { BoardPanel } from "./BoardPanel";
import { CallMeetingCta } from "./CallMeetingCta";
import { CallMeetingDialog } from "./CallMeetingDialog";
import { MeetingRoom } from "./MeetingRoom";
import { HireDialog } from "./HireDialog";
import { Hud } from "./Hud";
import { KanbanPanel } from "./KanbanPanel";
import { LeadershipCta } from "./LeadershipCta";
import { LeadershipPanel } from "./LeadershipPanel";
import { MandatesRail } from "./MandatesRail";
import { NewMandateDialog } from "./NewMandateDialog";
import { StartLeadershipDialog } from "./StartLeadershipDialog";
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
    case "leadership":
      return `leadership:${panel.id ?? ""}`;
    case "audits":
      return `audits:${panel.id ?? ""}:${panel.compose ? "new" : ""}`;
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
    case "leadership":
      return <LeadershipPanel id={panel.id} />;
    case "audits":
      return <AuditsPanel id={panel.id} compose={panel.compose} />;
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
  const leadershipDialogOpen = useUiStore((s) => s.leadershipDialogOpen);
  const setLeadershipDialogOpen = useUiStore((s) => s.setLeadershipDialogOpen);

  useEffect(() => {
    if (!panel && !callMeetingOpen && !leadershipDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (callMeetingOpen) setCallMeetingOpen(false);
      else if (leadershipDialogOpen) setLeadershipDialogOpen(false);
      else closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, closePanel, callMeetingOpen, setCallMeetingOpen, leadershipDialogOpen, setLeadershipDialogOpen]);

  return (
    <div className="zui-root">
      <Hud />
      {railVisible(view, panel?.kind ?? null) && <MandatesRail />}
      {view.kind === "floor" && view.division === "hq" && <CallMeetingCta />}
      {view.kind === "floor" && view.division === "hq" && <LeadershipCta />}
      {view.kind === "floor" && view.division === "growth" && <AuditsCta />}
      {panel && <OpenPanel key={panelKey(panel)} panel={panel} />}
      {callMeetingOpen && <CallMeetingDialog />}
      {leadershipDialogOpen && <StartLeadershipDialog />}
    </div>
  );
}
