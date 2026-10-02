import type { RosterEntry } from "../../shared/api";
import { DIVISIONS, type DivisionId } from "../../shared/divisions";
import { agentActivity, divisionStats, type DivisionStats } from "../../shared/flow";
import type { KanbanBoard } from "../../shared/hermes";
import { ROSTER, type RosterAgent } from "../../shared/roster";
import type { Insets, WorldAgent } from "../world";
import { RAIL_MARGIN, RAIL_SHEET_BAR, RAIL_SHEET_HEIGHT, RAIL_WIDTH } from "../state/rail";

const BUBBLE_MAX = 28;

export function truncate(text: string, max = BUBBLE_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function rosterOrFallback(entries: RosterEntry[] | undefined): RosterEntry[] {
  return entries ?? ROSTER.map((a) => ({ ...a, hired: false, model: null }));
}

export function toWorldAgents(roster: RosterEntry[], board: KanbanBoard | undefined): WorldAgent[] {
  return roster.map((agent) => {
    const { activity, task } = board ? agentActivity(agent.profile, board) : { activity: "idle" as const, task: null };
    return {
      profile: agent.profile,
      title: agent.name ?? agent.title,
      division: agent.division,
      rank: agent.rank,
      activity,
      hired: agent.hired,
      ...(agent.team ? { team: agent.team } : {}),
      ...(agent.teamRole ? { teamRole: agent.teamRole } : {}),
      ...(task ? { bubble: truncate(task.title) } : {}),
    };
  });
}

export function toWorldStats(board: KanbanBoard | undefined): Record<DivisionId, DivisionStats> | null {
  if (!board) return null;
  return Object.fromEntries(DIVISIONS.map((d) => [d.id, divisionStats(board, d.tenant)])) as Record<
    DivisionId,
    DivisionStats
  >;
}

const SIDE_PANELS = new Set(["kanban", "approvals", "agent", "task", "board", "meeting", "leadership", "audits"]);
const PHONE_MAX_WIDTH = 700;
const PHONE_SHEET_HEIGHT = 0.75;
const PANEL_GAP = 8;

function panelWidth(panelKind: string, viewportWidth: number): number {
  const width =
    panelKind === "kanban"
      ? Math.min(720, viewportWidth * 0.52)
      : panelKind === "meeting" || panelKind === "leadership"
        ? Math.min(760, viewportWidth * 0.54)
        : panelKind === "audits"
          ? Math.min(600, viewportWidth - 24)
          : Math.min(440, viewportWidth - 16);
  return Math.round(width + PANEL_GAP);
}

export interface RailLayout {
  collapsed: boolean;
  sheetOpen: boolean;
}

function railInsets(rail: RailLayout, viewport: { width: number; height: number }): Pick<Insets, "right" | "bottom"> {
  if (viewport.width < PHONE_MAX_WIDTH) {
    return { right: 0, bottom: rail.sheetOpen ? Math.round(viewport.height * RAIL_SHEET_HEIGHT) : RAIL_SHEET_BAR };
  }
  return { right: rail.collapsed ? 0 : RAIL_WIDTH + RAIL_MARGIN + PANEL_GAP, bottom: 0 };
}

/**
 * Screen area the overlay UI covers (HUD bottom edge in css px), so the world fits into what stays visible.
 * `rail` is the city mandates rail when it is showing.
 */
export function worldInsets(
  panelKind: string | null,
  viewport: { width: number; height: number },
  hudBottom: number,
  rail: RailLayout | null = null,
): Insets {
  const top = Math.round(hudBottom + PANEL_GAP);
  if (!panelKind || !SIDE_PANELS.has(panelKind)) return { top, left: 0, ...(rail ? railInsets(rail, viewport) : { right: 0, bottom: 0 }) };
  if (viewport.width < PHONE_MAX_WIDTH) {
    return { top, right: 0, bottom: Math.round(viewport.height * PHONE_SHEET_HEIGHT), left: 0 };
  }
  return { top, right: panelWidth(panelKind, viewport.width), bottom: 0, left: 0 };
}

export function isManager(agent: Pick<RosterAgent, "rank"> | undefined): boolean {
  return agent?.rank === "vp";
}
