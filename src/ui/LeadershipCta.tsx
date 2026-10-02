import { LEADERSHIP_SEATS } from "@shared/leadership";
import { useUiStore } from "../state/store";
import { useRosterAgents } from "./common";
import { PHONE_QUERY } from "./KanbanPanel";
import { useMediaQuery } from "./useMediaQuery";

/** Floating call-to-action over the HQ floor, beside the executive offices (right of the plan). Opens the VP room. */
export function LeadershipCta() {
  const openPanel = useUiStore((s) => s.openPanel);
  const panelOpen = useUiStore((s) => s.panel !== null);
  const phone = useMediaQuery(PHONE_QUERY);
  const { agents, loaded } = useRosterAgents();
  const anyHired = LEADERSHIP_SEATS.some((p) => agents.find((a) => a.profile === p)?.hired);
  if (panelOpen) return null;
  return (
    <div className={`zui-call-cta zui-call-cta--exec${phone ? " zui-call-cta--stacked" : ""}`}>
      <span className="zui-call-cta__label" aria-hidden="true">
        Executive suite
      </span>
      <button
        type="button"
        className="zui-btn zui-btn--primary"
        onClick={() => openPanel({ kind: "leadership" })}
        disabled={loaded && !anyHired}
        title={loaded && !anyHired ? "Hire your COO or a VP first" : undefined}
      >
        <span className="zui-call-cta__dot zui-call-cta__dot--gold" aria-hidden="true" />
        Call a VP meeting
      </button>
    </div>
  );
}
