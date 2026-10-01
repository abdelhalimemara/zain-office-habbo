import type { Container } from "pixi.js";
import type { AgentDiff } from "../diff";
import type { Rect } from "../iso";
import type { Hit, WorldAgent, WorldStats } from "../types";

export interface SceneOptions {
  reducedMotion: boolean;
}

export interface Scene {
  readonly root: Container;
  bounds(): Rect;
  hitTest(x: number, y: number): Hit | null;
  setHover(hit: Hit | null): void;
  update(dtMs: number, nowMs: number): void;
  setAgents(agents: ReadonlyMap<string, WorldAgent>, diff: AgentDiff): void;
  setStats(stats: Partial<WorldStats> | null): void;
  setSelected(profile: string | null): void;
  setReducedMotion(reduced: boolean): void;
  destroy(): void;
}

export function sameHit(a: Hit | null, b: Hit | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "building" && b.kind === "building") return a.division === b.division;
  if (a.kind === "agent" && b.kind === "agent") return a.profile === b.profile;
  return false;
}
