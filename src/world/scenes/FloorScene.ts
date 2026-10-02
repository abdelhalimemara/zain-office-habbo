import { ColorMatrixFilter, Container, Graphics } from "pixi.js";
import type { DivisionId } from "../../../shared/divisions";
import { avatarHeight, avatarsReady } from "../avatarSetup";
import { VoxelAvatar, specFor } from "../avatars";
import { EmoteDirector } from "../behavior";
import { spriteFor, type SpriteKey } from "../characters";
import type { AgentDiff } from "../diff";
import { drawItem, drawRug } from "../draw/furniture";
import { STATUS_COLORS, buildPill, clearChildren, fontsReady, type PillItem } from "../draw/pills";
import { drawBackWalls, drawFloorBase, drawWall } from "../draw/surfaces";
import { PERSON_H, fitBounds, planBounds, rankStatics } from "../plan/boxes";
import { hashString as hashSeed } from "../hash";
import { dynamicDepth, toScreen, type Ranked, type Rect } from "../iso";
import { PAGE_BACKGROUND, PAL } from "../palette";
import { PersonBrain, restingSpot } from "../people";
import { floorPlan, type FloorPlan } from "../plan";
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
interface Person {
  agent: WorldAgent;
  brain: PersonBrain;
  body: Container;
  ring: Graphics;
  avatar: VoxelAvatar | null;
  spriteKey: SpriteKey | null;
  director: EmoteDirector;
  /** Time since the avatar's frames were last advanced (updates are capped). */
  pendingMs: number;
  seated: boolean;
  status: Container;
  name: Container;
  statusH: number;
  statusW: number;
  nameH: number;
  nameW: number;
  head: { x: number; y: number };
  widthImg: number;
}

const CACHE_RES = 2;
/** Avatar frame updates at most every this many ms (30 fps); positions still move every frame. */
const AVATAR_STEP_MS = 33;

export class FloorScene implements Scene {
  readonly root = new Container();
  readonly screen = new Container();
  readonly style = "smooth" as const;
  readonly background = PAGE_BACKGROUND;
  readonly floor: FloorPlan;
  private readonly objects = new Container();
  private readonly plates = new Container();
  private statics: Ranked[] = [];
  private readonly persons = new Map<string, Person>();
  private readonly claims = new Set<string>();
  private readonly vacantFilter = new ColorMatrixFilter();
  private viewport: SceneViewport | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private reducedMotion: boolean;
  private destroyed = false;

  constructor(
    readonly division: DivisionId,
    opts: SceneOptions,
  ) {
    this.reducedMotion = opts.reducedMotion;
    this.floor = floorPlan(division);
    this.vacantFilter.desaturate();
    this.objects.sortableChildren = true;
    this.screen.sortableChildren = true;
    this.root.addChild(this.buildBase(), this.objects);
    this.buildStatics();
    this.screen.addChild(this.plates);
    if (opts.debugHotspots) this.root.addChild(drawFloorDebug(this.floor));
    this.buildPlates();
    void fontsReady().then(() => {
      if (this.destroyed) return;
      this.buildPlates();
      for (const p of this.persons.values()) this.refreshPills(p);
    });
  }

  private buildBase(): Container {
    const g = new Graphics();
    drawFloorBase(g, this.floor);
    for (const it of this.floor.items) if (it.kind === "rug") drawRug(g, it);
    drawBackWalls(g, this.floor);
    g.cacheAsTexture({ resolution: CACHE_RES, antialias: true });
    return g;
  }

  /** Furniture and interior walls: each cached once, depth-ranked together so people can stand between them. */
  private buildStatics(): void {
    for (const st of rankStatics(this.floor)) {
      let c: Container;
      if (st.kind === "item") c = drawItem(st.item);
      else {
        const g = new Graphics();
        drawWall(g, st.wall);
        c = g;
      }
      c.zIndex = st.depth;
      c.cacheAsTexture({ resolution: CACHE_RES, antialias: true });
      this.objects.addChild(c);
      this.statics.push({ box: st.box, depth: st.depth });
    }
  }

  private buildPlates(): void {
    clearChildren(this.plates);
    const res = Math.max(2, Math.ceil(this.viewport?.dpr ?? 1) * 2);
    for (const p of this.floor.plates) {
      const c = new Container();
      buildPill(c, [{ text: p.text, weight: "600" }], res, 10);
      c.label = `${p.x},${p.y}`;
      this.plates.addChild(c);
    }
    this.placePlates();
  }

  private placePlates(): void {
    const v = this.viewport;
    if (!v) return;
    this.floor.plates.forEach((p, i) => {
      const c = this.plates.children[i];
      if (!c) return;
      const s = toScreen(p.x, p.y);
      const x = (v.x + s.x * v.scale) / v.dpr;
      const y = (v.y + s.y * v.scale) / v.dpr;
      const half = c.width / 2;
      c.visible = x - half >= v.area.x && x + half <= v.area.x + v.area.w && y >= v.area.y && y <= v.area.y + v.area.h;
      c.position.set(Math.round(x), Math.round(y));
    });
  }

  /** The whole floor, or a readable crop of it when the visible area is small (the user pans to the rest). */
  bounds(area?: Rect): Rect {
    return fitBounds(planBounds(this.floor), area);
  }

