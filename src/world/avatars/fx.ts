import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { Emote } from "./types";

let shared: { cloud: GraphicsContext; scribble: GraphicsContext; bubble: GraphicsContext; dot: GraphicsContext; z: GraphicsContext; spark: GraphicsContext } | null = null;

/** Icon art in voxel units (one unit = one voxel step), built once and shared by every avatar. */
function contexts() {
  if (shared) return shared;
  const cloud = new GraphicsContext();
  for (const [x, y, r] of [
    [-4, 0, 3.6],
    [0, -2, 4.4],
    [4.5, -0.5, 3.6],
    [1, 1.6, 3.4],
    [-1.8, 1.8, 3],
  ] as const) cloud.circle(x, y, r).fill(0x3b3f48);
  for (const [x, y, r] of [
    [-2.2, -2.2, 2.2],
    [1.2, -3.6, 2],
  ] as const) cloud.circle(x, y, r).fill({ color: 0x5a606c, alpha: 0.9 });
  const scribble = new GraphicsContext()
    .moveTo(-4.5, 0.5)
    .lineTo(-2, -2.5)
    .lineTo(-1, 1.5)
    .lineTo(1.5, -2.5)
    .lineTo(2.5, 1.5)
    .lineTo(5, -1.5)
    .stroke({ color: 0x0e0f12, width: 1.1, cap: "round", join: "round" })
    .moveTo(-3, 2.8)
    .lineTo(3.5, 2.6)
    .stroke({ color: 0xd8463c, width: 0.9, cap: "round" });
  const bubble = new GraphicsContext()
    .roundRect(-7, -4, 14, 8, 3.5)
    .fill(0xffffff)
    .stroke({ color: 0x2b2f38, width: 0.7 })
    .circle(-4.5, 6, 1.4)
    .fill(0xffffff)
    .stroke({ color: 0x2b2f38, width: 0.6 })
    .circle(-6.5, 8.6, 0.8)
    .fill(0xffffff)
    .stroke({ color: 0x2b2f38, width: 0.5 });
  const dot = new GraphicsContext().rect(-1, -1, 2, 2).fill(0x2b2f38);
  const z = new GraphicsContext()
    .moveTo(-1.6, -1.6)
    .lineTo(1.6, -1.6)
    .lineTo(-1.6, 1.6)
    .lineTo(1.6, 1.6)
    .stroke({ color: 0x2f3a5c, width: 0.9, cap: "square", join: "miter" });
  const spark = new GraphicsContext().rect(-0.8, -0.8, 1.6, 1.6).fill(0xffffff);
  shared = { cloud, scribble, bubble, dot, z, spark };
  return shared;
}

const SPARK_COLORS = [0xf2c94c, 0x56ccf2, 0xeb5757, 0x6fcf97, 0xbb6bd9, 0xf2994a] as const;

/** Floating emote icon above an avatar's head; animates without allocating. */
export class EmoteFx extends Container {
  private readonly cloud: Container;
  private readonly scribble: Graphics;
  private readonly bubble: Container;
  private readonly dots: Graphics[] = [];
  private readonly zs: Graphics[] = [];
  private readonly sparks: Graphics[] = [];
  private emote: Emote = "none";
  private t = 0;

  constructor() {
    super();
    const c = contexts();
    this.cloud = new Container();
    this.cloud.addChild(new Graphics(c.cloud));
    this.scribble = this.cloud.addChild(new Graphics(c.scribble));
    this.bubble = new Container();
    this.bubble.addChild(new Graphics(c.bubble));
    for (let i = 0; i < 3; i++) {
      const d = this.bubble.addChild(new Graphics(c.dot));
      d.position.set(-3.5 + i * 3.5, 0);
      this.dots.push(d);
    }
    for (let i = 0; i < 3; i++) this.zs.push(this.addChild(new Graphics(c.z)));
    for (let i = 0; i < 6; i++) {
      const s = this.addChild(new Graphics(c.spark));
      s.tint = SPARK_COLORS[i]!;
      this.sparks.push(s);
    }
    this.addChild(this.cloud, this.bubble);
    this.show("none");
  }

  show(emote: Emote): void {
    this.emote = emote;
    this.t = 0;
    this.cloud.visible = emote === "frustrated";
    this.bubble.visible = emote === "thinking";
    for (const z of this.zs) z.visible = emote === "sleepy";
    for (const s of this.sparks) s.visible = emote === "celebrate";
    this.visible = emote === "frustrated" || emote === "thinking" || emote === "sleepy" || emote === "celebrate";
    this.pose(0, true);
  }

  update(dtMs: number, still: boolean): void {
    if (!this.visible) return;
    this.t += dtMs;
    this.pose(this.t, still);
  }

  private pose(t: number, still: boolean): void {
    const s = still ? 0 : t / 1000;
    switch (this.emote) {
      case "frustrated":
        this.cloud.position.set(still ? 0 : Math.sin(s * 31) * 0.5, -4 + (still ? 0 : Math.sin(s * 23) * 0.4));
        this.scribble.rotation = still ? 0 : Math.sin(s * 17) * 0.15;
        break;
      case "thinking": {
        this.bubble.position.set(5, -5);
        const n = still ? 3 : 1 + (Math.floor(s * 2.5) % 3);
        for (let i = 0; i < 3; i++) this.dots[i]!.visible = i < n;
        break;
      }
      case "sleepy":
        for (let i = 0; i < 3; i++) {
          const z = this.zs[i]!;
          const p = still ? i / 3 : (s * 0.5 + i / 3) % 1;
          z.position.set(3 + p * 6 + Math.sin(p * 6) * 1, -2 - p * 10);
          z.scale.set(0.7 + p * 0.7);
          z.alpha = still ? 1 : Math.min(1, (1 - p) * 2.2);
        }
        break;
      case "celebrate":
        for (let i = 0; i < 6; i++) {
          const sp = this.sparks[i]!;
          const a = (i / 6) * Math.PI * 2 + 0.4;
          const p = still ? 0.6 : (s * 1.2 + i * 0.17) % 1;
          sp.position.set(Math.cos(a) * (3 + p * 8), -4 + Math.sin(a) * (2 + p * 5) + p * 4);
          sp.rotation = p * 3;
          sp.alpha = still ? 1 : 1 - p;
        }
        break;
      default:
        break;
    }
  }
}
