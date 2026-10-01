import { Container, Graphics } from "pixi.js";
import type { DivisionId } from "../../../shared/divisions";
import { drawPedestrian } from "../draw/avatar";
import { buildingBox, drawDivisionBuilding, drawHqTower } from "../draw/buildings";
import { PROP_HEIGHT, drawCityGround, drawProp } from "../draw/city";
import { drawBadge, drawBang } from "../draw/overlays";
import { hashString, pick, seededRandom } from "../hash";
import { boxHull, dynamicDepth, pointInPolygon, screenBounds, sortDepth, toScreen, type Box, type Pt, type Ranked, type Rect } from "../iso";
import { CITY_BUILDINGS, CITY_PROPS, CITY_SIZE, PED_LOOPS, loopLength, pointOnLoop, type CityBuilding, type PedLoop } from "../layouts/city";
import { HAIR_COLORS, PAL, SKIN_TONES, divisionColor } from "../palette";
import type { Hit, WorldStats } from "../types";
import type { Scene, SceneOptions } from "./Scene";

interface BuildingView {
  building: CityBuilding;
  hull: Pt[];
  depth: number;
  badge: Container;
  badgeBase: Graphics;
  bang: Graphics;
  bangAt: { x: number; y: number } | null;
}

interface Ped {
  g: Graphics;
  loop: PedLoop;
  offset: number;
  speed: number;
  colors: [number, number, number];
  frameKey: string;
}

const SHIRTS = [0xe0567a, 0x3dbe7a, 0x8e6cef, 0x3a9bef, 0xf2c230, 0xf4f5f7, 0xe67e22, 0x2c3e50];

export class CityScene implements Scene {
  readonly root = new Container();
  private readonly base = new Graphics();
  private readonly objects = new Container();
  private readonly overlay = new Container();
  private readonly hoverLine = new Graphics();
  private readonly buildings: BuildingView[] = [];
  private readonly peds: Ped[] = [];
  private statics: Ranked[] = [];
  private hovered: DivisionId | null = null;
  private reducedMotion: boolean;

  constructor(opts: SceneOptions) {
    this.reducedMotion = opts.reducedMotion;
    this.objects.sortableChildren = true;
    this.root.addChild(this.base, this.objects, this.hoverLine, this.overlay);
    this.build();
  }

  private build(): void {
    drawCityGround(this.base);
    this.base.cacheAsTexture({ antialias: false, scaleMode: "nearest" });

    const boxes: Box[] = [
      ...CITY_BUILDINGS.map(buildingBox),
      ...CITY_PROPS.map((p) => ({ x0: p.x + 0.1, y0: p.y + 0.1, x1: p.x + p.w - 0.1, y1: p.y + p.d - 0.1, h: PROP_HEIGHT[p.kind] })),
    ];
    const depths = sortDepth(boxes);
    this.statics = boxes.map((box, i) => ({ box, depth: depths[i]! }));

    CITY_BUILDINGS.forEach((b, i) => {
      const g = new Graphics();
      if (b.division === "hq") drawHqTower(g, b);
      else drawDivisionBuilding(g, b, divisionColor(b.division));
      g.zIndex = depths[i]!;
      this.objects.addChild(g);
      g.cacheAsTexture({ antialias: false, scaleMode: "nearest" });
      const box = boxes[i]!;
      const badge = new Container();
      const top = toScreen(b.x + b.w / 2, b.y + b.d / 2, box.h + 14);
      badge.position.set(Math.round(top.x), Math.round(top.y));
      badge.scale.set(2);
      const badgeBase = new Graphics();
      const bang = new Graphics();
      drawBang(bang);
      badge.addChild(badgeBase, bang);
      badge.visible = false;
      this.overlay.addChild(badge);
      this.buildings.push({ building: b, hull: boxHull(box), depth: depths[i]!, badge, badgeBase, bang, bangAt: null });
    });

    CITY_PROPS.forEach((p, i) => {
      const g = new Graphics();
      drawProp(g, p);
      g.zIndex = depths[CITY_BUILDINGS.length + i]!;
      this.objects.addChild(g);
    });

    PED_LOOPS.forEach((loop, li) => {
      for (let k = 0; k < 3; k++) {
        const r = seededRandom(hashString(`ped-${li}-${k}`));
        const g = new Graphics();
        this.objects.addChild(g);
        this.peds.push({
          g,
          loop,
          offset: r(),
          speed: (0.45 + r() * 0.35) * (k === 1 ? -1 : 1),
          colors: [pick(SHIRTS, Math.floor(r() * 97)), pick(HAIR_COLORS, Math.floor(r() * 97)), pick(SKIN_TONES, Math.floor(r() * 97))],
          frameKey: "",
        });
      }
    });
    this.update(0, 0);
  }

