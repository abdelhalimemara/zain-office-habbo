import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, launch, sleep, type Managed } from "./processes";

const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

export interface ConsoleEntry {
  kind: "exception" | "console" | "log";
  text: string;
}

/**
 * Locator helpers injected into every document. Elements are found by role-ish selector + accessible
 * name (aria-label, else collapsed text), so tests read like a user's description of the screen.
 */
const PAGE_HELPERS = `
window.__e2e = {
  name(el) { return (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim(); },
  find(selector, name, root) {
    const scope = root ? document.querySelector(root) : document;
    if (!scope) return null;
    const all = [...scope.querySelectorAll(selector)];
    if (name === undefined) return all[0] || null;
    return all.find((el) => this.name(el) === name) || all.find((el) => this.name(el).startsWith(name)) || null;
  },
  text(selector) { const el = document.querySelector(selector); return el ? el.textContent.replace(/\\s+/g, " ").trim() : null; },
  target(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const covered = !top || !(top === el || el.contains(top) || (el.control && (top === el.control)));
    return { x, y, covered, by: covered && top ? top.outerHTML.slice(0, 160) : null };
  },
};
`;

export class Page {
  readonly console: ConsoleEntry[] = [];
  private nextId = 0;
  private readonly pending = new Map<number, (m: CdpMessage) => void>();

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e: MessageEvent) => this.onMessage(JSON.parse(String(e.data)) as CdpMessage));
  }

  private onMessage(m: CdpMessage): void {
    if (m.id !== undefined) {
      this.pending.get(m.id)?.(m);
      this.pending.delete(m.id);
      return;
    }
    const p = m.params ?? {};
    if (m.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string } };
      this.console.push({ kind: "exception", text: d.exception?.description ?? d.text ?? "exception" });
    } else if (m.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) {
      const args = (p.args as { value?: unknown; description?: string }[]).map((a) => String(a.value ?? a.description ?? ""));
      this.console.push({ kind: "console", text: args.join(" ") });
    } else if (m.method === "Log.entryAdded") {
      const entry = p.entry as { level: string; text: string; url?: string };
      if (entry.level === "error") this.console.push({ kind: "log", text: `${entry.text} ${entry.url ?? ""}`.trim() });
    }
  }

  async send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextId;
    const reply = await new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 30_000);
      this.pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    if (reply.error) throw new Error(`CDP ${method}: ${reply.error.message}`);
    return reply.result as T;
  }

  async init(): Promise<void> {
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    await this.send("Log.enable");
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_HELPERS });
  }

  async viewport(width: number, height: number, mobile = false): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  }

  async reducedMotion(on: boolean): Promise<void> {
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "" }] });
  }

  async goto(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete' && !!window.__e2e", "page load");
  }

  async eval<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text: string } }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (r.exceptionDetails) throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  async waitFor<T>(expression: string, what: string, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        last = await this.eval<T>(expression);
        if (last) return last as T;
      } catch (err) {
        last = err;
      }
      await sleep(100);
    }
    throw new Error(`timed out after ${timeoutMs}ms waiting for ${what} (last: ${String(last)})`);
  }

  async mouseClick(x: number, y: number): Promise<void> {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    }
  }

  /** Real mouse click on the element's centre; fails when something else is painted on top of it. */
  async click(selector: string, name?: string, root?: string): Promise<void> {
    const args = [selector, name, root].map((a) => JSON.stringify(a ?? null).replace(/^null$/, "undefined")).join(",");
    const t = await this.waitFor<{ x: number; y: number; covered: boolean; by: string | null }>(
      `(() => { const el = __e2e.find(${args}); return el && !el.disabled ? __e2e.target(el) : null; })()`,
      `enabled ${selector} "${name ?? ""}"`,
    );
    if (t.covered) throw new Error(`${selector} "${name ?? ""}" is covered by ${t.by}`);
    await this.mouseClick(t.x, t.y);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.waitFor(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.select?.(); return document.activeElement === el; })()`, `focus ${selector}`);
    await this.send("Input.insertText", { text });
  }

  async select(selector: string, value: string): Promise<void> {
    await this.waitFor(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === ${JSON.stringify(value)};
      })()`,
      `select ${value} in ${selector}`,
    );
  }

  async press(key: string): Promise<void> {
    for (const type of ["keyDown", "keyUp"]) await this.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: key === "Escape" ? 27 : 0 });
  }

  async screenshot(path: string): Promise<void> {
    const shot = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(shot.data, "base64"));
  }
}

export class Browser {
  private constructor(
    private readonly proc: Managed,
    private readonly profileDir: string,
    readonly page: Page,
    private readonly ws: WebSocket,
  ) {}

  static async launch(): Promise<Browser> {
    const port = await freePort();
    const profileDir = mkdtempSync(join(tmpdir(), "zain-e2e-chrome-"));
    const proc = launch(
      "chrome",
      CHROME,
      [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--mute-audio",
        "about:blank",
      ],
      { cwd: profileDir, env: process.env },
    );
    let wsUrl: string | undefined;
    for (let i = 0; i < 100 && !wsUrl; i++) {
      await sleep(150);
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
      } catch {
        /* not up yet */
      }
    }
    if (!wsUrl) {
      await proc.stop();
      throw new Error(`Chrome did not expose a page target:\n${proc.output()}`);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
    });
    const page = new Page(ws);
    await page.init();
    return new Browser(proc, profileDir, page, ws);
  }

  async close(): Promise<void> {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    await this.proc.stop();
    rmSync(this.profileDir, { recursive: true, force: true });
  }
}
