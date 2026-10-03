import { KANBAN_BOARD } from "../../../shared/divisions";
import type {
  CreateTaskInput,
  HermesProfile,
  KanbanBoard,
  KanbanComment,
  KanbanTask,
  TaskStatus,
  UpdateTaskInput,
} from "../../../shared/hermes";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HermesClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  token?: string;
  timeoutMs?: number;
}

/** A Hermes response with a non-2xx status; `detail` is Hermes' own message. */
export class HermesError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Hermes ${status}: ${detail}`);
  }
}

/** Hermes could not be reached at all (connection refused, timeout, malformed dashboard). */
export class HermesUnreachableError extends Error {}

export interface HermesTaskDetail {
  task: KanbanTask;
  comments: KanbanComment[];
  links: { parents: string[]; children: string[] };
  /** One row per linked task (parents and children); archived/foreign rows may be missing. */
  link_tasks?: { id: string; title: string; status: TaskStatus }[];
  /** The task's event log (kanban_db.list_events), oldest first. */
  events?: HermesEvent[];
  /** The task's runs, oldest first; `metadata` is what the worker passed to kanban_complete(metadata=…). */
  runs?: { summary?: string | null; metadata?: unknown }[];
}

export interface HermesEvent {
  id: number;
  task_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
  run_id: number | null;
}

export interface HermesConfig {
  kanban?: { review_dispatch?: unknown } | null;
}

export interface GatewayPlatformState {
  state?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  needs_attention?: boolean | null;
}

export interface HermesStatus {
  gateway_platforms?: Record<string, GatewayPlatformState | undefined> | null;
  gateway_state?: string | null;
  gateway_running?: boolean | null;
}

/** GET /api/mcp/servers entry (hermes_cli/web_server_mcp.py `_mcp_server_summary`; env is redacted). */
export interface McpServer {
  name: string;
  transport: "http" | "stdio" | "unknown";
  url: string | null;
  command: string | null;
  args: string[];
  auth: string | null;
  enabled: boolean;
  source?: string;
}

export interface HomeChannel {
  platform: string;
  chat_id: string;
  thread_id: string;
  name: string;
  /** Newer Hermes builds include it; null when /sethome did not record one. */
  chat_type?: string | null;
}

/** POST /api/cron/jobs body (hermes_cli/web_models.py CronJobCreate). */
export interface CronJobSpec {
  name: string;
  schedule: string;
  prompt: string;
  deliver: string;
  skills: string[];
  enabled_toolsets: string[];
}

/** A stored job (cron/jobs.py create_job). */
export interface CronJob {
  id: string;
  name?: string;
  prompt?: string;
  schedule_display?: string;
  deliver?: string;
  skills?: string[] | null;
  enabled_toolsets?: string[] | null;
  state?: string;
  enabled?: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
}

/** hermes_cli/web_server_messaging.py `_whatsapp_onboarding_payload`. */
export interface WhatsAppOnboarding {
  pairing_id: string;
  status: "starting" | "installing" | "waiting" | "connected" | "error" | "expired" | "cancelled";
  qr_payload: string | null;
  expires_at: string | null;
  account_phone?: string | null;
  error?: string | null;
}

export interface ProfileCreateInput {
  name: string;
  clone_from: string;
  clone_channels: boolean;
  description: string;
}

export interface SkillCreateInput {
  name: string;
  content: string;
  category: string;
  profile: string;
}

const TOKEN_PATTERN = /SESSION_TOKEN__="([^"]+)"/;
const KANBAN = "/api/plugins/kanban";

export class HermesClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly fixedToken: string | undefined;
  private token: Promise<string> | undefined;
  private boardReady: Promise<void> | undefined;

  constructor(options: HermesClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:9119").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fixedToken = options.token || undefined;
  }

  async status(): Promise<HermesStatus> {
    const res = await this.send("/api/status", { method: "GET" });
    return (await this.parse(res)) as HermesStatus;
  }

  async config(): Promise<HermesConfig> {
    return this.request<HermesConfig>("GET", "/api/config");
  }

  /** A profile's config.yaml merged with Hermes defaults. */
  async profileConfig(profile: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/api/config?profile=${encodeURIComponent(profile)}`);
  }

  /** Deep-merges `config` into the profile's config.yaml (lists are replaced, not merged). */
  async mergeConfig(profile: string, config: Record<string, unknown>): Promise<void> {
    await this.request("PUT", "/api/config", { config, profile });
  }

  async setEnv(profile: string, key: string, value: string): Promise<void> {
    await this.request("PUT", "/api/env", { key, value, profile });
  }

  async mcpServers(profile?: string): Promise<McpServer[]> {
    const query = profile ? `?profile=${encodeURIComponent(profile)}` : "";
    return (await this.request<{ servers?: McpServer[] }>("GET", `/api/mcp/servers${query}`)).servers ?? [];
  }

  async cronJobs(profile: string): Promise<CronJob[]> {
    const data = await this.request<CronJob[] | { jobs?: CronJob[] }>("GET", `/api/cron/jobs?profile=${encodeURIComponent(profile)}`);
    return Array.isArray(data) ? data : (data.jobs ?? []);
  }

  async createCronJob(profile: string, job: CronJobSpec): Promise<CronJob> {
    return this.request("POST", `/api/cron/jobs?profile=${encodeURIComponent(profile)}`, job);
  }

  async updateCronJob(profile: string, id: string, updates: Partial<CronJobSpec>): Promise<CronJob> {
    return this.request("PUT", `/api/cron/jobs/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`, { updates });
  }

  /** gateway_platforms from the unauthenticated status endpoint. */
  async gatewayPlatforms(): Promise<Record<string, { state?: string | null } | undefined>> {
    return (await this.status()).gateway_platforms ?? {};
  }

  async whatsappOnboardingStart(body: { mode: "bot" | "self-chat"; allowed_users: string; profile: string | null }): Promise<WhatsAppOnboarding> {
    return this.request("POST", "/api/messaging/whatsapp/onboarding/start", body);
  }

  async whatsappOnboardingStatus(pairingId: string): Promise<WhatsAppOnboarding> {
    return this.request("GET", `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`);
  }

  async whatsappOnboardingApply(pairingId: string, body: { mode: "bot" | "self-chat"; profile: string | null }): Promise<{ ok: boolean; needs_restart?: boolean }> {
    return this.request("POST", `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`, body);
  }

  async whatsappOnboardingCancel(pairingId: string): Promise<void> {
    await this.request("DELETE", `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`);
  }

  async listProfiles(): Promise<HermesProfile[]> {
    const data = await this.request<{ profiles: HermesProfile[] }>("GET", "/api/profiles");
    return data.profiles;
  }

  async createProfile(input: ProfileCreateInput): Promise<void> {
    await this.request("POST", "/api/profiles", input);
  }

  async readSoul(profile: string): Promise<string> {
    const data = await this.request<{ content: string }>("GET", `/api/profiles/${encodeURIComponent(profile)}/soul`);
    return data.content ?? "";
  }

  /** Gateway platforms with a home channel (set by /sethome in the messenger). */
  async homeChannels(): Promise<HomeChannel[]> {
    const data = await this.request<{ home_channels?: HomeChannel[] }>("GET", `${KANBAN}/home-channels`);
    return data.home_channels ?? [];
  }

  async writeSoul(profile: string, content: string): Promise<void> {
    await this.request("PUT", `/api/profiles/${encodeURIComponent(profile)}/soul`, { content });
  }

  async setDescription(profile: string, description: string): Promise<void> {
    await this.request("PUT", `/api/profiles/${encodeURIComponent(profile)}/description`, { description });
  }

  async createSkill(input: SkillCreateInput): Promise<void> {
    await this.request("POST", "/api/skills", input);
  }

  /** Names of the profile's enabled skills (GET /api/skills leaves disabled ones out). */
  async listSkills(profile: string): Promise<string[]> {
    const data = await this.request<{ name?: unknown }[]>("GET", `/api/skills?profile=${encodeURIComponent(profile)}`);
    return (Array.isArray(data) ? data : []).flatMap((s) => (typeof s?.name === "string" ? [s.name] : []));
  }

  /** Absolute path of a profile skill's SKILL.md on the Hermes host. */
  async skillPath(profile: string, name: string): Promise<string> {
    const query = `name=${encodeURIComponent(name)}&profile=${encodeURIComponent(profile)}`;
    const data = await this.request<{ path?: unknown }>("GET", `/api/skills/content?${query}`);
    if (typeof data.path !== "string") throw new Error(`Hermes gave no path for skill ${name}`);
    return data.path;
  }

  async ensureBoard(): Promise<void> {
    this.boardReady ??= this.createBoardIfMissing().catch((err: unknown) => {
      this.boardReady = undefined;
      throw err;
    });
    return this.boardReady;
  }

  async board(): Promise<KanbanBoard> {
    await this.ensureBoard();
    return this.request<KanbanBoard>("GET", this.kanban("/board"));
  }

  async task(id: string): Promise<HermesTaskDetail> {
    await this.ensureBoard();
    return this.request<HermesTaskDetail>("GET", this.kanban(`/tasks/${encodeURIComponent(id)}`));
  }

  async createTask(input: CreateTaskInput): Promise<KanbanTask> {
    await this.ensureBoard();
    const data = await this.request<{ task: KanbanTask }>("POST", this.kanban("/tasks"), input);
    return data.task;
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<KanbanTask> {
    await this.ensureBoard();
    const data = await this.request<{ task: KanbanTask }>("PATCH", this.kanban(`/tasks/${encodeURIComponent(id)}`), input);
    return data.task;
  }

  async addComment(id: string, body: string, author: string): Promise<void> {
    await this.ensureBoard();
    await this.request("POST", this.kanban(`/tasks/${encodeURIComponent(id)}/comments`), { body, author });
  }

  /** `parent` must finish before `child` can promote. */
  async link(parent: string, child: string): Promise<void> {
    await this.ensureBoard();
    await this.request("POST", this.kanban("/links"), { parent_id: parent, child_id: child });
  }

  async unlink(parent: string, child: string): Promise<void> {
    await this.ensureBoard();
    const edge = `&parent_id=${encodeURIComponent(parent)}&child_id=${encodeURIComponent(child)}`;
    await this.request("DELETE", `${this.kanban("/links")}${edge}`);
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.authorized(method, path, body);
    return (await this.parse(res)) as T;
  }

  async boardSlugs(): Promise<string[]> {
    const { boards } = await this.request<{ boards: { slug: string }[] }>("GET", `${KANBAN}/boards`);
    return boards.map((b) => b.slug);
  }

  private async createBoardIfMissing(): Promise<void> {
    if ((await this.boardSlugs()).includes(KANBAN_BOARD)) return;
    await this.request("POST", `${KANBAN}/boards`, {
      slug: KANBAN_BOARD,
      name: "Zain Group",
      description: "Zain Group divisions: HQ mandates, division work and approvals.",
      color: "#F2C230",
      switch: false,
    });
  }

  private kanban(path: string): string {
    return `${KANBAN}${path}?board=${encodeURIComponent(KANBAN_BOARD)}`;
  }

  private async authorized(method: string, path: string, body: unknown): Promise<Response> {
    const first = await this.send(path, this.init(method, await this.currentToken(), body));
    if (first.status !== 401 || this.fixedToken) return first;
    this.token = undefined;
    return this.send(path, this.init(method, await this.currentToken(), body));
  }

  private init(method: string, token: string, body: unknown): RequestInit {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  }

  private async currentToken(): Promise<string> {
    if (this.fixedToken) return this.fixedToken;
    this.token ??= this.scrapeToken().catch((err: unknown) => {
      this.token = undefined;
      throw err;
    });
    return this.token;
  }

  private async scrapeToken(): Promise<string> {
    const res = await this.send("/", { method: "GET" });
    if (!res.ok) throw new HermesError(res.status, "could not load the Hermes dashboard to obtain a session token");
    const match = TOKEN_PATTERN.exec(await res.text());
    if (!match?.[1]) throw new HermesError(401, "Hermes dashboard did not expose a session token");
    return match[1];
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const reason = err instanceof Error ? err.name : "unknown error";
      throw new HermesUnreachableError(`Hermes unreachable at ${this.baseUrl} (${reason})`);
    }
  }

  private async parse(res: Response): Promise<unknown> {
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) throw new HermesError(res.status, detailOf(data) ?? res.statusText ?? "request failed");
    return data;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function detailOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("detail" in data)) return undefined;
  const { detail } = data as { detail: unknown };
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}
