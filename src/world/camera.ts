import type { Rect } from "./iso";

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 8;
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 8] as const;
const FILL = 0.88;
const INTEGER_TOLERANCE = 0.85;
/** Phones: never shrink art below this many css px per art px; the user pans instead. */
const NARROW_VIEW = 640;
const READABLE_CSS_SCALE = 0.75;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function normalizeInsets(i: Partial<Insets> | undefined): Insets {
  const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  return { top: n(i?.top), right: n(i?.right), bottom: n(i?.bottom), left: n(i?.left) };
}

export function sameInsets(a: Insets, b: Insets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/** The css-pixel rectangle not covered by overlay UI; collapses gracefully when insets exceed the viewport. */
export function visibleArea(viewW: number, viewH: number, insets: Insets): Rect {
  let { top, right, bottom, left } = insets;
  const minW = Math.min(viewW, 240);
  const minH = Math.min(viewH, 200);
  if (viewW - left - right < minW) {
    const k = Math.max(0, viewW - minW) / Math.max(1, left + right);
    left *= k;
    right *= k;
  }
  if (viewH - top - bottom < minH) {
    const k = Math.max(0, viewH - minH) / Math.max(1, top + bottom);
    top *= k;
    bottom *= k;
  }
  return { x: left, y: top, w: viewW - left - right, h: viewH - top - bottom };
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

/**
 * Device-pixel scale that makes `content` fill ~88% of the visible area. Integer scales are preferred when they
 * fill at least 85% of what the ideal scale would; otherwise quarter steps keep pixels close to uniform. On narrow
 * (phone) viewports the art is kept readable and may overflow, to be panned.
 */
export function fitScale(content: Rect, area: { w: number; h: number }, dpr: number): number {
  const raw = Math.min((area.w * dpr) / Math.max(1, content.w), (area.h * dpr) / Math.max(1, content.h)) * FILL;
  const readable = area.w < NARROW_VIEW ? Math.floor(dpr * READABLE_CSS_SCALE * 4) / 4 : MIN_SCALE;
  if (raw <= readable) return clampScale(readable);
  const whole = Math.floor(raw);
  if (whole / raw >= INTEGER_TOLERANCE) return clampScale(whole);
  return clampScale(Math.floor(raw * 4) / 4);
}

export function stepZoom(scale: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_LEVELS.find((z) => z > scale + 1e-6) ?? MAX_SCALE;
  return [...ZOOM_LEVELS].reverse().find((z) => z < scale - 1e-6) ?? MIN_SCALE;
}

/** Pan (art px) that puts the content centre at the centre of `area` (css px). */
export function centerIn(content: Rect, area: Rect, scale: number, dpr: number): { x: number; y: number } {
  const k = dpr / scale;
  return {
    x: (area.x + area.w / 2) * k - (content.x + content.w / 2),
    y: (area.y + area.h / 2) * k - (content.y + content.h / 2),
  };
}

/** Keeps at least `margin` art pixels of the content inside the visible area. */
export function clampPan(pan: { x: number; y: number }, content: Rect, area: Rect, scale: number, dpr: number, margin = 64) {
  const k = dpr / scale;
  const ax = area.x * k;
  const ay = area.y * k;
  const aw = area.w * k;
  const ah = area.h * k;
  const m = Math.min(margin, content.w / 2, content.h / 2, aw / 2, ah / 2);
  const minX = ax + m - (content.x + content.w);
  const maxX = ax + aw - m - content.x;
  const minY = ay + m - (content.y + content.h);
  const maxY = ay + ah - m - content.y;
  return {
    x: Math.max(minX, Math.min(maxX, pan.x)),
    y: Math.max(minY, Math.min(maxY, pan.y)),
  };
}

/** New pan so that the art point under canvas pixel (px, py) stays fixed when the scale changes. */
export function zoomAround(pan: { x: number; y: number }, px: number, py: number, from: number, to: number) {
  const ratio = from / to;
  return {
    x: px * ratio - (px - pan.x),
    y: py * ratio - (py - pan.y),
  };
}

export interface CameraState {
  scale: number;
  /** World point (art px) shown at `focus`. */
  world: { x: number; y: number };
  /** Css-pixel point on screen. */
  focus: { x: number; y: number };
}

export function easeOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) ** 3;
}

export function lerpCamera(a: CameraState, b: CameraState, t: number): CameraState {
  const e = easeOut(t);
  const l = (p: number, q: number) => p + (q - p) * e;
  return {
    scale: l(a.scale, b.scale),
    world: { x: l(a.world.x, b.world.x), y: l(a.world.y, b.world.y) },
    focus: { x: l(a.focus.x, b.focus.x), y: l(a.focus.y, b.focus.y) },
  };
}

export function panFor(c: CameraState, dpr: number): { x: number; y: number } {
  const k = dpr / c.scale;
  return { x: c.focus.x * k - c.world.x, y: c.focus.y * k - c.world.y };
}

/** Smooth (photographic) scenes: any fractional scale, filling the visible area edge to edge with a small margin. */
export const SMOOTH_FILL = 0.95;
const SMOOTH_STEP = 1.25;

export function fitSmooth(content: Rect, area: { w: number; h: number }, dpr: number, fill = SMOOTH_FILL): number {
  const raw = Math.min((area.w * dpr) / Math.max(1, content.w), (area.h * dpr) / Math.max(1, content.h)) * fill;
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** Wheel/pinch step for smooth scenes, clamped between half the fitted scale and 3× device resolution. */
export function stepSmooth(scale: number, dir: 1 | -1, fitted: number, dpr: number): number {
  const next = scale * (dir > 0 ? SMOOTH_STEP : 1 / SMOOTH_STEP);
  return Math.max(fitted * 0.5, Math.min(Math.max(fitted, dpr * 3), next));
}