  bounds(): Rect {
    const b = screenBounds({ x0: 0, y0: 0, x1: CITY_SIZE, y1: CITY_SIZE, h: 0 });
    const tallest = Math.max(...this.buildings.map((v) => -Math.min(...v.hull.map((p) => p.y))));
    const top = Math.min(b.y, -tallest - 30);
    return { x: b.x, y: top, w: b.w, h: b.y + b.h + 18 - top };
  }

  hitTest(x: number, y: number): Hit | null {
    let best: BuildingView | null = null;
    for (const v of this.buildings) {
      if (pointInPolygon({ x, y }, v.hull) && (!best || v.depth > best.depth)) best = v;
    }
    return best ? { kind: "building", division: best.building.division } : null;
  }

  setHover(hit: Hit | null): void {
    const next = hit?.kind === "building" ? hit.division : null;
    if (next === this.hovered) return;
    this.hovered = next;
    this.hoverLine.clear();
    const v = this.buildings.find((b) => b.building.division === next);
    if (!v) return;
    const pts = v.hull.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
    this.hoverLine.poly(pts).stroke({ color: PAL.yellow, width: 2, alpha: 0.95 });
    this.hoverLine.poly(pts).fill({ color: PAL.white, alpha: 0.08 });
  }

  setStats(stats: Partial<WorldStats> | null): void {
    for (const v of this.buildings) {
      const s = stats?.[v.building.division];
      v.badgeBase.clear();
      v.badge.visible = !!s;
      if (!s) continue;
      v.bangAt = drawBadge(v.badgeBase, { working: s.working, blocked: s.blocked, awaiting: s.awaitingApproval }).bang;
      v.bang.visible = !!v.bangAt;
      if (v.bangAt) v.bang.position.set(v.bangAt.x, v.bangAt.y);
    }
  }

  setAgents(): void {}

  setSelected(): void {}

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(_dtMs: number, nowMs: number): void {
    const still = this.reducedMotion;
    const t = still ? 0 : nowMs / 1000;
    for (const p of this.peds) {
      const len = loopLength(p.loop);
      const pos = pointOnLoop(p.loop, p.offset + (t * p.speed) / len);
      const sign = p.speed < 0 ? -pos.sign : pos.sign;
      const facing = pos.dir === "x" ? (sign > 0 ? "se" : "nw") : sign > 0 ? "sw" : "ne";
      const frame = still ? 0 : Math.floor(nowMs / 160) % 4;
      const key = `${facing}|${frame}`;
      if (key !== p.frameKey) {
        p.frameKey = key;
        p.g.clear();
        drawPedestrian(p.g, p.colors[0], p.colors[1], p.colors[2], frame, facing === "ne" || facing === "nw");
        p.g.scale.x = facing === "sw" || facing === "nw" ? -1 : 1;
      }
      const s = toScreen(pos.x, pos.y);
      p.g.position.set(Math.round(s.x), Math.round(s.y));
      p.g.zIndex = dynamicDepth(this.statics, { x0: pos.x - 0.2, y0: pos.y - 0.2, x1: pos.x + 0.2, y1: pos.y + 0.2, h: 18 });
    }
    for (const v of this.buildings) {
      if (!v.bangAt) continue;
      const hop = still ? 0 : Math.round(Math.abs(Math.sin(nowMs / 220)) * 4);
      v.bang.position.set(v.bangAt.x, v.bangAt.y - hop);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
