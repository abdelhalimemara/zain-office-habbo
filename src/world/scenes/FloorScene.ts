import { Assets, ColorMatrixFilter, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { DivisionId } from "../../../shared/divisions";
import { FLOOR_URLS, SPRITE_URLS } from "../assets/floorAssets";
import { spriteFor, type SpriteKey } from "../characters";
import type { AgentDiff } from "../diff";
import { STATUS_COLORS, buildPill, clearChildren, fontsReady, type PillItem } from "../draw/pills";
import type { Rect } from "../iso";
import { floorBounds, floorImage, type FloorImage } from "../layouts/floorImages";
import { PAGE_BACKGROUND, PAL } from "../palette";
import { PersonBrain } from "../people";
import { restingSpot } from "../routes";
import { assignSeats, rosterOrder } from "../seating";
import type { Hit, WorldAgent, WorldStats } from "../types";
import { drawFloorDebug } from "./floorDebug";
import type { Scene, SceneOptions, SceneViewport } from "./Scene";

const ACTIVITY: Record<WorldAgent["activity"], { label: string; color: number }> = {
  working: { label: "Working", color: STATUS_COLORS.working },
  blocked: { label: "Blocked", color: STATUS_COLORS.blocked },
  "awaiting-approval": { label: "Awaiting HQ", color: STATUS_COLORS.awaiting },
  queued: { label: "Queued", color: STATUS_COLORS.queued },
  idle: { label: "Idle", color: STATUS_COLORS.queued },
};

const VACANT_ALPHA = 0.5;
const PILL_GAP = 4;
const NARROW_FLOOR = 640;

interface Person {
  agent: WorldAgent;
  brain: PersonBrain;
  body: Container;
  ring: Graphics;
  sprite: Sprite | null;
  spriteKey: SpriteKey | null;
  status: Container;
  name: Container;
  statusH: number;
  statusW: number;
  nameH: number;
  nameW: number;
  head: { x: number; y: number };
  widthImg: number;
}

function loadTexture(url: string, mipmaps: boolean): Promise<Texture> {
  return Assets.load<Texture>({
    src: url,
    data: { alphaMode: "premultiply-alpha-on-upload", scaleMode: "linear", autoGenerateMipmaps: mipmaps },
  }).then((t) => {
    t.source.scaleMode = "linear";
    if (mipmaps) {
      t.source.autoGenerateMipmaps = true;
      t.source.updateMipmaps();
    }
    return t;
  });
}

export class FloorScene implements Scene {
  readonly root = new Container();
  readonly screen = new Container();
  readonly style = "smooth" as const;
  readonly background = PAGE_BACKGROUND;
  readonly floor: FloorImage;
  private readonly people = new Container();
  private readonly persons = new Map<string, Person>();
  private readonly vacantFilter = new ColorMatrixFilter();
  private viewport: SceneViewport | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private reducedMotion: boolean;
  private destroyed = false;
  private now = 0;

  constructor(
    readonly division: DivisionId,
    opts: SceneOptions,
  ) {
    this.reducedMotion = opts.reducedMotion;
    this.floor = floorImage(division);
    this.vacantFilter.desaturate();
    this.people.sortableChildren = true;
    this.screen.sortableChildren = true;
    this.root.addChild(this.people);
    if (opts.debugHotspots) this.root.addChild(drawFloorDebug(this.floor));
    void this.loadFloor();
    void fontsReady().then(() => {
      if (!this.destroyed) for (const p of this.persons.values()) this.refreshPills(p);
    });
  }

  private async loadFloor(): Promise<void> {
    const texture = await loadTexture(FLOOR_URLS[this.division], false);
    if (this.destroyed) return;
    this.root.addChildAt(new Sprite(texture), 0);
  }

  /** Phones fit the middle half of the floor (readable people and pills) and pan to the sides. */
  bounds(area?: Rect): Rect {
    const full = floorBounds(this.floor);
    if (!area || area.w >= NARROW_FLOOR) return full;
    return { x: full.w / 4, y: 0, w: full.w / 2, h: full.h };
  }

  setViewport(viewport: SceneViewport): void {
    const rebuild = viewport.dpr !== this.viewport?.dpr;
    this.viewport = viewport;
    this.screen.scale.set(viewport.dpr);
    if (rebuild) for (const p of this.persons.values()) this.refreshPills(p);
    this.placeOverlays();
  }

  setAgents(all: ReadonlyMap<string, WorldAgent>, diff: AgentDiff): void {
    for (const profile of diff.removed) this.drop(profile);
    const mine = [...all.values()].filter((a) => a.division === this.division);
    for (const profile of [...this.persons.keys()]) if (!mine.some((a) => a.profile === profile)) this.drop(profile);
    const changed = new Set([...diff.added, ...diff.updated].map((a) => a.profile));
    for (const agent of mine) {
      const existing = this.persons.get(agent.profile);
      if (!existing) this.add(agent);
      else if (changed.has(agent.profile)) this.updatePerson(existing, agent);
    }
    const { seats } = assignSeats(this.floor, mine);
    rosterOrder(mine).forEach((a, i) => {
      this.persons.get(a.profile)?.brain.assign(seats.get(a.profile) ?? null, restingSpot(this.floor, i));
    });
  }

  private add(agent: WorldAgent): void {
    const body = new Container();
    const ring = new Graphics();
    body.addChild(ring);
    const status = new Container();
    const name = new Container();
    this.screen.addChild(status, name);
    this.people.addChild(body);
    const person: Person = {
      agent,
      brain: new PersonBrain(this.floor, agent, this.reducedMotion),
      body,
      ring,
      sprite: null,
      spriteKey: null,
      status,
      name,
      statusH: 0,
      statusW: 0,
      nameH: 0,
      nameW: 0,
      head: { x: 0, y: 0 },
      widthImg: this.floor.personHeight * 0.36,
    };
    this.persons.set(agent.profile, person);
    this.applySprite(person);
    this.refreshPills(person);
    this.drawRing(person);
  }

  private updatePerson(person: Person, agent: WorldAgent): void {
    person.agent = agent;
    person.brain.setAgent(agent);
    this.applySprite(person);
    this.refreshPills(person);
  }

  private applySprite(person: Person): void {
    const key = spriteFor(person.agent.profile, person.agent.rank);
    if (key !== person.spriteKey) {
      person.spriteKey = key;
      void loadTexture(SPRITE_URLS[key], true).then((texture) => {
        if (this.destroyed || person.spriteKey !== key || !this.persons.has(person.agent.profile)) return;
        person.sprite?.destroy();
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);
        const k = this.floor.personHeight / texture.height;
        sprite.scale.set(k);
        person.widthImg = texture.width * k;
        person.sprite = sprite;
        person.body.addChild(sprite);
        this.styleSprite(person);
      });
    }
    this.styleSprite(person);
  }

  private styleSprite(person: Person): void {
    const s = person.sprite;
    if (!s) return;
    const vacant = !person.agent.hired;
    s.alpha = vacant ? VACANT_ALPHA : 1;
    s.filters = vacant ? [this.vacantFilter] : [];
  }

  private drawRing(person: Person): void {
    const g = person.ring;
    g.clear();
    if (this.selected !== person.agent.profile) return;
    const rx = this.floor.personHeight * 0.3;
    const ry = rx * 0.42;
    g.ellipse(0, 0, rx, ry).fill({ color: PAL.gold, alpha: 0.18 });
    g.ellipse(0, 0, rx, ry).stroke({ color: PAL.goldSoft, width: Math.max(1.5, this.floor.personHeight * 0.03), alpha: 0.9 });
  }

  private refreshPills(person: Person): void {
    const res = Math.max(2, Math.ceil(this.viewport?.dpr ?? 1) * 2);
    clearChildren(person.status);
    clearChildren(person.name);
    const a = person.agent;
    const showStatus = a.hired && (a.activity === "blocked" || a.activity === "awaiting-approval" || a.activity === "queued");
    person.statusH = 0;
    person.statusW = 0;
    if (showStatus) {
      const s = ACTIVITY[a.activity];
      const size = buildPill(person.status, [{ dot: s.color, text: s.label }], res, 11);
      person.statusH = size.h;
      person.statusW = size.w;
    }
    person.nameH = 0;
    person.nameW = 0;
    const showName = this.hovered === a.profile || this.selected === a.profile;
    if (showName) {
      const items: PillItem[] = [{ text: a.title, weight: "700" }];
      if (!a.hired) items.push({ text: "Vacant", weight: "500" });
      else if (!showStatus) items.push({ dot: ACTIVITY[a.activity].color, text: a.bubble ?? ACTIVITY[a.activity].label, weight: "500" });
      const size = buildPill(person.name, items, res, 12);
      person.nameH = size.h;
      person.nameW = size.w;
    }
    this.placeOverlays();
  }

  private drop(profile: string): void {
    const p = this.persons.get(profile);
    if (!p) return;
    p.body.destroy({ children: true });
    p.status.destroy({ children: true });
    p.name.destroy({ children: true });
    this.persons.delete(profile);
    if (this.hovered === profile) this.hovered = null;
  }

  hitTest(x: number, y: number): Hit | null {
    let best: { profile: string; y: number } | null = null;
    const h = this.floor.personHeight;
    for (const p of this.persons.values()) {
      const pose = p.brain.pose(this.now);
      const half = Math.max(p.widthImg / 2, h * 0.16);
      if (x >= pose.x - half && x <= pose.x + half && y >= pose.y - h && y <= pose.y + h * 0.08 && (!best || pose.y > best.y)) {
        best = { profile: p.agent.profile, y: pose.y };
      }
    }
    return best ? { kind: "agent", profile: best.profile } : null;
  }

  setHover(hit: Hit | null): void {
    const next = hit?.kind === "agent" ? hit.profile : null;
    if (next === this.hovered) return;
    const prev = this.hovered;
    this.hovered = next;
    for (const id of [prev, next]) {
      const p = id ? this.persons.get(id) : undefined;
      if (p) this.refreshPills(p);
    }
  }

  setSelected(profile: string | null): void {
    const prev = this.selected;
    this.selected = profile;
    for (const id of [prev, profile]) {
      const p = id ? this.persons.get(id) : undefined;
      if (p) {
        this.drawRing(p);
        this.refreshPills(p);
      }
    }
  }

  setStats(_stats: Partial<WorldStats> | null): void {}

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    for (const p of this.persons.values()) p.brain.setReducedMotion(reduced);
  }

  update(dtMs: number, nowMs: number): void {
    this.now = nowMs;
    for (const p of this.persons.values()) {
      p.brain.tick(dtMs);
      const pose = p.brain.pose(nowMs);
      p.body.position.set(pose.x, pose.y);
      p.body.zIndex = pose.y;
      if (p.sprite) {
        p.sprite.y = pose.bob;
        p.sprite.scale.x = Math.abs(p.sprite.scale.x) * (pose.mirror ? -1 : 1);
      }
      p.head = { x: pose.x, y: pose.y + pose.bob - this.floor.personHeight };
    }
    this.placeOverlays();
  }

  private placeOverlays(): void {
    const v = this.viewport;
    if (!v) return;
    const blocks = [...this.persons.values()]
      .filter((p) => p.statusH > 0 || p.nameH > 0)
      .map((p) => {
        const x = (v.x + p.head.x * v.scale) / v.dpr;
        const bottom = (v.y + p.head.y * v.scale) / v.dpr - PILL_GAP;
        const h = p.statusH + p.nameH + (p.statusH && p.nameH ? PILL_GAP : 0);
        return { p, x, bottom, w: Math.max(p.statusW, p.nameW), h };
      })
      .sort((a, b) => b.bottom - a.bottom || a.x - b.x);
    const placed: { x: number; bottom: number; w: number; h: number }[] = [];
    for (const b of blocks) {
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find((o) => Math.abs(o.x - b.x) < (o.w + b.w) / 2 + 2 && b.bottom > o.bottom - o.h - 2 && b.bottom - b.h < o.bottom + 2);
        if (!hit) break;
        b.bottom = hit.bottom - hit.h - PILL_GAP;
      }
      placed.push(b);
      const half = b.w / 2 + 4;
      const onScreen = b.x >= v.area.x && b.x <= v.area.x + v.area.w;
      b.p.status.visible = onScreen;
      b.p.name.visible = onScreen;
      const x = Math.round(Math.max(v.area.x + half, Math.min(v.area.x + v.area.w - half, b.x)));
      b.p.status.position.set(x, Math.round(b.bottom));
      b.p.name.position.set(x, Math.round(b.bottom - (b.p.statusH ? b.p.statusH + PILL_GAP : 0)));
      const front = this.hovered === b.p.agent.profile || this.selected === b.p.agent.profile;
      b.p.status.zIndex = front ? 3 : 1;
      b.p.name.zIndex = front ? 4 : 2;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.persons.clear();
    this.screen.destroy({ children: true });
    this.root.destroy({ children: true });
    this.vacantFilter.destroy();
  }
}
