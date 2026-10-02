import { Application, TextureSource, type Ticker } from "pixi.js";
import type { DivisionId } from "../../shared/divisions";
import type { DivisionStats } from "../../shared/flow";
import {
  NO_INSETS,
  clampPan,
  clampScale,
  fitScale,
  fitSmooth,
  lerpCamera,
  normalizeInsets,
  panFor,
  sameInsets,
  stepSmooth,
  stepZoom,
  visibleArea,
  zoomAround,
  type CameraState,
  type Insets,
} from "./camera";
import { clearAvatarCache, setAvatarRenderer } from "./avatars";
import { diffAgents } from "./diff";
import { PAL, cssColor } from "./palette";
import { CityScene } from "./scenes/CityScene";
import { FloorScene } from "./scenes/FloorScene";
import { cursorFor, sameHit, type Scene } from "./scenes/Scene";
import type { Hit, WorldAgent, WorldCallbacks, WorldStats, WorldView } from "./types";

const CLICK_SLOP = 5;
const REFIT_MS = 320;

export interface WorldOptions {
  insets?: Partial<Insets>;
  /** Dev aid: outline the city hotspots. */
  debugHotspots?: boolean;
}

interface Tween {
  from: CameraState;
  to: CameraState;
  elapsed: number;
}

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export class World {
  private readonly app = new Application();
  private readonly host = document.createElement("div");
  private scene: Scene | null = null;
  private view: WorldView = { kind: "city" };
  private agents = new Map<string, WorldAgent>();
  private stats: Partial<WorldStats> | null = null;
  private selected: string | null = null;
  private scale = 2;
  private pan = { x: 0, y: 0 };
  private hover: Hit | null = null;
  private readonly pointers = new Map<number, PointerState>();
  private dragged = false;
  private pinchDist = 0;
  private resizeObserver: ResizeObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private reducedMotion = false;
  private destroyed = false;
  private now = 0;
  private insets: Insets = NO_INSETS;
  private tween: Tween | null = null;
  private fitted = 1;
  private debugHotspots = false;

  private constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: WorldCallbacks,
  ) {}

  static async create(container: HTMLElement, callbacks: WorldCallbacks, options: WorldOptions = {}): Promise<World> {
    const world = new World(container, callbacks);
    world.insets = normalizeInsets(options.insets);
    world.debugHotspots = !!options.debugHotspots;
    try {
      await world.init();
    } catch (err) {
      world.destroy();
      throw err;
    }
    return world;
  }

  private async init(): Promise<void> {
    TextureSource.defaultOptions.scaleMode = "nearest";
    Object.assign(this.host.style, { position: "absolute", inset: "0", overflow: "hidden", touchAction: "none", background: cssColor(PAL.page) });
    if (getComputedStyle(this.container).position === "static") this.container.style.position = "relative";
    this.container.appendChild(this.host);
    await this.app.init({
      width: 64,
      height: 64,
      background: PAL.page,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      roundPixels: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy({ removeView: true }, { children: true });
      return;
    }
    setAvatarRenderer(this.app.renderer);
    const canvas = this.app.canvas;
    Object.assign(canvas.style, { display: "block", position: "absolute", left: "0", top: "0" });
    this.host.appendChild(canvas);
    this.app.stage.eventMode = "none";

    this.motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.reducedMotion = !!this.motionQuery?.matches;
    this.motionQuery?.addEventListener("change", this.onMotionChange);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.fit(false));
    this.resizeObserver.observe(this.host);
    this.app.ticker.add(this.onTick);
    this.mountScene();
  }

  setView(view: WorldView): void {
    if (view.kind === this.view.kind && (view.kind === "city" || (this.view.kind === "floor" && this.view.division === view.division))) return;
    this.view = view;
    this.mountScene();
  }

  setAgents(agents: WorldAgent[]): void {
    const diff = diffAgents(this.agents, agents);
    if (!diff.added.length && !diff.updated.length && !diff.removed.length) return;
    for (const p of diff.removed) this.agents.delete(p);
    for (const a of [...diff.added, ...diff.updated]) this.agents.set(a.profile, a);
    this.scene?.setAgents(this.agents, diff);
  }

  setDivisionStats(stats: Record<DivisionId, DivisionStats>): void {
    this.stats = stats;
    this.scene?.setStats(stats);
  }

  setSelectedAgent(profile: string | null): void {
    this.selected = profile;
    this.scene?.setSelected(profile);
  }

  /** Css-pixel rectangle (relative to the world's container) of a Tech team's pod, when a floor showing it is open. */
  teamZone(teamId: string): { x: number; y: number; w: number; h: number } | null {
    return this.scene instanceof FloorScene ? this.scene.teamZone(teamId) : null;
  }

  /** Css pixels of the canvas covered by overlay UI; the camera re-fits into the remaining area. */
  setInsets(insets: Partial<Insets>): void {
    const next = normalizeInsets(insets);
    if (sameInsets(next, this.insets)) return;
    this.insets = next;
    this.fit(true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    const canvas = (this.app.renderer as unknown) ? this.app.canvas : undefined;
    if (canvas) {
      canvas.removeEventListener("pointerdown", this.onPointerDown);
      canvas.removeEventListener("pointermove", this.onPointerMove);
      canvas.removeEventListener("pointerup", this.onPointerUp);
      canvas.removeEventListener("pointercancel", this.onPointerCancel);
      canvas.removeEventListener("pointerleave", this.onPointerLeave);
      canvas.removeEventListener("wheel", this.onWheel);
      this.app.ticker?.remove(this.onTick);
      this.scene?.destroy();
      this.scene = null;
      clearAvatarCache();
      setAvatarRenderer(null);
      try {
        this.app.destroy({ removeView: true }, { children: true });
      } catch {
        canvas.remove();
      }
    }
    this.host.remove();
  }

  private mountScene(): void {
    this.scene?.destroy();
    const opts = { reducedMotion: this.reducedMotion, debugHotspots: this.debugHotspots };
    const scene: Scene = this.view.kind === "city" ? new CityScene(opts) : new FloorScene(this.view.division, opts);
    this.scene = scene;
    this.hover = null;
    this.app.canvas.style.cursor = cursorFor(null);
    this.app.stage.addChild(scene.root);
    if (scene.screen) this.app.stage.addChild(scene.screen);
    this.applyBackground(scene);
    scene.setStats(this.stats);
    scene.setAgents(this.agents, { added: [...this.agents.values()], updated: [], removed: [] });
    scene.setSelected(this.selected);
    this.tween = null;
    this.fit(false);
  }

  /** Css colour behind the active scene, so surrounding UI can match it. */
  get background(): string {
    return cssColor(this.scene?.background ?? PAL.page);
  }

  private applyBackground(scene: Scene): void {
    const color = cssColor(scene.background);
    this.app.renderer.background.color = scene.background;
    this.host.style.background = color;
    this.app.canvas.style.imageRendering = scene.style === "pixel" ? "pixelated" : "auto";
    this.callbacks.onBackgroundChange?.(color);
  }

  private get smooth(): boolean {
    return this.scene?.style === "smooth";
  }

  /** Canvas pixels per scene pixel: 1 for pixel art (the browser upscales), the full scale for smooth scenes. */
  private get canvasScale(): number {
    return this.smooth ? this.scale : 1;
  }

  private get dpr(): number {
    return window.devicePixelRatio || 1;
  }

  private viewport(): { w: number; h: number } {
    return { w: Math.max(1, this.host.clientWidth), h: Math.max(1, this.host.clientHeight) };
  }

  private area() {
    const v = this.viewport();
    return visibleArea(v.w, v.h, this.insets);
  }

  private fit(animate: boolean): void {
    if (!this.scene || this.destroyed) return;
    const area = this.area();
    const b = this.scene.bounds(area);
    this.fitted = this.smooth ? fitSmooth(b, area, this.dpr) : fitScale(b, area, this.dpr);
    const target: CameraState = {
      scale: this.fitted,
      world: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      focus: { x: area.x + area.w / 2, y: area.y + area.h / 2 },
    };
    if (!animate || this.reducedMotion) {
      this.tween = null;
      this.applyCamera(target, true);
      return;
    }
    const k = this.dpr / this.scale;
    const from: CameraState = {
      scale: this.scale,
      focus: target.focus,
      world: { x: target.focus.x * k - this.pan.x, y: target.focus.y * k - this.pan.y },
    };
    this.tween = { from, to: target, elapsed: 0 };
  }

  private applyCamera(c: CameraState, clamp: boolean): void {
    this.scale = c.scale;
    this.resizeCanvas();
    this.pan = panFor(c, this.dpr);
    this.applyPan(clamp);
  }

  private resizeCanvas(): void {
    const { w, h } = this.viewport();
    const perCss = this.smooth ? this.dpr : this.dpr / this.scale;
    const bufW = Math.ceil(w * perCss);
    const bufH = Math.ceil(h * perCss);
    if (bufW !== this.app.renderer.width || bufH !== this.app.renderer.height) this.app.renderer.resize(bufW, bufH);
    const canvas = this.app.canvas;
    canvas.style.width = `${bufW / perCss}px`;
    canvas.style.height = `${bufH / perCss}px`;
  }

  private applyPan(clamp = true): void {
    if (!this.scene) return;
    const area = this.area();
    if (clamp) this.pan = clampPan(this.pan, this.scene.bounds(area), area, this.scale, this.dpr);
    const q = this.canvasScale;
    const x = Math.round(this.pan.x * q);
    const y = Math.round(this.pan.y * q);
    this.scene.root.scale.set(q);
    this.scene.root.position.set(x, y);
    this.scene.setViewport?.({ scale: q, x, y, dpr: this.dpr, area });
  }

  /** Scene-pixel offset of a pointer from the canvas origin. */
  private toArt(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const k = this.dpr / this.scale;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
  }

  private nextZoom(dir: 1 | -1): number {
    return this.smooth ? stepSmooth(this.scale, dir, this.fitted, this.dpr) : stepZoom(this.scale, dir);
  }

  private hitAt(e: { clientX: number; clientY: number }): Hit | null {
    const p = this.toArt(e);
    return this.scene?.hitTest(p.x - this.pan.x, p.y - this.pan.y) ?? null;
  }

  private setHover(hit: Hit | null): void {
    if (sameHit(hit, this.hover)) return;
    this.hover = hit;
    this.scene?.setHover(hit);
    this.app.canvas.style.cursor = cursorFor(hit);
  }

  private zoomTo(next: number, at: { x: number; y: number }): void {
    const to = this.smooth ? next : clampScale(next);
    this.tween = null;
    if (to === this.scale) return;
    this.pan = zoomAround(this.pan, at.x, at.y, this.scale, to);
    this.scale = to;
    this.resizeCanvas();
    this.applyPan();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.app.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    this.dragged = false;
    if (this.pointers.size === 2) this.pinchDist = this.pointerSpread();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") this.setHover(this.hitAt(e));
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > CLICK_SLOP) this.dragged = true;
    if (this.pointers.size === 2) {
      const dist = this.pointerSpread();
      if (this.pinchDist > 0 && (dist / this.pinchDist > 1.3 || dist / this.pinchDist < 0.77)) {
        this.zoomTo(this.nextZoom(dist > this.pinchDist ? 1 : -1), this.toArt(this.pointerCenter()));
        this.pinchDist = dist;
      }
      return;
    }
    if (!this.dragged) return;
    const k = this.dpr / this.scale;
    this.tween = null;
    this.pan = { x: this.pan.x + dx * k, y: this.pan.y + dy * k };
    this.app.canvas.style.cursor = cursorFor(null, true);
    this.applyPan();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const had = this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    if (had && !this.dragged) {
      const hit = this.hitAt(e);
      if (hit?.kind === "building") this.callbacks.onSelectBuilding(hit.division);
      else if (hit?.kind === "agent") this.callbacks.onSelectAgent(hit.profile);
      else if (hit?.kind === "team") this.callbacks.onSelectTeam?.(hit.team);
    }
    this.dragged = false;
    this.setHover(e.pointerType === "mouse" ? this.hitAt(e) : null);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.dragged = false;
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) this.setHover(null);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (Math.abs(e.deltaY) < 1) return;
    this.zoomTo(this.nextZoom(e.deltaY < 0 ? 1 : -1), this.toArt(e));
  };

  private readonly onMotionChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
    this.scene?.setReducedMotion(e.matches);
  };

  private readonly onTick = (ticker: Ticker): void => {
    const dt = Math.min(100, ticker.deltaMS);
    this.now += dt;
    if (this.tween) {
      this.tween.elapsed += dt;
      const t = this.tween.elapsed / REFIT_MS;
      const done = t >= 1;
      this.applyCamera(done ? this.tween.to : lerpCamera(this.tween.from, this.tween.to, t), done);
      if (done) this.tween = null;
    }
    this.scene?.update(dt, this.now);
  };

  private pointerSpread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pointerCenter(): { clientX: number; clientY: number } {
    const [a, b] = [...this.pointers.values()];
    return { clientX: ((a?.x ?? 0) + (b?.x ?? 0)) / 2, clientY: ((a?.y ?? 0) + (b?.y ?? 0)) / 2 };
  }
}
