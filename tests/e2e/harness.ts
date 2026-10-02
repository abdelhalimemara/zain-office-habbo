import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Browser, type Page } from "./browser";
import { FakeHermes } from "./fakeHermes";
import { freePort, launch, sleep, waitForHttp, type Managed } from "./processes";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(ROOT, "node_modules", ".bin");
const NETWORK_STUB = pathToFileURL(fileURLToPath(new URL("./networkStub.mjs", import.meta.url))).href;
/** The server's HERMES_BIN: records argv instead of touching the user's real ~/.hermes. */
const VITE_CONFIG = fileURLToPath(new URL("./vite.e2e.config.ts", import.meta.url));
export const HERMES_CLI_STUB = fileURLToPath(new URL("./hermesCliStub.mjs", import.meta.url));

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
  /** argv of every `hermes` CLI call the server made (through the stub), oldest first. */
  cliCalls(): string[][];
  stop(): Promise<void>;
}

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" };
  for (const key of ["HERMES_SESSION_TOKEN", "HERMES_BIN", "HEADCOUNT_REF", "NODE_ENV", "VITEST", "VITEST_WORKER_ID", "VITEST_POOL_ID"]) {
    delete env[key];
  }
  return { ...env, ...extra };
}

/**
 * Fake Hermes → real server (tsx, network stubbed, hires written to a temp cwd) → Vite dev server →
 * headless Chrome. Every process gets its own process group and is killed on stop().
 */
export async function startStack(options: { hermes?: FakeHermes } = {}): Promise<Stack> {
  const procs: Managed[] = [];
  const hermes = options.hermes ?? new FakeHermes();
  const serverCwd = mkdtempSync(join(tmpdir(), "zain-e2e-server-"));
  // Private pre-bundle cache: node_modules/.vite is shared with every worktree and the live dev server.
  const viteCache = mkdtempSync(join(tmpdir(), "zain-e2e-vite-"));
  let browser: Browser | undefined;

  const stop = async () => {
    await browser?.close().catch(() => undefined);
    await Promise.all(procs.map((p) => p.stop()));
    await hermes.stop();
    rmSync(serverCwd, { recursive: true, force: true });
    rmSync(viteCache, { recursive: true, force: true });
  };

  try {
    await hermes.start();
    const serverPort = await freePort();
    let webPort = await freePort();
    while (webPort === serverPort) webPort = await freePort();
    const webUrl = `http://127.0.0.1:${webPort}`;
    const cliLog = join(serverCwd, "hermes-cli-calls.jsonl");
    const fakeHome = join(serverCwd, "home");
    mkdirSync(join(fakeHome, ".hermes"), { recursive: true });
    const envLog = join(serverCwd, "server-env.jsonl");
    const server = launch("server", join(BIN, "tsx"), [join(ROOT, "server", "src", "index.ts")], {
      cwd: serverCwd,
      env: childEnv({
        HERMES_URL: hermes.url,
        ZAIN_SERVER_PORT: String(serverPort),
        NODE_OPTIONS: `--import=${NETWORK_STUB}`,
        // The guard only trusts :5173 and its own port; the random Vite port must be listed.
        ZAIN_ALLOWED_ORIGINS: webUrl,
        HERMES_BIN: HERMES_CLI_STUB,
        // Connection checks read ~/.hermes (.env, tokens, WhatsApp bridge) and ~/.mcp-auth: point both at empties.
        HOME: fakeHome,
        HERMES_HOME: join(fakeHome, ".hermes"),
        E2E_HERMES_STUB: HERMES_CLI_STUB,
        E2E_HERMES_CALLS: cliLog,
        E2E_SERVER_ENV_FILE: envLog,
      }),
    });
    procs.push(server);
    const serverUrl = `http://127.0.0.1:${serverPort}`;

    const web = launch("vite", join(BIN, "vite"), ["--config", VITE_CONFIG, "--port", String(webPort), "--strictPort", "--clearScreen", "false"], {
      cwd: ROOT,
      env: childEnv({ ZAIN_SERVER_PORT: String(serverPort), E2E_VITE_CACHE_DIR: viteCache }),
    });
    procs.push(web);

    await waitForHttp(`${serverUrl}/api/health`, server);
    assertIsolated(envLog);
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
      cliCalls: () =>
        readLines(cliLog)
          .map((line) => JSON.parse(line) as string[])
          .filter((argv) => argv[0] !== "--version"),
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}

function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

/** Every server process (tsx and its node child) must see HERMES_BIN = the stub, or nothing runs. */
function assertIsolated(envLog: string): void {
  const seen = readLines(envLog).map((line) => JSON.parse(line) as { pid: number; HERMES_BIN: string | null; HOME: string | null; HERMES_HOME: string | null });
  if (seen.length === 0) throw new Error("e2e isolation: the server never loaded the network stub preload");
  const leaks = seen.filter((p) => p.HERMES_BIN !== HERMES_CLI_STUB || !p.HOME?.startsWith(tmpdir()) || !p.HERMES_HOME?.startsWith(p.HOME));
  if (leaks.length) throw new Error(`e2e isolation: server HERMES_BIN/HOME/HERMES_HOME escape the sandbox: ${JSON.stringify(leaks)}`);
}

/** Load the app and wait until the HUD and the world canvas are up. */
export async function openApp(stack: Stack, viewport: { w: number; h: number; mobile?: boolean } = { w: 1400, h: 900 }): Promise<void> {
  const { page } = stack;
  await page.viewport(viewport.w, viewport.h, viewport.mobile);
  await page.goto(stack.webUrl);
  try {
    await page.waitFor("!!document.querySelector('.zui-hud') && !!document.querySelector('.app-world canvas')", "HUD and world canvas", 30_000);
  } catch (err) {
    // Say why: an exception or a failed module load is what usually keeps the canvas away.
    const recent = page.console.slice(-10).map((e) => `  [${e.kind}] ${e.text.slice(0, 300)}`).join("\n");
    throw new Error(`${err instanceof Error ? err.message : String(err)}\nRecent page console:\n${recent || "  (none)"}`);
  }
}

export const hudStatus = (page: Page, label: "Hermes" | "Telegram") =>
  page.eval<string | null>(`document.querySelector('.zui-dot-item[title^="${label}:"]')?.getAttribute('title') ?? null`);

export const approvalsBadge = (page: Page) =>
  page.eval<string | null>(`document.querySelector('.zui-hud .zui-count--alert')?.textContent ?? null`);

/** Console errors that matter (Chrome's favicon 404 on the Vite dev server is noise). */
export const realErrors = (page: Page) => page.console.filter((e) => !/favicon\.ico/.test(e.text));
