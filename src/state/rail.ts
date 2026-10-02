import type { Panel, View } from "./store";

export const RAIL_WIDTH = 360;
export const RAIL_MARGIN = 12;
export const RAIL_SHEET_BAR = 64;
export const RAIL_SHEET_HEIGHT = 0.6;

const SIDE_PANELS: ReadonlySet<Panel["kind"]> = new Set(["kanban", "approvals", "board", "meeting", "agent", "task"]);

/** The mandates rail lives on the city overview and steps aside while a side panel uses the right edge. */
export function railVisible(view: View, panelKind: Panel["kind"] | null): boolean {
  return view.kind === "city" && (panelKind === null || !SIDE_PANELS.has(panelKind));
}
