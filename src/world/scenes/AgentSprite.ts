import { Container, Graphics } from "pixi.js";
import { appearanceFor, type Appearance } from "../appearance";
import { drawAvatar, type Pose } from "../draw/avatar";
import { drawScreen, monitorGeom } from "../draw/furniture";
import { drawBubble, drawFootRing, drawNameTag, drawSelectArrow, drawZzz } from "../draw/overlays";
import { diamond } from "../draw/primitives";
import { hashString, seededRandom } from "../hash";
import { dynamicDepth, toScreen, type Pt, type Ranked } from "../iso";
import { FACING_VEC, opposite, type Facing, type FloorLayout, type Seat } from "../layouts/types";
import { PAL } from "../palette";
import { findPath, wanderTarget } from "../pathing";
import type { WorldAgent } from "../types";

export interface AgentHost {
  readonly layout: FloorLayout;
  readonly statics: readonly Ranked[];
  readonly objects: Container;
  readonly overlay: Container;
  readonly reducedMotion: boolean;
  deskDepth(deskId: string): number;
}

type Mode = "seated" | "standing" | "walking";

const SPEED = 2.4;
const ACTIVITY_LABEL: Record<WorldAgent["activity"], string> = {
  working: "Working",
  blocked: "Blocked",
  "awaiting-approval": "Awaiting approval",
  queued: "Queued",
  idle: "Idle",
};

export class AgentSprite {
  readonly body = new Container();
  private readonly avatar = new Graphics();
  private readonly ring = new Graphics();
  private readonly glow = new Graphics();
  private readonly tags = new Container();
  private readonly bubble = new Graphics();
  private readonly zzz = new Graphics();
  private readonly nameTag = new Graphics();
  private readonly arrow = new Graphics();
  private look: Appearance;
  private pos: Pt = { x: 0, y: 0 };
  private placed = false;
  private mode: Mode = "standing";
  private path: Pt[] = [];
  private facing: Facing = "sw";
  private seat: Seat | null = null;
  private rest: Pt | null = null;
  private waitMs = 0;
  private clock = 0;
  private poseKey = "";
  private glowKey = "";
  private hovered = false;
  private selected = false;
  private readonly rand: () => number;
  private readonly phase: number;

  constructor(
    private readonly host: AgentHost,
    private agent: WorldAgent,
  ) {
    const h = hashString(agent.profile);
    this.rand = seededRandom(h);
    this.phase = (h % 1000) / 1000;
    this.look = appearanceFor(agent.profile, agent.division, agent.rank);
    this.ring.visible = false;
    this.body.addChild(this.ring, this.avatar);
    this.tags.addChild(this.zzz, this.bubble, this.nameTag, this.arrow);
    host.objects.addChild(this.body, this.glow);
    host.overlay.addChild(this.tags);
    this.refreshOverlays();
  }

  get profile(): string {
    return this.agent.profile;
  }

  get depth(): number {
    return this.body.zIndex;
  }

  update(agent: WorldAgent): void {
    const relook = agent.rank !== this.agent.rank || agent.division !== this.agent.division;
    const retarget = agent.activity !== this.agent.activity || agent.hired !== this.agent.hired;
    this.agent = agent;
    if (relook) {
      this.look = appearanceFor(agent.profile, agent.division, agent.rank);
      this.poseKey = "";
    }
    this.refreshOverlays();
    if (retarget) this.retarget();
  }

  assign(seat: Seat | null, rest: Pt | null): void {
    const changed = seat?.id !== this.seat?.id || rest?.x !== this.rest?.x || rest?.y !== this.rest?.y;
    this.seat = seat;
    this.rest = rest;
    if (changed || !this.placed) this.retarget();
  }

  setHover(on: boolean): void {
    if (on === this.hovered) return;
    this.hovered = on;
    this.refreshOverlays();
  }

  setSelected(on: boolean): void {
    if (on === this.selected) return;
    this.selected = on;
    this.refreshOverlays();
  }

  hitRect(): { x: number; y: number; w: number; h: number } {
    const s = this.screenPos();
    const top = this.mode === "seated" ? 32 : 37;
    return { x: s.x - 8, y: s.y - top, w: 16, h: top + 3 };
  }

