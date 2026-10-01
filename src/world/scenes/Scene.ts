import type { Container } from "pixi.js";
import type { AgentDiff } from "../diff";
import type { Rect } from "../iso";
import type { Hit, WorldAgent, WorldStats } from "../types";

export interface SceneOptions {
  reducedMotion: boolean;
  /** Dev aid: outline every clickable hotspot. */
  debugHotspots?: boolean;
}

/** "pixel": low-res buffer upscaled with nearest filtering. "smooth": full device resolution, linear filtering. */
export type RenderStyle = "pixel" | "smooth";

/** Where the scene root currently sits on the canvas, for overlays kept in screen space. */
export interface SceneViewport {
  /** Canvas pixels per scene (art/image) pixel. */
  scale: number;
  /** Canvas-pixel position of the scene origin. */
  x: number;
  y: number;
  dpr: number;
  /** Css-pixel area not covered by overlay UI. */
  area: Rect;
}

export interface Scene {
  readonly root: Container;
  readonly style: RenderStyle;
  /** Canvas clear colour; matches the scene art so it has no visible edge. */
  readonly background: number;
  /** Optional layer drawn in screen space (css px), above the scaled root. */
  readonly screen?: Container;
  setViewport?(viewport: SceneViewport): void;
  /** Content to fit and keep on screen, given the visible css area. */
  bounds(area?: Rect): Rect;
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

export function cursorFor(hit: Hit | null, dragging = false): string {
  if (dragging) return "grabbing";
  return hit ? "pointer" : "grab";
}
