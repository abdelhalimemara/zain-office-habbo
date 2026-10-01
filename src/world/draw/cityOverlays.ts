import { Container, Graphics, Text, type TextStyleOptions } from "pixi.js";
import type { DivisionStats } from "../../../shared/flow";

const FONT = 'Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif';
const INK = 0x1d2430;
const PILL_H = 24;
const PAD = 10;

export const STATUS_COLORS = { working: 0x22b573, blocked: 0xe5484d, awaiting: 0xf5a524 } as const;

function textStyle(size: number, fill: number, weight: TextStyleOptions["fontWeight"] = "700"): TextStyleOptions {
  return { fontFamily: FONT, fontSize: size, fontWeight: weight, fill, letterSpacing: 0.4 };
}

function pill(g: Graphics, w: number, h: number, fill: number, alpha = 0.96): void {
  const r = h / 2;
  g.roundRect(-w / 2, -h + 3, w, h, r).fill({ color: 0x0b1220, alpha: 0.1 });
  g.roundRect(-w / 2, -h + 1.5, w, h, r).fill({ color: 0x0b1220, alpha: 0.12 });
  g.roundRect(-w / 2, -h, w, h, r).fill({ color: fill, alpha });
}

/** Building name: white rounded pill with a division-colour dot; bottom-centre at (0, 0). Returns its height. */
export function buildNameLabel(c: Container, name: string, accent: number, resolution: number): number {
  const text = new Text({ text: name, style: textStyle(12, INK, "800"), resolution });
  const w = text.width + PAD * 2 + 14;
  const g = new Graphics();
  pill(g, w, PILL_H, 0xffffff);
  g.circle(-w / 2 + PAD + 4, -PILL_H / 2, 4.5).fill(accent);
  text.position.set(-w / 2 + PAD + 14, -PILL_H / 2 - text.height / 2);
  c.addChild(g, text);
  return PILL_H;
}

export interface BadgeParts {
  height: number;
  /** The awaiting-approval marker, animated by the scene; null when nothing awaits HQ. */
  bang: Container | null;
}

/** Live counts pill: green working, red blocked (> 0), amber "!" awaiting HQ (> 0); bottom-centre at (0, 0). */
export function buildBadge(c: Container, s: Pick<DivisionStats, "working" | "blocked" | "awaitingApproval">, resolution: number): BadgeParts {
  const items: { color: number; label: string; bang: boolean }[] = [{ color: STATUS_COLORS.working, label: String(s.working), bang: false }];
  if (s.blocked > 0) items.push({ color: STATUS_COLORS.blocked, label: String(s.blocked), bang: false });
  if (s.awaitingApproval > 0) items.push({ color: STATUS_COLORS.awaiting, label: String(s.awaitingApproval), bang: true });
  const texts = items.map((i) => new Text({ text: i.label, style: textStyle(12, INK), resolution }));
  const itemW = texts.map((t, i) => (items[i]!.bang ? 16 : 10) + 4 + t.width);
  const gap = 10;
  const w = PAD * 2 + itemW.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  const h = 22;
  const g = new Graphics();
  pill(g, w, h, 0xffffff);
  c.addChild(g);
  let x = -w / 2 + PAD;
  let bang: Container | null = null;
  items.forEach((item, i) => {
    const t = texts[i]!;
    if (item.bang) {
      const b = new Container();
      const dot = new Graphics().circle(0, 0, 7).fill(item.color);
      const mark = new Text({ text: "!", style: textStyle(11, 0xffffff, "900"), resolution });
      mark.anchor.set(0.5);
      b.addChild(dot, mark);
      b.position.set(x + 7, -h / 2);
      c.addChild(b);
      bang = b;
      x += 16;
    } else {
      c.addChild(new Graphics().circle(x + 4, -h / 2, 4).fill(item.color));
      x += 10;
    }
    t.position.set(x + 4, -h / 2 - t.height / 2);
    c.addChild(t);
    x += 4 + t.width + gap;
  });
  return { height: h, bang };
}

/** Dark rounded plate with a gold "Z", centred on (0, 0), sized in image pixels. */
export function buildZainPlate(c: Container, w: number, h: number): void {
  const g = new Graphics();
  g.roundRect(-w / 2, -h / 2, w, h, 4).fill(0x15171d).stroke({ color: 0xf2c230, width: 1.5, alpha: 0.9 });
  g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, 2, 1).fill({ color: 0xffffff, alpha: 0.08 });
  const z = new Text({ text: "Z", style: { fontFamily: FONT, fontSize: h * 0.68, fontWeight: "900", fill: 0xf2c230 }, resolution: 4 });
  z.anchor.set(0.5);
  z.position.set(0, 1);
  c.addChild(g, z);
}

/** Small screens: one pill holding the accent dot, short name and live counts; bottom-centre at (0, 0). */
export function buildCompactMarker(
  c: Container,
  short: string,
  accent: number,
  s: Pick<DivisionStats, "working" | "blocked" | "awaitingApproval"> | undefined,
  resolution: number,
): BadgeParts {
  const h = 20;
  const parts: { kind: "dot" | "bang"; color: number; text: Text }[] = [];
  const name = new Text({ text: short, style: textStyle(10, INK, "800"), resolution });
  if (s) {
    parts.push({ kind: "dot", color: STATUS_COLORS.working, text: new Text({ text: String(s.working), style: textStyle(10, INK), resolution }) });
    if (s.blocked > 0) parts.push({ kind: "dot", color: STATUS_COLORS.blocked, text: new Text({ text: String(s.blocked), style: textStyle(10, INK), resolution }) });
    if (s.awaitingApproval > 0) {
      parts.push({ kind: "bang", color: STATUS_COLORS.awaiting, text: new Text({ text: String(s.awaitingApproval), style: textStyle(10, INK), resolution }) });
    }
  }
  const partW = parts.map((p) => (p.kind === "bang" ? 13 : 8) + 3 + p.text.width);
  const w = 8 + 10 + name.width + partW.reduce((a, b) => a + b + 7, 0) + 8;
  const g = new Graphics();
  pill(g, w, h, 0xffffff);
  g.circle(-w / 2 + 11, -h / 2, 3.5).fill(accent);
  c.addChild(g);
  name.position.set(-w / 2 + 18, -h / 2 - name.height / 2);
  c.addChild(name);
  let x = -w / 2 + 18 + name.width + 7;
  let bang: Container | null = null;
  parts.forEach((p, i) => {
    if (p.kind === "bang") {
      const b = new Container();
      const mark = new Text({ text: "!", style: textStyle(9, 0xffffff, "900"), resolution });
      mark.anchor.set(0.5);
      b.addChild(new Graphics().circle(0, 0, 5.5).fill(p.color), mark);
      b.position.set(x + 6, -h / 2);
      c.addChild(b);
      bang = b;
    } else {
      c.addChild(new Graphics().circle(x + 3, -h / 2, 3).fill(p.color));
    }
    p.text.position.set(x + (p.kind === "bang" ? 13 : 8) + 3, -h / 2 - p.text.height / 2);
    c.addChild(p.text);
    x += partW[i]! + 7;
  });
  return { height: h, bang };
}