  private wantsSeat(): boolean {
    return !!this.seat && (!this.agent.hired || this.agent.activity !== "idle");
  }

  private retarget(): void {
    const dest = this.wantsSeat() ? this.seat : this.rest;
    if (!dest) return;
    const here = { x: Math.round(this.pos.x), y: Math.round(this.pos.y) };
    const path = this.placed && !this.host.reducedMotion ? findPath(this.host.layout, here, dest) : null;
    if (!path || path.length < 2) {
      this.pos = { x: dest.x, y: dest.y };
      this.placed = true;
      this.path = [];
      this.arrive();
      return;
    }
    this.path = path.slice(1);
    this.mode = "walking";
    this.updateDepth();
  }

  private arrive(): void {
    const seated = this.wantsSeat() && this.seat && this.pos.x === this.seat.x && this.pos.y === this.seat.y;
    if (seated && this.seat) {
      this.mode = "seated";
      this.facing = this.seat.facing;
    } else {
      this.mode = "standing";
      this.facing = this.rand() < 0.5 ? "sw" : "se";
      this.waitMs = 2500 + this.rand() * 6000;
    }
    this.updateDepth();
    this.place();
  }

  tick(dtMs: number, nowMs: number): void {
    this.clock += dtMs;
    if (this.mode === "walking") this.walk(dtMs);
    else if (this.mode === "standing" && !this.wantsSeat() && this.agent.activity === "idle" && !this.host.reducedMotion) {
      this.waitMs -= dtMs;
      if (this.waitMs <= 0) this.wander();
    }
    this.redraw(nowMs);
  }

  private wander(): void {
    const here = { x: Math.round(this.pos.x), y: Math.round(this.pos.y) };
    const target = wanderTarget(this.host.layout, this.rand, here);
    const path = target ? findPath(this.host.layout, here, target) : null;
    if (path && path.length > 1 && path.length < 14) {
      this.path = path.slice(1);
      this.mode = "walking";
    } else {
      this.waitMs = 2000 + this.rand() * 3000;
    }
  }

