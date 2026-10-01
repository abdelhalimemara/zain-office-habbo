import type { Rect } from "./iso";

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale)));
}

/** Largest integer device-pixel scale at which `content` fits the viewport (css px × dpr). */
export function fitScale(content: Rect, viewW: number, viewH: number, dpr: number, pad = 24): number {
  const devW = Math.max(1, (viewW - pad * 2) * dpr);
  const devH = Math.max(1, (viewH - pad * 2) * dpr);
  const s = Math.floor(Math.min(devW / Math.max(1, content.w), devH / Math.max(1, content.h)));
  return clampScale(Math.min(s, Math.max(MIN_SCALE, Math.round(dpr * 3))));
}

export function centerOn(content: Rect, artW: number, artH: number): { x: number; y: number } {
  return {
    x: Math.round(artW / 2 - (content.x + content.w / 2)),
    y: Math.round(artH / 2 - (content.y + content.h / 2)),
  };
}

/** Keeps at least `margin` art pixels of the content visible. */
export function clampPan(pan: { x: number; y: number }, content: Rect, artW: number, artH: number, margin = 64) {
  const m = Math.min(margin, content.w / 2, content.h / 2);
  const minX = m - (content.x + content.w);
  const maxX = artW - m - content.x;
  const minY = m - (content.y + content.h);
  const maxY = artH - m - content.y;
  return {
    x: Math.max(minX, Math.min(maxX, pan.x)),
    y: Math.max(minY, Math.min(maxY, pan.y)),
  };
}

/** New pan so that the art point under (px, py) stays fixed when the scale changes. */
export function zoomAround(pan: { x: number; y: number }, px: number, py: number, from: number, to: number) {
  const ratio = from / to;
  return {
    x: Math.round(px * ratio - (px - pan.x)),
    y: Math.round(py * ratio - (py - pan.y)),
  };
}
