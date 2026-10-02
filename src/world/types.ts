import type { DivisionId } from "../../shared/divisions";
import type { AgentActivity, DivisionStats } from "../../shared/flow";
import type { Rank } from "../../shared/roster";

export type WorldView = { kind: "city" } | { kind: "floor"; division: DivisionId };

export interface WorldAgent {
  profile: string;
  title: string;
  division: DivisionId;
  rank: Rank;
  activity: AgentActivity;
  bubble?: string;
  hired: boolean;
  /** Zain Tech repo team id (shared/techTeams.ts or a team the VP added at runtime). */
  team?: string;
}

export interface WorldCallbacks {
  onSelectBuilding(division: DivisionId): void;
  onSelectAgent(profile: string): void;
  /** Css colour behind the active scene (light for the city render, navy for floors). */
  onBackgroundChange?(color: string): void;
  /** A Tech team pod's name plate was clicked. */
  onSelectTeam?(teamId: string): void;
}

export type WorldStats = Record<DivisionId, DivisionStats>;

export type Hit =
  | { kind: "building"; division: DivisionId }
  | { kind: "agent"; profile: string }
  | { kind: "team"; team: string };