  private walk(dtMs: number): void {
    let budget = (SPEED * dtMs) / 1000;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0]!;
      const dx = next.x - this.pos.x;
      const dy = next.y - this.pos.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dx !== 0 || dy !== 0) this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "se" : "nw") : dy > 0 ? "sw" : "ne";
      if (dist <= budget) {
        this.pos = { x: next.x, y: next.y };
        this.path.shift();
        budget -= dist;
      } else {
        this.pos = { x: this.pos.x + (dx / dist) * budget, y: this.pos.y + (dy / dist) * budget };
        budget = 0;
      }
    }
    this.updateDepth();
    if (this.path.length === 0) this.arrive();
  }

  private updateDepth(): void {
    const { x, y } = this.pos;
    this.body.zIndex = dynamicDepth(this.host.statics, { x0: x + 0.2, y0: y + 0.2, x1: x + 0.8, y1: y + 0.8, h: 36 });
    if (this.seat) this.glow.zIndex = this.host.deskDepth(this.seat.desk) + 0.05;
  }

  private screenPos(): Pt {
    const s = toScreen(this.pos.x + 0.5, this.pos.y + 0.5);
    return { x: Math.round(s.x), y: Math.round(s.y) };
  }

  private place(): void {
    const s = this.screenPos();
    this.body.position.set(s.x, s.y);
    this.tags.position.set(s.x, s.y);
  }

  private redraw(nowMs: number): void {
    const still = this.host.reducedMotion;
    const working = this.mode === "seated" && this.agent.activity === "working" && this.agent.hired;
    const walking = this.mode === "walking";
    const frame = still ? 0 : Math.floor(this.clock / (walking ? 140 : 220)) % 4;
    const pose: Pose = {
      back: this.facing === "ne" || this.facing === "nw",
      sitting: this.mode === "seated",
      frame,
      walking,
      typing: working && !still,
    };
    const key = `${pose.back}|${pose.sitting}|${pose.frame}|${pose.walking}|${pose.typing}`;
    if (key !== this.poseKey) {
      this.poseKey = key;
      this.avatar.clear();
      drawAvatar(this.avatar, this.look, pose);
      this.avatar.scale.x = this.facing === "sw" || this.facing === "nw" ? -1 : 1;
    }
    this.body.alpha = this.agent.hired ? 1 : 0.38;
    if (walking) this.place();
    this.drawGlow(working, still ? 0 : Math.floor(nowMs / 450) % 2);
    const idle = this.agent.hired && this.agent.activity === "idle" && this.mode !== "walking";
    const cycle = ((nowMs / 1000 + this.phase * 6) % 6) / 6;
    this.zzz.visible = idle && (still || cycle < 0.45);
    if (this.zzz.visible) {
      const rise = still ? 0 : Math.round(cycle * 14);
      this.zzz.position.set(6, this.headTop() - 6 - rise);
      this.zzz.alpha = still ? 0.9 : 1 - cycle;
    }
    if (this.arrow.visible) {
      const bounce = still ? 0 : Math.round(Math.abs(Math.sin(nowMs / 180)) * 3);
      this.arrow.position.set(0, this.headTop() - (this.bubble.visible ? 22 : 6) - bounce);
    }
    this.bubble.position.set(0, this.headTop() - 1);
  }

  private headTop(): number {
    return this.mode === "seated" ? -31 : -36;
  }

  private drawGlow(on: boolean, flicker: number): void {
    const key = on && this.seat ? `${this.seat.id}|${flicker}` : "";
    if (key === this.glowKey) return;
    this.glowKey = key;
    this.glow.clear();
    if (!on || !this.seat) return;
    const v = FACING_VEC[this.seat.facing];
    const m = monitorGeom(this.seat.x + v.dx, this.seat.y + v.dy, opposite(this.seat.facing));
    if (m.visible) {
      drawScreen(this.glow, m, PAL.screenOn);
      const lines = flicker ? [0.2, 0.45, 0.6] : [0.3, 0.5, 0.75];
      for (const t of lines) {
        const z = m.z0 + 2 + t * (m.z1 - m.z0 - 4);
        if (m.dir === "sw") diamond(this.glow, m.x0 + 0.12, m.y1, m.x0 + 0.12 + t * 0.4, m.y1 + 0.01, z, 0x1f6e8c);
        else diamond(this.glow, m.x1, m.y0 + 0.12, m.x1 + 0.01, m.y0 + 0.12 + t * 0.4, z, 0x1f6e8c);
      }
    } else {
      const s = toScreen((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, m.z1 + 1);
      this.glow.ellipse(Math.round(s.x), Math.round(s.y) + 6, 9, 7).fill({ color: PAL.screenOn, alpha: flicker ? 0.22 : 0.3 });
      this.glow.rect(Math.round(s.x) - 4, Math.round(s.y) - 1, 9, 1).fill({ color: PAL.screenOn, alpha: 0.9 });
    }
  }

  private refreshOverlays(): void {
    const a = this.agent;
    this.bubble.clear();
    const kind = a.hired && a.activity !== "working" && a.activity !== "idle" ? a.activity : null;
    if (kind) drawBubble(this.bubble, kind);
    this.bubble.visible = !!kind;
    this.zzz.clear();
    drawZzz(this.zzz);
    this.nameTag.clear();
    const showTag = this.hovered || this.selected;
    if (showTag) {
      const sub = !a.hired ? "Vacant desk" : (a.bubble ?? ACTIVITY_LABEL[a.activity]);
      drawNameTag(this.nameTag, a.title, sub);
      this.nameTag.position.set(0, 22);
    }
    this.nameTag.visible = showTag;
    this.arrow.clear();
    drawSelectArrow(this.arrow);
    this.arrow.visible = this.selected;
    this.ring.clear();
    drawFootRing(this.ring, this.selected ? PAL.yellow : PAL.white);
    this.ring.visible = showTag;
    this.tags.zIndex = this.selected ? 2 : this.hovered ? 1 : 0;
  }

  destroy(): void {
    this.body.destroy({ children: true });
    this.glow.destroy();
    this.tags.destroy({ children: true });
  }
}
