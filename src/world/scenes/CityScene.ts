import { Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { DivisionId } from "../../../shared/divisions";
import cityUrl from "../assets/city.webp";
import { buildBadge, buildCompactMarker, buildNameLabel, buildZainPlate } from "../draw/cityOverlays";
import type { Rect } from "../iso";
import { CITY_BACKGROUND, CITY_HOTSPOTS, HQ_SIGN, cityFitBounds, hotspotAt, type CityHotspot } from "../layouts/cityImage";
import { divisionColor } from "../palette";
import type { Hit, WorldStats } from "../types";
import type { Scene, SceneOptions, SceneViewport } from "./Scene";

interface Marker {
  hotspot: CityHotspot;
  group: Container;
  label: Container;
  badge: Container;
  bang: Container | null;
  labelH: number;
  badgeH: number;
}

const GAP = 4;
const LIFT = 8;
const TOP_MARGIN = 6;
/** Below this many css px per image px, markers collapse into one compact pill. */
const COMPACT_BELOW = 0.42;

export class CityScene implements Scene {
  readonly root = new Container();
  readonly screen = new Container();
  readonly style = "smooth" as const;
  readonly background = CITY_BACKGROUND;
  private readonly glow = new Graphics();
  private readonly markers: Marker[] = [];
  private hovered: DivisionId | null = null;
  private viewport: SceneViewport | null = null;
  private stats: Partial<WorldStats> | null = null;
  private reducedMotion: boolean;
  private destroyed = false;
  private compact = false;

  constructor(opts: SceneOptions) {
    this.reducedMotion = opts.reducedMotion;
    const plate = new Container();
    buildZainPlate(plate, HQ_SIGN.w, HQ_SIGN.h);
    plate.position.set(HQ_SIGN.x, HQ_SIGN.y);
    this.root.addChild(this.glow, plate);
    if (opts.debugHotspots) this.root.addChild(debugOutlines());
    for (const hotspot of CITY_HOTSPOTS) {
      const group = new Container();
      const label = new Container();
      const badge = new Container();
      group.addChild(label, badge);
      this.screen.addChild(group);
      this.markers.push({ hotspot, group, label, badge, bang: null, labelH: 0, badgeH: 0 });
    }
    void this.loadImage();
  }

  private async loadImage(): Promise<void> {
    const texture = await Assets.load<Texture>({
      src: cityUrl,
      data: { alphaMode: "premultiply-alpha-on-upload", scaleMode: "linear", autoGenerateMipmaps: true },
    });
    if (this.destroyed) return;
    texture.source.scaleMode = "linear";
    texture.source.autoGenerateMipmaps = true;
    texture.source.updateMipmaps();
    const sprite = new Sprite(texture);
    this.root.addChildAt(sprite, 0);
  }

  bounds(area?: Rect): Rect {
    return cityFitBounds(area ?? { w: Number.POSITIVE_INFINITY });
  }

  hitTest(x: number, y: number): Hit | null {
    const division = hotspotAt(x, y);
    return division ? { kind: "building", division } : null;
  }

  setHover(hit: Hit | null): void {
    const next = hit?.kind === "building" ? hit.division : null;
    if (next === this.hovered) return;
    this.hovered = next;
    this.drawGlow();
  }

  setViewport(viewport: SceneViewport): void {
    const compact = viewport.scale / viewport.dpr < COMPACT_BELOW;
    const resChanged = viewport.dpr !== this.viewport?.dpr || compact !== this.compact;
    this.compact = compact;
    const scaleChanged = viewport.scale !== this.viewport?.scale;
    this.viewport = viewport;
    if (resChanged) this.rebuildMarkers();
    if (scaleChanged) this.drawGlow();
    this.screen.scale.set(viewport.dpr);
    this.placeMarkers();
  }

  setStats(stats: Partial<WorldStats> | null): void {
    this.stats = stats;
    this.rebuildMarkers();
  }

  setAgents(): void {}

  setSelected(): void {}

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(_dtMs: number, nowMs: number): void {
    const hop = this.reducedMotion ? 0 : Math.abs(Math.sin(nowMs / 260)) * 3;
    for (const m of this.markers) if (m.bang) m.bang.pivot.y = Math.round(hop);
  }

  private rebuildMarkers(): void {
    const res = Math.max(2, Math.ceil(this.viewport?.dpr ?? 1) * 2);
    for (const m of this.markers) {
      for (const c of [m.label, m.badge]) for (const child of c.removeChildren()) child.destroy();
      const s = this.stats?.[m.hotspot.division];
      if (this.compact) {
        const parts = buildCompactMarker(m.label, m.hotspot.short, divisionColor(m.hotspot.division), s, res);
        m.labelH = parts.height;
        m.badgeH = 0;
        m.bang = parts.bang;
        continue;
      }
      m.labelH = buildNameLabel(m.label, m.hotspot.name, divisionColor(m.hotspot.division), res);
      if (s) {
        const parts = buildBadge(m.badge, s, res);
        m.badgeH = parts.height;
        m.bang = parts.bang;
      } else {
        m.badgeH = 0;
        m.bang = null;
      }
      m.badge.position.set(0, -(m.labelH + GAP));
    }
    this.placeMarkers();
  }

  private placeMarkers(): void {
    const v = this.viewport;
    if (!v) return;
    for (const m of this.markers) {
      const cssX = (v.x + m.hotspot.anchor.x * v.scale) / v.dpr;
      const cssY = (v.y + m.hotspot.anchor.y * v.scale) / v.dpr - LIFT;
      const height = m.labelH + (m.badgeH ? GAP + m.badgeH : 0);
      const minY = v.area.y + TOP_MARGIN + height;
      m.group.position.set(Math.round(cssX), Math.round(Math.max(cssY, minY)));
    }
  }

  private drawGlow(): void {
    this.glow.clear();
    const hotspot = CITY_HOTSPOTS.find((h) => h.division === this.hovered);
    if (!hotspot) return;
    const q = this.viewport?.scale ?? 1;
    const color = divisionColor(hotspot.division);
    const pts = hotspot.polygon.flatMap((p) => [p.x, p.y]);
    this.glow.poly(pts).fill({ color, alpha: 0.12 });
    for (const [w, alpha] of [[14, 0.12], [8, 0.2], [4, 0.45], [2, 1]] as const) {
      this.glow.poly(pts).stroke({ color, width: w / q, alpha, join: "round" });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.screen.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}

function debugOutlines(): Graphics {
  const g = new Graphics();
  for (const h of CITY_HOTSPOTS) {
    const pts = h.polygon.flatMap((p) => [p.x, p.y]);
    g.poly(pts).fill({ color: divisionColor(h.division), alpha: 0.25 }).stroke({ color: divisionColor(h.division), width: 2 });
    g.circle(h.anchor.x, h.anchor.y, 5).fill(0xff00ff);
  }
  return g;
}
