import { join } from "node:path";
import { hermesHome } from "../../clientChannels/hermesPaths";
import { readEnvKey, redact } from "../../connections/run";
import type { FetchLike } from "../../hermes/client";

const BASE = "https://api.apify.com/v2";
const REQUEST_TIMEOUT_MS = 90_000;
/** Each poll asks Apify to hold the request until the run ends, for at most this long. */
const WAIT_SECONDS = 60;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

export const APIFY_NOT_CONNECTED = "Apify is not connected";

export class ApifyError extends Error {}

export interface ActorRunOptions {
  /** Hard limits passed to Apify: results and spend for pay-per-result/event actors. */
  maxItems: number;
  maxTotalChargeUsd: number;
  /** Run timeout on Apify's side; we stop waiting (and abort) a little after it. */
  timeoutSecs: number;
  memoryMbytes?: number;
}

export interface ActorRunResult {
  items: Record<string, unknown>[];
  /** What Apify reports for the run, USD. */
  costUsd: number;
}

/** Runs one actor and returns its dataset; the audit steps depend on this, never on fetch. */
export interface ActorRunner {
  run(actor: string, input: Record<string, unknown>, options: ActorRunOptions): Promise<ActorRunResult>;
}

/** Reads APIFY_TOKEN from the default Hermes profile's .env at call time; it only ever goes into a header. */
export function envApifyToken(home = hermesHome()): () => Promise<string | null> {
  return () => readEnvKey(join(home, ".env"), "APIFY_TOKEN");
}

interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
  statusMessage?: string;
}

/**
 * Starts the run and waits on it (`waitForFinish`, then polling), rather than run-sync-get-dataset-items:
 * the run object carries the spend that the per-audit cost cap needs, and long crawls outlive the
 * 300 s sync limit. A run that overstays its timeout is aborted.
 */
export class ApifyClient implements ActorRunner {
  constructor(
    private readonly token: () => Promise<string | null>,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async connected(): Promise<boolean> {
    return !!(await this.token());
  }

  async run(actor: string, input: Record<string, unknown>, options: ActorRunOptions): Promise<ActorRunResult> {
    const token = await this.token();
    if (!token) throw new ApifyError(APIFY_NOT_CONNECTED);
    const query = new URLSearchParams({
      waitForFinish: String(WAIT_SECONDS),
      timeout: String(options.timeoutSecs),
      maxItems: String(options.maxItems),
      maxTotalChargeUsd: options.maxTotalChargeUsd.toFixed(2),
      ...(options.memoryMbytes ? { memory: String(options.memoryMbytes) } : {}),
    });
    let run = await this.call<ApifyRun>(token, "POST", `/acts/${actor.replace("/", "~")}/runs?${query}`, input);
    const deadline = Date.now() + (options.timeoutSecs + 120) * 1000;
    while (!TERMINAL.has(run.status)) {
      if (Date.now() > deadline) {
        await this.call(token, "POST", `/actor-runs/${run.id}/abort`).catch(() => undefined);
        throw new ApifyError(`${actor} did not finish in time`);
      }
      await this.sleep(1000);
      run = await this.call<ApifyRun>(token, "GET", `/actor-runs/${run.id}?waitForFinish=${WAIT_SECONDS}`);
    }
    const costUsd = run.usageTotalUsd ?? 0;
    // A timed-out run still keeps what it scraped; failures and aborts are errors.
    if (run.status !== "SUCCEEDED" && run.status !== "TIMED-OUT") {
      throw Object.assign(new ApifyError(`${actor} ${run.status.toLowerCase()}${run.statusMessage ? `: ${redact(run.statusMessage)}` : ""}`), { costUsd });
    }
    const items = await this.call<Record<string, unknown>[]>(token, "GET", `/datasets/${run.defaultDatasetId}/items?clean=true&limit=${options.maxItems}`);
    return { items: Array.isArray(items) ? items : [], costUsd };
  }

  private async call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ApifyError(`Apify unreachable (${err instanceof Error ? err.name : "error"})`);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new ApifyError(`Apify answered HTTP ${res.status} with a non-JSON body`);
    }
    if (res.status === 401 || res.status === 403) throw new ApifyError("Apify rejected the token");
    if (!res.ok) {
      const message = (data as { error?: { message?: string } }).error?.message ?? res.statusText;
      throw new ApifyError(`Apify ${res.status}: ${redact(message, [token])}`);
    }
    // Run endpoints wrap the run in { data }; dataset items are a bare array.
    return (Array.isArray(data) ? data : ((data as { data?: unknown }).data ?? data)) as T;
  }
}
