import type { RosterEntry } from "../../shared/api";
import { DIVISIONS, type DivisionId } from "../../shared/divisions";
import { agentActivity, divisionStats, type DivisionStats } from "../../shared/flow";
import type { KanbanBoard } from "../../shared/hermes";
import { ROSTER, type RosterAgent } from "../../shared/roster";
import type { Insets, WorldAgent } from "../world";

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
      title: agent.title,
      division: agent.division,
      rank: agent.rank,
      activity,
      hired: agent.hired,
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

const SIDE_PANELS = new Set(["kanban", "approvals", "agent", "task"]);
const PHONE_MAX_WIDTH = 700;
const PHONE_SHEET_HEIGHT = 0.75;
const PANEL_GAP = 8;

function panelWidth(panelKind: string, viewportWidth: number): number {
  const width = panelKind === "kanban" ? Math.min(720, viewportWidth * 0.52) : Math.min(440, viewportWidth - 16);
  return Math.round(width + PANEL_GAP);
}

/** Screen area the overlay UI covers (HUD bottom edge in css px), so the world fits into what stays visible. */
export function worldInsets(
  panelKind: string | null,
  viewport: { width: number; height: number },
  hudBottom: number,
): Insets {
  const top = Math.round(hudBottom + PANEL_GAP);
  if (!panelKind || !SIDE_PANELS.has(panelKind)) return { top, right: 0, bottom: 0, left: 0 };
  if (viewport.width < PHONE_MAX_WIDTH) {
    return { top, right: 0, bottom: Math.round(viewport.height * PHONE_SHEET_HEIGHT), left: 0 };
  }
  return { top, right: panelWidth(panelKind, viewport.width), bottom: 0, left: 0 };
}

export function isManager(agent: Pick<RosterAgent, "rank"> | undefined): boolean {
  return agent?.rank === "vp";
}
