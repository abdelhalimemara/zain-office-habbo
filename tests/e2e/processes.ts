import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ports the live app or the real Hermes may be using; tests must never bind or call them. */
const RESERVED = new Set([5173, 8787, 9119]);

export async function freePort(): Promise<number> {
  for (;;) {
    const port = await anyPort();
    if (!RESERVED.has(port)) return port;
  }
}

async function anyPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("could not allocate a port");
  return address.port;
}

export interface Managed {
  name: string;
  child: ChildProcess;
  /** Last ~16KB of combined stdout/stderr, for failure messages. */
  output(): string;
  stop(): Promise<void>;
}

/** Spawns in its own process group so stop() takes down grandchildren (tsx → node, Chrome helpers). */
export function launch(name: string, command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): Managed {
  const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const append = (chunk: Buffer) => {
    log = (log + chunk.toString("utf8")).slice(-16_384);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const signal = (sig: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, sig);
    } catch {
      /* already gone */
    }
  };
  return {
    name,
    child,
    output: () => log,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        signal("SIGKILL");
        return;
      }
      signal("SIGTERM");
      const done = await Promise.race([exited.then(() => true), sleep(4000).then(() => false)]);
      signal("SIGKILL");
      if (!done) await Promise.race([exited, sleep(2000)]);
    },
  };
}

export async function waitForHttp(url: string, proc: Managed, timeoutMs = 60_000, init?: RequestInit): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    if (proc.child.exitCode !== null) throw new Error(`${proc.name} exited early (${proc.child.exitCode}):\n${proc.output()}`);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(200);
  }
  throw new Error(`${proc.name} not ready at ${url} after ${timeoutMs}ms (${last}):\n${proc.output()}`);
}

/** Polls a Node-side condition (e.g. fake Hermes state) until it is truthy. */
export async function until<T>(check: () => T | Promise<T>, what: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(100);
  }
}
