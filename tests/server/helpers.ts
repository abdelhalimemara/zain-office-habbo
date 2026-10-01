import { createApp } from "../../server/src/app";
import { HeadcountSource } from "../../server/src/headcount/catalog";
import { HermesClient, type FetchLike } from "../../server/src/hermes/client";
import { memoryHireStore, type HireStore } from "../../server/src/org/hireStore";
import type { KanbanTask } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";

export const TOKEN = "tok-secret-123";
export const KANBAN = "/api/plugins/kanban";

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  auth: string | null;
}

export type Handler = (call: Call, n: number) => Response | unknown | Promise<Response | unknown>;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch stub routed on `METHOD /path`; unrouted requests answer 404 like Hermes. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url.pathname}`;
    const headers = new Headers(init?.headers);
    const call: Call = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      auth: headers.get("Authorization"),
    };
    calls.push(call);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const handler = routes[key];
    if (!handler) return json({ detail: `no route ${key}` }, 404);
    const out = await handler(call, n);
    return out instanceof Response ? out : json(out);
  };
  return { fetchImpl, calls, called: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key) };
}

export const dashboardHtml = (token = TOKEN) =>
  new Response(`<html><script>window.__HERMES_SESSION_TOKEN__="${token}";</script></html>`);

export const hermesBase: Record<string, Handler> = {
  "GET /": () => dashboardHtml(),
  [`GET ${KANBAN}/boards`]: () => ({ boards: [{ slug: "default" }, { slug: "zain-group" }], current: "default" }),
};

export function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "t_abc",
    title: "Launch campaign",
    body: null,
    assignee: "zain-growth-vp",
    status: "review",
    priority: 0,
    created_by: "dashboard",
    created_at: 1,
    started_at: null,
    completed_at: null,
    tenant: "zain-growth",
    result: "Rolled-up result",
    ...overrides,
  };
}

function skillMarkdown(skill: string): string {
  return `---\nname: ${skill}\ndescription: Long upstream description for ${skill}. Use it often.\n---\n\n# ${skill}\n\nDo the thing well.\n`;
}

export function githubFetch(options: { down?: boolean } = {}) {
  const tree = [
    ...new Set(ROSTER.flatMap((a) => a.skills)),
    "security:incident-response",
  ].map((id) => {
    const [dept, skill] = id.split(":");
    return { path: `plugins/${dept}/skills/${skill}/SKILL.md`, type: "blob" };
  });
  return mockFetch({
    "GET /repos/cbrock84/headcount/git/trees/main": () =>
      options.down ? json({ message: "rate limited" }, 403) : { tree: [{ path: "README.md", type: "blob" }, ...tree] },
    ...Object.fromEntries(
      tree.map(({ path }) => [
        `GET /cbrock84/headcount/main/${path}`,
        () => new Response(skillMarkdown(path.split("/")[3]!)),
      ]),
    ),
  });
}

export function setup(routes: Record<string, Handler>, options: { hires?: HireStore; githubDown?: boolean } = {}) {
  const hermesFetch = mockFetch({ ...hermesBase, ...routes });
  const gh = githubFetch({ down: options.githubDown });
  const hermes = new HermesClient({ baseUrl: "http://hermes.test", fetchImpl: hermesFetch.fetchImpl });
  const headcount = new HeadcountSource({ fetchImpl: gh.fetchImpl });
  const hires = options.hires ?? memoryHireStore();
  const app = createApp({ hermes, headcount, hires });
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return { app, send, hermes, headcount, hires, hermesFetch, gh };
}
