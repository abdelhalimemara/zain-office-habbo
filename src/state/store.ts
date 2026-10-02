import { create } from "zustand";
import type { DivisionId } from "@shared/divisions";
import type { RosterAgent } from "@shared/roster";

export type View = { kind: "city" } | { kind: "floor"; division: DivisionId };

export type HirePrefill = Partial<Pick<RosterAgent, "profile" | "title" | "rank" | "reportsTo" | "skills">>;

export type Panel =
  | { kind: "kanban"; division: DivisionId }
  | { kind: "approvals" }
  | { kind: "board"; members?: string[]; tab?: "meetings" | "consult" | "memory" }
  | { kind: "meeting"; id: string }
  | { kind: "agent"; profile: string }
  | { kind: "task"; id: string }
  | { kind: "mandate"; division?: DivisionId }
  | { kind: "hire"; division?: DivisionId; prefill?: HirePrefill };

export const RAIL_COLLAPSED_KEY = "zui.mandatesRail.collapsed";

export function loadRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveRailCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    return;
  }
}

export interface UiState {
  view: View;
  selectedAgent: string | null;
  panel: Panel | null;
  /** Desktop mandates rail folded to a button; remembered across visits. */
  railCollapsed: boolean;
  /** Phone mandates sheet expanded; starts folded every visit. */
  railSheetOpen: boolean;
  /** The "Call a meeting" modal is open over whatever else is showing. */
  callMeetingOpen: boolean;
  goToCity: () => void;
  enterDivision: (division: DivisionId) => void;
  openPanel: (panel: Panel) => void;
  closePanel: () => void;
  selectAgent: (profile: string | null) => void;
  /** Enter the mandate's division floor with its task overview open. */
  openMandate: (id: string, division: DivisionId) => void;
  setRailCollapsed: (collapsed: boolean) => void;
  setRailSheetOpen: (open: boolean) => void;
  setCallMeetingOpen: (open: boolean) => void;
}

export const initialUiState: Pick<UiState, "view" | "selectedAgent" | "panel" | "railCollapsed" | "railSheetOpen" | "callMeetingOpen"> = {
  view: { kind: "city" },
  selectedAgent: null,
  panel: null,
  railCollapsed: false,
  railSheetOpen: false,
  callMeetingOpen: false,
};

export const useUiStore = create<UiState>()((set) => ({
  ...initialUiState,
  railCollapsed: loadRailCollapsed(),
  goToCity: () => set({ view: { kind: "city" }, selectedAgent: null, panel: null, callMeetingOpen: false }),
  enterDivision: (division) => set({ view: { kind: "floor", division }, selectedAgent: null, panel: null, callMeetingOpen: false }),
  openPanel: (panel) =>
    set((s) => ({ panel, selectedAgent: panel.kind === "agent" ? panel.profile : s.selectedAgent })),
  closePanel: () => set({ panel: null, selectedAgent: null }),
  selectAgent: (profile) =>
    set(profile ? { selectedAgent: profile, panel: { kind: "agent", profile } } : { selectedAgent: null, panel: null }),
  openMandate: (id, division) =>
    set({ view: { kind: "floor", division }, selectedAgent: null, panel: { kind: "task", id }, railSheetOpen: false }),
  setRailCollapsed: (railCollapsed) => {
    saveRailCollapsed(railCollapsed);
    set({ railCollapsed });
  },
  setRailSheetOpen: (railSheetOpen) => set({ railSheetOpen }),
  setCallMeetingOpen: (callMeetingOpen) => set({ callMeetingOpen }),
}));
