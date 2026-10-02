import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Turns an HTML document into a PDF file. */
export interface PdfRenderer {
  render(html: string, outPath: string): Promise<void>;
}

/** Captures a page as a phone would show it, to a PNG file. */
export interface Screenshotter {
  capture(url: string, outPath: string): Promise<void>;
}

/** iPhone-sized viewport; the capture keeps the first few screens of the home page. */
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const CAPTURE_HEIGHT = 2400;
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STEP_TIMEOUT_MS = 45_000;

export function chromePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env.CHROME_PATH, MAC_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

interface CdpMessage {
  id?: number;
  sessionId?: string;
  method?: string;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/** A minimal Chrome DevTools Protocol connection over the browser websocket (flattened sessions). */
class Cdp {
  private next = 0;
  private readonly pending = new Map<number, (m: CdpMessage) => void>();
  private readonly events: ((m: CdpMessage) => void)[] = [];

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as CdpMessage;
      if (m.id !== undefined) {
        this.pending.get(m.id)?.(m);
        this.pending.delete(m.id);
      } else for (const listener of this.events) listener(m);
    });
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Chrome ${method} timed out`)), STEP_TIMEOUT_MS);
      this.pending.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(`Chrome ${method}: ${m.error.message}`));
        else resolve(m.result as T);
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  once(method: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Chrome never sent ${method}`)), STEP_TIMEOUT_MS);
      this.events.push((m) => {
        if (m.method === method && m.sessionId === sessionId) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }
}

async function devToolsUrl(profile: string, proc: ChildProcess): Promise<string> {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited (${proc.exitCode})`);
    try {
      const [port, path] = (await readFile(file, "utf8")).trim().split("\n");
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    } catch {
      // Not written yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome did not start its DevTools endpoint");
}

type Session = { cdp: Cdp; sessionId: string };

/**
 * Headless Chrome, one browser per job. render(): loads the HTML from a temp file, waits for the web fonts
 * (IBM Plex Sans Arabic) so Arabic text is shaped correctly, then Page.printToPDF at the CSS page size.
 * capture(): the prospect's home page on a phone viewport, as a PNG.
 */
export class ChromeRenderer implements PdfRenderer, Screenshotter {
  constructor(private readonly binary: () => string | null = () => chromePath()) {}

  async render(html: string, outPath: string): Promise<void> {
    await this.withPage(async ({ cdp, sessionId }, profile) => {
      const page = join(profile, "report.html");
      await writeFile(page, html, "utf8");
      await navigate(cdp, sessionId, pathToFileURL(page).href);
      // Fonts that never arrive (offline) fall back to system fonts after 10 s rather than failing the PDF.
      await cdp.send(
        "Runtime.evaluate",
        { expression: "Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 10000))]).then(() => true)", awaitPromise: true },
        sessionId,
      );
      const { data } = await cdp.send<{ data: string }>(
        "Page.printToPDF",
        { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
        sessionId,
      );
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, Buffer.from(data, "base64"));
    });
  }

  async capture(url: string, outPath: string): Promise<void> {
    await this.withPage(async ({ cdp, sessionId }) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", MOBILE, sessionId);
      await cdp.send("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA }, sessionId);
      await navigate(cdp, sessionId, url);
      // Scroll through the first screens so lazy-loaded images render, then back to the top.
      await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(async () => { for (let y = 0; y <= ${CAPTURE_HEIGHT}; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 1500)); return true; })()`,
          awaitPromise: true,
        },
        sessionId,
      );
      const { data } = await cdp.send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: MOBILE.width, height: CAPTURE_HEIGHT, scale: 1 } },
        sessionId,
      );
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, Buffer.from(data, "base64"));
    });
  }

  private async withPage(work: (s: Session, profile: string) => Promise<void>): Promise<void> {
    const bin = this.binary();
    if (!bin) throw new Error("Chrome is not installed (set CHROME_PATH)");
    const profile = await mkdtemp(join(tmpdir(), "zain-audit-chrome-"));
    const proc = spawn(
      bin,
      ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--hide-scrollbars", "about:blank"],
      { stdio: "ignore" },
    );
    let ws: WebSocket | undefined;
    try {
      ws = new WebSocket(await devToolsUrl(profile, proc));
      await new Promise<void>((resolve, reject) => {
        ws!.addEventListener("open", () => resolve());
        ws!.addEventListener("error", () => reject(new Error("Chrome DevTools connection failed")));
      });
      const cdp = new Cdp(ws);
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      await work({ cdp, sessionId }, profile);
    } finally {
      try {
        ws?.close();
      } catch {
        // Already closed.
      }
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function navigate(cdp: Cdp, sessionId: string, url: string): Promise<void> {
  const loaded = cdp.once("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
}
