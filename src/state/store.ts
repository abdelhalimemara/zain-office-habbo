import { create } from "zustand";
import type { DivisionId } from "@shared/divisions";
import type { RosterAgent } from "@shared/roster";

export type View = { kind: "city" } | { kind: "floor"; division: DivisionId };

export type HirePrefill = Partial<Pick<RosterAgent, "profile" | "title" | "rank" | "reportsTo" | "skills">>;

export type Panel =
  | { kind: "kanban"; division: DivisionId }
  | { kind: "approvals" }
  | { kind: "board"; members?: string[] }
  | { kind: "agent"; profile: string }
  | { kind: "task"; id: string }
  | { kind: "mandate"; division?: DivisionId }
  | { kind: "hire"; division?: DivisionId; prefill?: HirePrefill };

export interface UiState {
  view: View;
  selectedAgent: string | null;
  panel: Panel | null;
  goToCity: () => void;
  enterDivision: (division: DivisionId) => void;
  openPanel: (panel: Panel) => void;
  closePanel: () => void;
  selectAgent: (profile: string | null) => void;
}

export const initialUiState: Pick<UiState, "view" | "selectedAgent" | "panel"> = {
  view: { kind: "city" },
  selectedAgent: null,
  panel: null,
};

export const useUiStore = create<UiState>()((set) => ({
  ...initialUiState,
  goToCity: () => set({ view: { kind: "city" }, selectedAgent: null, panel: null }),
  enterDivision: (division) => set({ view: { kind: "floor", division }, selectedAgent: null, panel: null }),
  openPanel: (panel) =>
    set((s) => ({ panel, selectedAgent: panel.kind === "agent" ? panel.profile : s.selectedAgent })),
  closePanel: () => set({ panel: null, selectedAgent: null }),
  selectAgent: (profile) =>
    set(profile ? { selectedAgent: profile, panel: { kind: "agent", profile } } : { selectedAgent: null, panel: null }),
}));
