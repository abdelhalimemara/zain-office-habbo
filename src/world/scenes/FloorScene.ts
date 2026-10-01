import { Container, Graphics } from "pixi.js";
import type { DivisionId } from "../../../shared/divisions";
import type { AgentDiff } from "../diff";
import { BACK_WALL_H, drawFloorBase, drawWall, wallBox, wallPieces } from "../draw/floor";
import { chairBack, chairBackBox, chairSeat, chairSeatBox, drawFurniture, sortBox } from "../draw/furniture";
import { drawRoomLabel } from "../draw/overlays";
import { screenBounds, sortDepth, type Box, type Ranked, type Rect } from "../iso";
import { placeRoomLabels } from "../labels";
import { floorLayout } from "../layouts";
import { NON_BLOCKING, type FloorLayout } from "../layouts/types";
import { divisionColor } from "../palette";
import { loungeSpot } from "../pathing";
import { assignSeats, rosterOrder } from "../seating";
import type { Hit, WorldAgent, WorldStats } from "../types";
import { AgentSprite, type AgentHost } from "./AgentSprite";
import type { Scene, SceneOptions } from "./Scene";

interface StaticItem {
  box: Box;
  draw(g: Graphics): void;
  deskId?: string;
}

export class FloorScene implements Scene, AgentHost {
  readonly root = new Container();
  readonly objects = new Container();
  readonly overlay = new Container();
  readonly layout: FloorLayout;
  statics: Ranked[] = [];
  reducedMotion: boolean;
  private readonly base = new Graphics();
  private readonly labels = new Container();
  private readonly deskDepths = new Map<string, number>();
  private readonly sprites = new Map<string, AgentSprite>();
  private readonly accent: number;
  private selected: string | null = null;
  private hovered: string | null = null;

  constructor(
    readonly division: DivisionId,
    opts: SceneOptions,
  ) {
    this.reducedMotion = opts.reducedMotion;
    this.layout = floorLayout(division);
    this.accent = divisionColor(division);
    this.objects.sortableChildren = true;
    this.overlay.sortableChildren = true;
    this.root.addChild(this.base, this.objects, this.labels, this.overlay);
    this.buildStatic();
  }

  deskDepth(deskId: string): number {
    return this.deskDepths.get(deskId) ?? 0;
  }

  private buildStatic(): void {
    const { layout, accent } = this;
    drawFloorBase(this.base, layout, accent);
    for (const f of layout.furniture) if (NON_BLOCKING.has(f.kind)) drawFurniture(this.base, f, accent);
    this.base.cacheAsTexture({ antialias: false, scaleMode: "nearest" });

    const items: StaticItem[] = [];
    for (const f of layout.furniture) {
      if (NON_BLOCKING.has(f.kind)) continue;
      items.push({ box: sortBox(f), draw: (g) => drawFurniture(g, f, accent), deskId: f.id });
    }
    for (const w of layout.walls) for (const piece of wallPieces(w)) items.push({ box: wallBox(piece), draw: (g) => drawWall(g, piece) });
    for (const s of layout.seats) {
      items.push({ box: chairSeatBox(s.x, s.y, s.facing), draw: (g) => chairSeat(g, s.x, s.y, accent) });
      items.push({ box: chairBackBox(s.x, s.y, s.facing), draw: (g) => chairBack(g, s.x, s.y, s.facing, accent) });
    }
    const depths = sortDepth(items.map((i) => i.box));
    items.forEach((item, i) => {
      const g = new Graphics();
      item.draw(g);
      g.zIndex = depths[i]!;
      this.objects.addChild(g);
      this.statics.push({ box: item.box, depth: depths[i]! });
      if (item.deskId) this.deskDepths.set(item.deskId, depths[i]!);
    });

    for (const { text, rect } of placeRoomLabels(layout)) {
      const g = new Graphics();
      drawRoomLabel(g, text, accent);
      g.position.set(rect.x + Math.floor(rect.w / 2), rect.y + rect.h);
      g.alpha = 0.92;
      this.labels.addChild(g);
    }
  }

  bounds(): Rect {
    const b = screenBounds({ x0: -0.3, y0: -0.3, x1: this.layout.cols, y1: this.layout.rows, h: BACK_WALL_H + 8 });
    return { x: b.x, y: b.y, w: b.w, h: b.h + 12 };
  }

  setAgents(all: ReadonlyMap<string, WorldAgent>, diff: AgentDiff): void {
    for (const p of diff.removed) this.dropSprite(p);
    const mine = [...all.values()].filter((a) => a.division === this.division);
    for (const [profile, sprite] of this.sprites) if (!mine.some((a) => a.profile === profile)) {
      sprite.destroy();
      this.sprites.delete(profile);
    }
    const changed = new Set([...diff.added, ...diff.updated].map((a) => a.profile));
    for (const a of mine) {
      const existing = this.sprites.get(a.profile);
      if (!existing) {
        const sprite = new AgentSprite(this, a);
        sprite.setSelected(this.selected === a.profile);
        this.sprites.set(a.profile, sprite);
      } else if (changed.has(a.profile)) {
        existing.update(a);
      }
    }
    const { seats } = assignSeats(this.layout, mine);
    rosterOrder(mine).forEach((a, i) => {
      this.sprites.get(a.profile)?.assign(seats.get(a.profile) ?? null, loungeSpot(this.layout, i));
    });
  }

  private dropSprite(profile: string): void {
    const s = this.sprites.get(profile);
    if (!s) return;
    s.destroy();
    this.sprites.delete(profile);
  }

  setStats(_stats: Partial<WorldStats> | null): void {}

  setSelected(profile: string | null): void {
    this.selected = profile;
    for (const [p, s] of this.sprites) s.setSelected(p === profile);
  }

  setHover(hit: Hit | null): void {
    const next = hit?.kind === "agent" ? hit.profile : null;
    if (next === this.hovered) return;
    if (this.hovered) this.sprites.get(this.hovered)?.setHover(false);
    this.hovered = next;
    if (next) this.sprites.get(next)?.setHover(true);
  }

  hitTest(x: number, y: number): Hit | null {
    let best: AgentSprite | null = null;
    for (const s of this.sprites.values()) {
      const r = s.hitRect();
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && (!best || s.depth > best.depth)) best = s;
    }
    return best ? { kind: "agent", profile: best.profile } : null;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(dtMs: number, nowMs: number): void {
    for (const s of this.sprites.values()) s.tick(dtMs, nowMs);
  }

  destroy(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.root.destroy({ children: true });
  }
}
