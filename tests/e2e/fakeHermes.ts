import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { KANBAN_BOARD } from "../../shared/divisions";
import { TASK_STATUSES, type HermesProfile, type KanbanComment, type KanbanTask, type TaskStatus } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";

/**
 * In-memory stand-in for the Hermes dashboard API (the subset server/src/hermes/client.ts calls).
 * Only GET / and GET /api/status are public; everything else needs the scraped Bearer token, and
 * every kanban task route must be pinned to ?board=zain-group like the real plugin.
 */

export interface FakeCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  auth: string | null;
}

export interface FakeSkill {
  name: string;
  content: string;
  category: string;
  profile: string;
}

interface Reply {
  status: number;
  body: unknown;
}

const KANBAN = "/api/plugins/kanban";

export interface FakeHomeChannel {
  platform: string;
  chat_id: string;
  thread_id: string;
  chat_type: string | null;
  name?: string;
}

/** What `/sethome` in a private Telegram chat leaves behind (older builds record no chat_type). */
export const TELEGRAM_HOME: FakeHomeChannel = { platform: "telegram", chat_id: "12345", thread_id: "", chat_type: null };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const fail = (status: number, detail: string): Reply => ({ status, body: { detail } });

function profile(name: string, description = ""): HermesProfile {
  return { name, is_default: name === "default", model: "claude-sonnet-5-5", provider: "anthropic", description, skill_count: 0 };
}

export class FakeHermes {
  /** Mutable so a test can rotate it like a Hermes restart would. */
  token = "fake-hermes-session-token-e2e";
  readonly calls: FakeCall[] = [];
  readonly tasks = new Map<string, KanbanTask>();
  readonly comments = new Map<string, KanbanComment[]>();
  readonly profiles: HermesProfile[];
  readonly souls = new Map<string, string>();
  readonly descriptions = new Map<string, string>();
  readonly skills: FakeSkill[] = [];
  readonly boards: string[] = ["default"];
  telegramState: string | null = "connected";
  /** kanban.review_dispatch in GET /api/config; undefined leaves the key out (Hermes' default: on). */
  reviewDispatch: boolean | undefined = false;
  /** GET /api/plugins/kanban/home-channels; null = no /sethome yet. */
  telegramHome: FakeHomeChannel | null = null;
  /** Task id → ids of its parents (the tasks it waits on). */
  readonly parents = new Map<string, string[]>();
  private server: Server | null = null;
  private seq = 0;
  private eventId = 0;
  private commentSeq = 0;
  private port = 0;

  constructor(hiredProfiles: readonly string[] = ROSTER.map((a) => a.profile)) {
    this.profiles = hiredProfiles.map((n) => profile(n));
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(port = 0): Promise<string> {
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this.url;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Test hook: what an agent (e.g. the VP rolling up a mandate) would do to a task. */
  setStatus(id: string, status: TaskStatus, extra: Partial<KanbanTask> = {}): KanbanTask {
    const task = this.requireTask(id);
    Object.assign(task, extra, { status });
    if (status === "done") task.completed_at = this.now();
    this.eventId++;
    return task;
  }

  /** Test hook: put a task on the board as if Hermes had created it. */
  seedTask(input: Partial<KanbanTask> & Pick<KanbanTask, "title">): KanbanTask {
    const task = this.newTask(input);
    Object.assign(task, input);
    return task;
  }

  /** Test hook: kanban_link(parent_id, child_id) — the child waits on the parent. */
  link(parentId: string, childId: string): void {
    const parent = this.requireTask(parentId);
    const child = this.requireTask(childId);
    this.parents.set(childId, [...(this.parents.get(childId) ?? []), parentId]);
    child.link_counts = { parents: (child.link_counts?.parents ?? 0) + 1, children: child.link_counts?.children ?? 0 };
    parent.link_counts = { parents: parent.link_counts?.parents ?? 0, children: (parent.link_counts?.children ?? 0) + 1 };
    this.eventId++;
  }

  /**
   * Test hook: what the VP does per the mandate protocol — kanban_create team subtasks, link each as
   * a parent of the mandate, then kanban_block(kind="dependency").
   */
  fanOut(mandateId: string, subtasks: { title: string; assignee: string }[]): KanbanTask[] {
    const mandate = this.requireTask(mandateId);
    const created = subtasks.map((s) => this.newTask({ ...s, tenant: mandate.tenant, created_by: mandate.assignee }));
    for (const t of created) this.link(t.id, mandateId);
    this.setStatus(mandateId, "blocked");
    return created;
  }

  /** Test hook: kanban_complete; a dependency-blocked child resumes (→ ready) once all its parents are done. */
  complete(id: string, result: string): void {
    this.setStatus(id, "done", { result });
    for (const [child, parents] of this.parents) {
      if (!parents.includes(id)) continue;
      const task = this.requireTask(child);
      if (task.status === "blocked" && parents.every((p) => this.tasks.get(p)?.status === "done")) task.status = "ready";
    }
  }

  /** Test hook: kanban_request_review writes the summary only, not `result`. */
  requestReview(id: string, summary: string): void {
    this.setStatus(id, "review", { latest_summary: summary });
  }

  called(method: string, path: string | RegExp): FakeCall[] {
    return this.calls.filter((c) => c.method === method && (typeof path === "string" ? c.path === path : path.test(c.path)));
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }

  private requireTask(id: string): KanbanTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`fake Hermes has no task ${id}`);
    return task;
  }

