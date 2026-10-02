import { useUiStore } from "../state/store";
import { useRosterAgents } from "./common";
import { PHONE_QUERY } from "./KanbanPanel";
import { useMediaQuery } from "./useMediaQuery";

/** Floating call-to-action over the HQ floor, beside the board room (top-left of the plan). Phones hide it under a panel sheet. */
export function CallMeetingCta() {
  const open = useUiStore((s) => s.setCallMeetingOpen);
  const panelOpen = useUiStore((s) => s.panel !== null);
  const phone = useMediaQuery(PHONE_QUERY);
  const { agents, loaded } = useRosterAgents();
  const anyHired = agents.some((a) => a.rank === "board" && a.hired);
  if (phone && panelOpen) return null;
  return (
    <div className="zui-call-cta">
      <span className="zui-call-cta__label" aria-hidden="true">
        Board room
      </span>
      <button
        type="button"
        className="zui-btn zui-btn--gold"
        onClick={() => open(true)}
        disabled={loaded && !anyHired}
        title={loaded && !anyHired ? "Hire a board member first" : undefined}
        aria-haspopup="dialog"
      >
        <span className="zui-call-cta__dot" aria-hidden="true" />
        Call a meeting
      </button>
    </div>
  );
}
