import { Application, TextureSource, type Ticker } from "pixi.js";
import type { DivisionId } from "../../shared/divisions";
import type { DivisionStats } from "../../shared/flow";
import { clampPan, clampScale, centerOn, fitScale, zoomAround } from "./camera";
import { diffAgents } from "./diff";
import { PAL } from "./palette";
import { CityScene } from "./scenes/CityScene";
import { FloorScene } from "./scenes/FloorScene";
import { sameHit, type Scene } from "./scenes/Scene";
import type { Hit, WorldAgent, WorldCallbacks, WorldStats, WorldView } from "./types";

const CLICK_SLOP = 5;

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

  private constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: WorldCallbacks,
  ) {}

  static async create(container: HTMLElement, callbacks: WorldCallbacks): Promise<World> {
    const world = new World(container, callbacks);
    await world.init();
    return world;
  }

  private async init(): Promise<void> {
    TextureSource.defaultOptions.scaleMode = "nearest";
    Object.assign(this.host.style, { position: "absolute", inset: "0", overflow: "hidden", touchAction: "none", background: "#13294B" });
    if (getComputedStyle(this.container).position === "static") this.container.style.position = "relative";
    this.container.appendChild(this.host);
    await this.app.init({
      width: 64,
      height: 64,
      background: PAL.sky,
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
    const canvas = this.app.canvas;
    Object.assign(canvas.style, { display: "block", imageRendering: "pixelated", position: "absolute", left: "0", top: "0" });
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
    this.resizeObserver = new ResizeObserver(() => this.resize(true));
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    const canvas = this.app.canvas as HTMLCanvasElement | undefined;
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
      this.app.destroy({ removeView: true }, { children: true });
    }
    this.host.remove();
  }

  private mountScene(): void {
    this.scene?.destroy();
    const opts = { reducedMotion: this.reducedMotion };
    const scene: Scene = this.view.kind === "city" ? new CityScene(opts) : new FloorScene(this.view.division, opts);
    this.scene = scene;
    this.hover = null;
    this.app.stage.addChild(scene.root);
    scene.setStats(this.stats);
    scene.setAgents(this.agents, { added: [...this.agents.values()], updated: [], removed: [] });
    scene.setSelected(this.selected);
    this.resize(true);
  }

  private get dpr(): number {
    return window.devicePixelRatio || 1;
  }

  private resize(refit: boolean): void {
    if (!this.scene || this.destroyed) return;
    const cssW = Math.max(1, this.host.clientWidth);
    const cssH = Math.max(1, this.host.clientHeight);
    if (refit) this.scale = fitScale(this.scene.bounds(), cssW, cssH, this.dpr);
    const artW = Math.ceil((cssW * this.dpr) / this.scale);
    const artH = Math.ceil((cssH * this.dpr) / this.scale);
    this.app.renderer.resize(artW, artH);
    const canvas = this.app.canvas;
    canvas.style.width = `${(artW * this.scale) / this.dpr}px`;
    canvas.style.height = `${(artH * this.scale) / this.dpr}px`;
    if (refit) this.pan = centerOn(this.scene.bounds(), artW, artH);
    this.applyPan();
  }

  private applyPan(): void {
    if (!this.scene) return;
    const { width, height } = this.app.renderer;
    this.pan = clampPan(this.pan, this.scene.bounds(), width, height);
    this.scene.root.position.set(Math.round(this.pan.x), Math.round(this.pan.y));
  }

  private toArt(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * this.app.renderer.width) / Math.max(1, rect.width),
      y: ((e.clientY - rect.top) * this.app.renderer.height) / Math.max(1, rect.height),
    };
  }

  private hitAt(e: { clientX: number; clientY: number }): Hit | null {
    const p = this.toArt(e);
    return this.scene?.hitTest(p.x - this.pan.x, p.y - this.pan.y) ?? null;
  }

  private setHover(hit: Hit | null): void {
    if (sameHit(hit, this.hover)) return;
    this.hover = hit;
    this.scene?.setHover(hit);
    this.app.canvas.style.cursor = hit ? "pointer" : "grab";
  }

  private zoomTo(next: number, at: { x: number; y: number }): void {
    const to = clampScale(next);
    if (to === this.scale) return;
    this.pan = zoomAround(this.pan, at.x, at.y, this.scale, to);
    this.scale = to;
    this.resize(false);
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
        this.zoomTo(this.scale + (dist > this.pinchDist ? 1 : -1), this.toArt(this.pointerCenter()));
        this.pinchDist = dist;
      }
      return;
    }
    if (!this.dragged) return;
    const k = this.dpr / this.scale;
    this.pan = { x: this.pan.x + dx * k, y: this.pan.y + dy * k };
    this.app.canvas.style.cursor = "grabbing";
    this.applyPan();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const had = this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    if (had && !this.dragged) {
      const hit = this.hitAt(e);
      if (hit?.kind === "building") this.callbacks.onSelectBuilding(hit.division);
      else if (hit?.kind === "agent") this.callbacks.onSelectAgent(hit.profile);
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
    this.zoomTo(this.scale + (e.deltaY < 0 ? 1 : -1), this.toArt(e));
  };

  private readonly onMotionChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
    this.scene?.setReducedMotion(e.matches);
  };

  private readonly onTick = (ticker: Ticker): void => {
    const dt = Math.min(100, ticker.deltaMS);
    this.now += dt;
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
