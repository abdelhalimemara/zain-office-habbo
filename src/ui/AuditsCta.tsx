import { useAudits } from "../api/auditHooks";
import { useUiStore } from "../state/store";
import { isAuditActive } from "./auditModel";
import { PHONE_QUERY } from "./KanbanPanel";
import { useMediaQuery } from "./useMediaQuery";

/** Floating call-to-action over the Zain Growth floor, beside the meeting room (top-left of the plan). Opens the prospect audits. */
export function AuditsCta() {
  const openPanel = useUiStore((s) => s.openPanel);
  const panelOpen = useUiStore((s) => s.panel !== null);
  const phone = useMediaQuery(PHONE_QUERY);
  const { data } = useAudits();
  const running = data?.audits.filter(isAuditActive).length ?? 0;
  if (phone && panelOpen) return null;
  return (
    <div className="zui-call-cta">
      <span className="zui-call-cta__label" aria-hidden="true">
        Growth
      </span>
      <button type="button" className="zui-btn zui-btn--primary" onClick={() => openPanel({ kind: "audits" })}>
        <span className={`zui-call-cta__dot zui-call-cta__dot--growth${running ? " zui-call-cta__dot--live" : ""}`} aria-hidden="true" />
        Prospect audits
        {running > 0 && (
          <span className="zui-count zui-count--alert">
            {running}
            <span className="zui-sr-only"> running</span>
          </span>
        )}
      </button>
    </div>
  );
}