  setViewport(viewport: SceneViewport): void {
    const rebuild = viewport.dpr !== this.viewport?.dpr;
    this.viewport = viewport;
    this.screen.scale.set(viewport.dpr);
    if (rebuild) {
      for (const p of this.persons.values()) this.refreshPills(p);
      this.buildPlates();
    }
    this.placePlates();
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
    this.objects.addChild(body);
    const person: Person = {
      agent,
      brain: new PersonBrain(this.floor, agent, this.reducedMotion, this.claims),
      body,
      ring,
      avatar: null,
      spriteKey: null,
      director: new EmoteDirector(hashSeed(agent.profile)),
      pendingMs: 0,
      seated: false,
      status,
      name,
      statusH: 0,
      statusW: 0,
      nameH: 0,
      nameW: 0,
      head: { x: 0, y: 0 },
      widthImg: PERSON_H * 0.36,
    };
    this.persons.set(agent.profile, person);
    this.applyAvatar(person);
    this.refreshPills(person);
    this.drawRing(person);
  }

  private updatePerson(person: Person, agent: WorldAgent): void {
    person.agent = agent;
    person.brain.setAgent(agent);
    this.applyAvatar(person);
    this.refreshPills(person);
  }

  private applyAvatar(person: Person): void {
    const key = spriteFor(person.agent.profile, person.agent.rank);
    if (key !== person.spriteKey) {
      person.spriteKey = key;
      void avatarsReady().then(() => {
        if (this.destroyed || person.spriteKey !== key || !this.persons.has(person.agent.profile)) return;
        person.avatar?.destroy();
        const pose = person.brain.pose();
        const avatar = new VoxelAvatar(specFor(key), {
          height: avatarHeight(key, PERSON_H),
          facing: pose.facing,
          pose: pose.pose,
          reducedMotion: this.reducedMotion,
        });
        person.avatar = avatar;
        person.widthImg = PERSON_H * 0.34;
        person.body.addChild(avatar);
        this.styleAvatar(person);
      });
    }
    this.styleAvatar(person);
  }

  private styleAvatar(person: Person): void {
    const a = person.avatar;
    if (!a) return;
    const vacant = !person.agent.hired;
    a.alpha = vacant ? VACANT_ALPHA : 1;
    a.filters = vacant ? [this.vacantFilter] : [];
  }

  private drawRing(person: Person): void {
    const g = person.ring;
    g.clear();
    g.ellipse(0, 0, PERSON_H * 0.17, PERSON_H * 0.075).fill({ color: 0x1a140e, alpha: 0.18 });
    if (this.selected !== person.agent.profile) return;
    const rx = PERSON_H * 0.3;
    const ry = rx * 0.5;
    g.ellipse(0, 0, rx, ry).fill({ color: PAL.gold, alpha: 0.18 });
    g.ellipse(0, 0, rx, ry).stroke({ color: PAL.goldSoft, width: 2, alpha: 0.9 });
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
    p.brain.release();
    p.body.destroy({ children: true });
    p.status.destroy({ children: true });
    p.name.destroy({ children: true });
    this.persons.delete(profile);
    if (this.hovered === profile) this.hovered = null;
  }

  hitTest(x: number, y: number): Hit | null {
    let best: { profile: string; z: number } | null = null;
    for (const p of this.persons.values()) {
      const half = Math.max(p.widthImg / 2, PERSON_H * 0.16);
      const top = p.head.y - 2;
      const bottom = p.body.y + PERSON_H * 0.06;
      if (x >= p.body.x - half && x <= p.body.x + half && y >= top && y <= bottom && (!best || p.body.zIndex > best.z)) {
        best = { profile: p.agent.profile, z: p.body.zIndex };
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
    for (const p of this.persons.values()) {
      p.brain.setReducedMotion(reduced);
      p.avatar?.setReducedMotion(reduced);
    }
  }

  update(dtMs: number, _nowMs: number): void {
    for (const p of this.persons.values()) {
      p.brain.tick(dtMs);
      const pose = p.brain.pose();
      const a = p.avatar;
      const off = pose.seated && a ? a.seatOffset : { x: 0, y: 0 };
      p.body.position.set(pose.x - off.x, pose.y - off.y);
      p.body.zIndex = dynamicDepth(this.statics, pose.sort);
      p.seated = pose.seated;
      const headY = a ? a.headTop.y : -PERSON_H;
      p.head = { x: p.body.x, y: p.body.y + (pose.seated ? headY * 0.8 : headY) };
      if (!a) continue;
      a.setFacing(pose.facing);
      a.setPose(pose.pose);
      const emote = p.director.next(
        {
          activity: p.agent.activity,
          hired: p.agent.hired,
          selected: this.selected === p.agent.profile,
          walking: pose.mode === "walking",
          restingMs: p.brain.restingMs,
          current: a.emote,
        },
        dtMs,
      );
      if (emote !== null) a.setEmote(emote);
      p.pendingMs += dtMs;
      if (p.pendingMs >= AVATAR_STEP_MS) {
        a.update(p.pendingMs);
        p.pendingMs = 0;
      }
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
