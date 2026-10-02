import { Container, Graphics, Text, type TextStyleOptions } from "pixi.js";

export const FONT_FAMILY = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const INK = 0x17181a;
export const PILL_FILL = 0xffffff;
export const PILL_BORDER = 0xe6e1d8;

export const STATUS_COLORS = {
  working: 0x22a06b,
  blocked: 0xe5484d,
  awaiting: 0xf5a524,
  queued: 0x8a8f98,
} as const;

/** Resolves once Inter is available (or immediately when the Font Loading API is missing). */
export function fontsReady(): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  return fonts
    .load(`600 12px Inter`)
    .then(() => undefined)
    .catch(() => undefined);
}

export function textStyle(size: number, weight: TextStyleOptions["fontWeight"] = "600", fill: number = INK): TextStyleOptions {
  return { fontFamily: FONT_FAMILY, fontSize: size, fontWeight: weight, fill, letterSpacing: 0.1 };
}

/** White rounded pill with a hairline warm border and soft shadow, bottom-centre at (0, 0). */
export function drawPill(g: Graphics, w: number, h: number): void {
  const r = h / 2;
  g.roundRect(-w / 2, -h + 2.5, w, h, r).fill({ color: 0x2a2118, alpha: 0.06 });
  g.roundRect(-w / 2 - 0.5, -h + 1, w + 1, h, r).fill({ color: 0x2a2118, alpha: 0.08 });
  g.roundRect(-w / 2, -h, w, h, r).fill({ color: PILL_FILL }).stroke({ color: PILL_BORDER, width: 1, alignment: 1 });
}

export interface PillItem {
  /** Coloured dot before the text; omitted when undefined. */
  dot?: number;
  text: string;
  weight?: TextStyleOptions["fontWeight"];
}

/**
 * Builds a pill holding one or more dot+label items into `c` (bottom-centre at (0, 0)) and returns its size.
 * `resolution` should be at least the device pixel ratio so text stays crisp.
 */
export function buildPill(c: Container, items: readonly PillItem[], resolution: number, size = 12): { w: number; h: number } {
  const h = Math.round(size * 1.9);
  const pad = Math.round(size * 0.8);
  const gap = Math.round(size * 0.75);
  const dotR = size * 0.33;
  const texts = items.map((i) => new Text({ text: i.text, style: textStyle(size, i.weight ?? "600"), resolution }));
  const widths = items.map((i, n) => (i.dot !== undefined ? dotR * 2 + size * 0.4 : 0) + texts[n]!.width);
  const w = Math.round(pad * 2 + widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, items.length - 1));
  const g = new Graphics();
  drawPill(g, w, h);
  c.addChild(g);
  let x = -w / 2 + pad;
  items.forEach((item, n) => {
    if (item.dot !== undefined) {
      c.addChild(new Graphics().circle(x + dotR, -h / 2, dotR).fill(item.dot));
      x += dotR * 2 + size * 0.4;
    }
    const t = texts[n]!;
    t.position.set(Math.round(x), Math.round(-h / 2 - t.height / 2));
    c.addChild(t);
    x += t.width + gap;
  });
  return { w, h };
}

export function clearChildren(c: Container): void {
  for (const child of c.removeChildren()) child.destroy({ children: true });
}
