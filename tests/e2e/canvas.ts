import type { Page } from "./browser";
import { sleep } from "./processes";

/**
 * Canvas interaction without exposing anything from the world: the World sets the canvas cursor to
 * "pointer" exactly when its own hitTest finds a building/agent under a mouse pointermove. We sweep
 * synthetic pointermoves over the visible canvas inside the page (fast, no CDP round trips), group
 * the hit points into blobs, then click candidates with real CDP mouse events and let the UI tell us
 * what was hit (breadcrumb / panel title).
 */

export type Pt = [number, number];

export async function scanHits(page: Page, step = 6): Promise<Pt[]> {
  return page.eval<Pt[]>(`(() => {
    const canvas = document.querySelector('.app-world canvas');
    if (!canvas) return [];
    const r = canvas.getBoundingClientRect();
    const pts = [];
    // The World leaves a stale "pointer" cursor after a scene change (see known-bugs test); clear it.
    canvas.style.cursor = '';
    const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 977, pointerType: 'mouse', bubbles: true }));
    for (let y = Math.max(0, r.top) + ${step / 2}; y < Math.min(innerHeight, r.bottom); y += ${step}) {
      for (let x = Math.max(0, r.left) + ${step / 2}; x < Math.min(innerWidth, r.right); x += ${step}) {
        if (document.elementFromPoint(x, y) !== canvas) continue;
        fire('pointermove', x, y);
        if (canvas.style.cursor === 'pointer') pts.push([x, y]);
      }
    }
    fire('pointerleave', -1, -1);
    return pts;
  })()`);
}

/** Connected components on the scan grid, largest first. */
export function blobs(points: readonly Pt[], step = 6): Pt[][] {
  const key = (p: Pt) => `${Math.round(p[0] / step)},${Math.round(p[1] / step)}`;
  const byKey = new Map(points.map((p) => [key(p), p]));
  const seen = new Set<string>();
  const out: Pt[][] = [];
  for (const p of points) {
    const k0 = key(p);
    if (seen.has(k0)) continue;
    const blob: Pt[] = [];
    const queue = [k0];
    seen.add(k0);
    while (queue.length) {
      const k = queue.pop()!;
      const q = byKey.get(k)!;
      blob.push(q);
      const [gx, gy] = k.split(",").map(Number) as [number, number];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = `${gx + dx},${gy + dy}`;
        if (byKey.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          queue.push(nk);
        }
      }
    }
    out.push(blob);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Points to try inside a blob: the one nearest its centroid, then well-spread others. */
export function candidates(blob: readonly Pt[], spread = 14, max = 6): Pt[] {
  const cx = blob.reduce((s, p) => s + p[0], 0) / blob.length;
  const cy = blob.reduce((s, p) => s + p[1], 0) / blob.length;
  const sorted = [...blob].sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  const picked: Pt[] = [];
  for (const p of sorted) {
    if (picked.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= spread)) picked.push(p);
    if (picked.length >= max) break;
  }
  return picked;
}

export interface ClickOutcome {
  at: Pt;
  result: string;
}

/**
 * Clicks candidates blob by blob; `observe` reports what the UI shows after each click, `reset`
 * undoes a click that did not reach the goal. Stops once `done(outcomes)` is true.
 */
export async function clickThrough(
  page: Page,
  points: readonly Pt[],
  step: number,
  observe: () => Promise<string>,
  done: (outcomes: ClickOutcome[]) => boolean,
  reset: (result: string) => Promise<void>,
): Promise<ClickOutcome[]> {
  const outcomes: ClickOutcome[] = [];
  for (const blob of blobs(points, step)) {
    for (const at of candidates(blob)) {
      await page.mouseClick(at[0], at[1]);
      await sleep(350);
      const result = await observe();
      outcomes.push({ at, result });
      if (done(outcomes)) return outcomes;
      await reset(result);
      await sleep(250);
    }
  }
  return outcomes;
}

/**
 * Scans until two sweeps 600ms apart agree. The world re-fits (with a short tween) whenever the
 * space beside the HUD and panels changes, e.g. the HUD's connections row arriving, so hit points
 * taken mid-fit point at the wrong building a moment later.
 */
export async function stableHits(page: Page, timeoutMs = 10_000): Promise<Pt[]> {
  const deadline = Date.now() + timeoutMs;
  let previous = await scanHits(page);
  for (;;) {
    await sleep(600);
    const next = await scanHits(page);
    if (JSON.stringify(next) === JSON.stringify(previous) && next.length > 0) return next;
    if (Date.now() > deadline) return next;
    previous = next;
  }
}

/**
 * From the city, click buildings until the breadcrumb shows `divisionName`. The city is re-scanned
 * after every miss: returning to it can move the layout (rail, HUD), so old points go stale.
 */
export async function enterBuilding(page: Page, divisionName: string): Promise<ClickOutcome[]> {
  await page.waitFor("document.querySelector('.app-world canvas')?.width > 64", "world canvas sized");
  const breadcrumb = () => page.eval<string>("__e2e.text('.zui-breadcrumb [aria-current=page]') ?? ''");
  const outcomes: ClickOutcome[] = [];
  const tried = new Set<string>();
  for (let round = 0; round < 40; round++) {
    const hits = await stableHits(page);
    const layout = `${divisionName}|${JSON.stringify(hits)}`;
    const known = remembered.get(layout);
    // Adjacent hotspots merge into one blob (Studio sits in front of Growth), so spread the tries out.
    const tries = [...(known ? [known] : []), ...blobs(hits).flatMap((b) => candidates(b, 36, 12))];
    const next = tries.find((p) => !tried.has(cell(p)));
    if (!next) break;
    tried.add(cell(next));
    await page.mouseClick(next[0], next[1]);
    await sleep(350);
    const result = await breadcrumb();
    outcomes.push({ at: next, result });
    if (result === divisionName) {
      remembered.set(layout, next);
      return outcomes;
    }
    if (result !== "City") await page.click(".zui-breadcrumb button", "‹ City");
    await sleep(250);
  }
  return outcomes;
}

/** Point that entered a building, per identical city layout, so later tests click it first. */
const remembered = new Map<string, Pt>();

/** Coarse cell so a re-scan's nearby point counts as the same building spot. */
const cell = (p: Pt) => `${Math.round(p[0] / 24)},${Math.round(p[1] / 24)}`;
