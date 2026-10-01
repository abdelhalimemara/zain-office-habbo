import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Browser, type Page } from "./browser";
import { FakeHermes } from "./fakeHermes";
import { freePort, launch, sleep, waitForHttp, type Managed } from "./processes";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(ROOT, "node_modules", ".bin");
const NETWORK_STUB = pathToFileURL(fileURLToPath(new URL("./networkStub.mjs", import.meta.url))).href;

export const SHOT_DIR =
  process.env.E2E_SHOT_DIR ??
  "/private/tmp/claude-501/-Users-abdelhalimemara-Desktop-Agent-Office-Zain-HQ---Habbo-Style-/1bfef095-6ea1-4854-bf5f-aafa06dbbf40/scratchpad";

export interface Stack {
  hermes: FakeHermes;
  /** The real Hono server, reached directly. */
  serverUrl: string;
  /** The Vite dev server the browser loads (proxies /api to the server). */
  webUrl: string;
  browser: Browser;
  page: Page;
  shot(name: string): Promise<string>;
  stop(): Promise<void>;
}

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, FORCE_COLOR: "0", NO_COLOR: "1" };
  delete env.HERMES_SESSION_TOKEN;
  delete env.NODE_ENV;
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  return env;
}

/**
 * Fake Hermes → real server (tsx, network stubbed, hires written to a temp cwd) → Vite dev server →
 * headless Chrome. Every process gets its own process group and is killed on stop().
 */
export async function startStack(options: { hermes?: FakeHermes } = {}): Promise<Stack> {
  const procs: Managed[] = [];
  const hermes = options.hermes ?? new FakeHermes();
  const serverCwd = mkdtempSync(join(tmpdir(), "zain-e2e-server-"));
  let browser: Browser | undefined;

  const stop = async () => {
    await browser?.close().catch(() => undefined);
    await Promise.all(procs.map((p) => p.stop()));
    await hermes.stop();
    rmSync(serverCwd, { recursive: true, force: true });
  };

  try {
    await hermes.start();
    const serverPort = await freePort();
    const server = launch("server", join(BIN, "tsx"), [join(ROOT, "server", "src", "index.ts")], {
      cwd: serverCwd,
      env: childEnv({
        HERMES_URL: hermes.url,
        ZAIN_SERVER_PORT: String(serverPort),
        NODE_OPTIONS: `--import=${NETWORK_STUB}`,
      }),
    });
    procs.push(server);
    const serverUrl = `http://127.0.0.1:${serverPort}`;

    const webPort = await freePort();
    const web = launch("vite", join(BIN, "vite"), ["--port", String(webPort), "--strictPort", "--clearScreen", "false"], {
      cwd: ROOT,
      env: childEnv({ ZAIN_SERVER_PORT: String(serverPort) }),
    });
    procs.push(web);
    const webUrl = `http://127.0.0.1:${webPort}`;

    await waitForHttp(`${serverUrl}/api/health`, server);
    await waitForHttp(`${webUrl}/`, web);
    // Warm Vite's dependency optimizer so the first page load does not race a reload.
    await waitForHttp(`${webUrl}/src/main.tsx`, web);

    browser = await Browser.launch();
    const page = browser.page;
    if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
    const b = browser;
    return {
      hermes,
      serverUrl,
      webUrl,
      browser: b,
      page,
      async shot(name) {
        const path = join(SHOT_DIR, `e2e-${name}.png`);
        // Let panel slide-in animations (160ms) finish so the shot shows the settled layout.
        await sleep(400);
        await page.screenshot(path);
        return path;
      },
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}

/** Load the app and wait until the HUD and the world canvas are up. */
export async function openApp(stack: Stack, viewport: { w: number; h: number; mobile?: boolean } = { w: 1400, h: 900 }): Promise<void> {
  const { page } = stack;
  await page.viewport(viewport.w, viewport.h, viewport.mobile);
  await page.goto(stack.webUrl);
  await page.waitFor("!!document.querySelector('.zui-hud') && !!document.querySelector('.app-world canvas')", "HUD and world canvas", 30_000);
}

export const hudStatus = (page: Page, label: "Hermes" | "Telegram") =>
  page.eval<string | null>(`document.querySelector('.zui-dot-item[title^="${label}:"]')?.getAttribute('title') ?? null`);

export const approvalsBadge = (page: Page) =>
  page.eval<string | null>(`document.querySelector('.zui-hud .zui-count--alert')?.textContent ?? null`);

/** Console errors that matter (Chrome's favicon 404 on the Vite dev server is noise). */
export const realErrors = (page: Page) => page.console.filter((e) => !/favicon\.ico/.test(e.text));
