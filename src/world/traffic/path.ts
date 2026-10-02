import type { Pt } from "../iso";

export interface PathSample {
  x: number;
  y: number;
  /** Unit heading. */
  dx: number;
  dy: number;
}

/** A polyline walked by arc length; sampling writes into a caller-owned object so the hot loop never allocates. */
export class Path {
  readonly length: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly cum: Float64Array;

  constructor(points: readonly Pt[]) {
    if (points.length < 2) throw new Error("A path needs at least two points");
    const n = points.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.cum = new Float64Array(n);
    points.forEach((p, i) => {
      this.xs[i] = p.x;
      this.ys[i] = p.y;
      if (i > 0) this.cum[i] = this.cum[i - 1]! + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y);
    });
    this.length = this.cum[n - 1]!;
  }

  get start(): Pt {
    return { x: this.xs[0]!, y: this.ys[0]! };
  }

  get end(): Pt {
    const n = this.xs.length - 1;
    return { x: this.xs[n]!, y: this.ys[n]! };
  }

  sample(s: number, out: PathSample): PathSample {
    const c = this.cum;
    const last = c.length - 1;
    const d = s <= 0 ? 0 : s >= this.length ? this.length : s;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const c0 = c[lo]!;
    const x0 = this.xs[lo]!;
    const y0 = this.ys[lo]!;
    const t = (d - c0) / (c[hi]! - c0 || 1);
    const ex = this.xs[hi]! - x0;
    const ey = this.ys[hi]! - y0;
    out.x = x0 + ex * t;
    out.y = y0 + ey * t;
    const len = Math.hypot(ex, ey) || 1;
    out.dx = ex / len;
    out.dy = ey / len;
    return out;
  }

  /** Arc length of the point on the path nearest to p. */
  project(p: Pt): number {
    let best = Number.POSITIVE_INFINITY;
    let bestS = 0;
    for (let i = 1; i < this.xs.length; i++) {
      const ax = this.xs[i - 1]!;
      const ay = this.ys[i - 1]!;
      const ex = this.xs[i]! - ax;
      const ey = this.ys[i]! - ay;
      const l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.y - ay) * ey) / l2));
      const d = Math.hypot(ax + ex * t - p.x, ay + ey * t - p.y);
      if (d < best) {
        best = d;
        bestS = this.cum[i - 1]! + t * Math.sqrt(l2);
      }
    }
    return bestS;
  }
}

/** Quadratic Bezier from a through control c to b, excluding a. */
export function curve(a: Pt, c: Pt, b: Pt, steps = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return out;
}