  private newTask(input: Partial<KanbanTask> & { title: string; triage?: boolean }): KanbanTask {
    const id = `t_e2e${String(++this.seq).padStart(4, "0")}`;
    const task: KanbanTask = {
      id,
      title: input.title,
      body: input.body ?? null,
      assignee: input.assignee ?? null,
      status: input.triage ? "triage" : input.assignee ? "ready" : "todo",
      priority: input.priority ?? 0,
      created_by: input.created_by ?? "zain-hq",
      created_at: this.now(),
      started_at: null,
      completed_at: null,
      tenant: input.tenant ?? null,
      result: null,
      latest_summary: null,
      comment_count: 0,
      link_counts: { parents: 0, children: 0 },
      progress: null,
    };
    this.tasks.set(id, task);
    this.comments.set(id, []);
    this.eventId++;
    return task;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://fake-hermes");
    const raw = await new Promise<string>((resolve) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (data += chunk));
      req.on("end", () => resolve(data));
    });
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const call: FakeCall = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body,
      auth: req.headers.authorization ?? null,
    };
    this.calls.push(call);

    if (call.method === "GET" && call.path === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><head><script>window.__HERMES_SESSION_TOKEN__="${this.token}";</script></head><body>Hermes</body></html>`);
      return;
    }
    const reply = this.route(call);
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  }

  private route(call: FakeCall): Reply {
    const { method, path } = call;
    if (method === "GET" && path === "/api/status") {
      return ok({ version: "fake", gateway_platforms: { telegram: this.telegramState ? { state: this.telegramState } : undefined } });
    }
    if (call.auth !== `Bearer ${this.token}`) return fail(401, "Unauthorized");
    const body = (call.body ?? {}) as Record<string, unknown>;

    if (path === "/api/config" && method === "GET") {
      return ok({ model: "claude-sonnet-5-5", kanban: this.reviewDispatch === undefined ? {} : { review_dispatch: this.reviewDispatch } });
    }

    if (path === "/api/profiles" && method === "GET") return ok({ profiles: this.profiles });
    if (path === "/api/profiles" && method === "POST") {
      const name = String(body.name ?? "");
      if (!name) return fail(400, "name is required");
      if (this.profiles.some((p) => p.name === name)) return fail(409, `profile ${name} already exists`);
      this.profiles.push(profile(name, String(body.description ?? "")));
      return ok({ profile: name }, 201);
    }
    const prof = /^\/api\/profiles\/([^/]+)\/(soul|description)$/.exec(path);
    if (prof && method === "PUT") {
      const name = decodeURIComponent(prof[1]!);
      const p = this.profiles.find((x) => x.name === name);
      if (!p) return fail(404, `no profile ${name}`);
      if (prof[2] === "soul") this.souls.set(name, String(body.content ?? ""));
      else {
        p.description = String(body.description ?? "");
        this.descriptions.set(name, p.description);
      }
      return ok({ ok: true });
    }
    if (path === "/api/skills" && method === "POST") {
      const skill = body as unknown as FakeSkill;
      if (!this.profiles.some((p) => p.name === skill.profile)) return fail(404, `no profile ${skill.profile}`);
      if (this.skills.some((s) => s.profile === skill.profile && s.name === skill.name)) {
        return fail(400, `Skill '${skill.name}' already exists`);
      }
      this.skills.push(skill);
      return ok({ ok: true }, 201);
    }

    if (path === `${KANBAN}/home-channels` && method === "GET") {
      return ok({ home_channels: this.telegramHome ? [{ name: "Home", ...this.telegramHome }] : [] });
    }
    if (path === `${KANBAN}/boards` && method === "GET") {
      return ok({ boards: this.boards.map((slug) => ({ slug, name: slug })), current: "default" });
    }
    if (path === `${KANBAN}/boards` && method === "POST") {
      const slug = String(body.slug ?? "");
      if (this.boards.includes(slug)) return fail(400, `board ${slug} already exists`);
      this.boards.push(slug);
      return ok({ board: { slug } }, 201);
    }
    if (path.startsWith(`${KANBAN}/`)) return this.kanban(call, path.slice(KANBAN.length), body);
    return fail(404, `fake Hermes has no route ${method} ${path}`);
  }

  private kanban(call: FakeCall, path: string, body: Record<string, unknown>): Reply {
    const board = call.query.get("board");
    if (board !== KANBAN_BOARD) return fail(400, `expected ?board=${KANBAN_BOARD}, got ${board}`);
    if (!this.boards.includes(board)) return fail(404, `board ${board} does not exist`);
    const { method } = call;

    if (path === "/board" && method === "GET") {
      const all = [...this.tasks.values()];
      return ok({
        columns: TASK_STATUSES.map((name) => ({ name, tasks: all.filter((t) => t.status === name) })),
        tenants: [...new Set(all.map((t) => t.tenant).filter(Boolean))],
        assignees: [...new Set(all.map((t) => t.assignee).filter(Boolean))],
        latest_event_id: this.eventId,
        now: this.now(),
      });
    }
    if (path === "/tasks" && method === "POST") {
      if (typeof body.title !== "string" || !body.title.trim()) return fail(400, "title is required");
      return ok({ task: this.newTask(body as Partial<KanbanTask> & { title: string; triage?: boolean }) }, 201);
    }
    const m = /^\/tasks\/([^/]+)(\/comments)?$/.exec(path);
    if (!m) return fail(404, `fake Hermes has no kanban route ${method} ${path}`);
    const id = decodeURIComponent(m[1]!);
    const task = this.tasks.get(id);
    if (!task) return fail(404, `task ${id} not found`);

    if (!m[2] && method === "GET") {
      const parents = this.parents.get(id) ?? [];
      const children = [...this.parents].filter(([, ps]) => ps.includes(id)).map(([child]) => child);
      const linkTasks = [...parents, ...children].flatMap((l) => {
        const t = this.tasks.get(l);
        return t ? [{ id: t.id, title: t.title, status: t.status }] : [];
      });
      return ok({ task, comments: this.comments.get(id) ?? [], links: { parents, children }, link_tasks: linkTasks });
    }
    if (!m[2] && method === "PATCH") return this.patch(task, body);
    if (m[2] === "/comments" && method === "POST") {
      const comment: KanbanComment = {
        id: ++this.commentSeq,
        task_id: id,
        author: String(body.author ?? "unknown"),
        body: String(body.body ?? ""),
        created_at: this.now(),
      };
      this.comments.get(id)!.push(comment);
      task.comment_count = (task.comment_count ?? 0) + 1;
      this.eventId++;
      return ok({ comment }, 201);
    }
    return fail(405, `method ${method} not allowed on ${path}`);
  }

  /** review→done is complete_task (overwrites result); review→todo is reopen_review_task (lands in ready). */
  private patch(task: KanbanTask, body: Record<string, unknown>): Reply {
    const status = body.status as TaskStatus | undefined;
    if (status !== undefined) {
      if (![...TASK_STATUSES, "archived"].includes(status)) return fail(400, `invalid status ${String(status)}`);
      if (status === "done") {
        if (task.status === "done") return fail(409, "task is already done");
        task.status = "done";
        task.completed_at = this.now();
        task.result = typeof body.result === "string" ? body.result : null;
        if (typeof body.summary === "string") task.latest_summary = body.summary;
      } else if (status === "todo" && task.status === "review") {
        task.status = "ready";
      } else {
        task.status = status;
      }
    }
    if (typeof body.assignee === "string") task.assignee = body.assignee;
    if (typeof body.priority === "number") task.priority = body.priority;
    if (typeof body.title === "string") task.title = body.title;
    this.eventId++;
    return ok({ task });
  }
}
