import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { RosterEntry } from "@shared/api";
import type { KanbanBoard, KanbanTask } from "@shared/hermes";
import { ROSTER } from "@shared/roster";
import { initialUiState, useUiStore } from "../../src/state/store";

export const NOW = 1_700_000_000;

export function task(partial: Partial<KanbanTask> & { id: string }): KanbanTask {
  return {
    title: `Task ${partial.id}`,
    body: null,
    assignee: null,
    status: "todo",
    priority: 1,
    created_by: null,
    created_at: NOW - 7200,
    started_at: null,
    completed_at: null,
    tenant: "zain-studio",
    result: null,
    ...partial,
  };
}

export function board(tasks: KanbanTask[]): KanbanBoard {
  const names = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"] as const;
  return {
    columns: names.map((name) => ({ name, tasks: tasks.filter((t) => t.status === name) })),
    tenants: [],
    assignees: [],
    latest_event_id: 1,
    now: NOW,
  };
}

export const rosterEntries: RosterEntry[] = ROSTER.map((a) => ({ ...a, hired: a.profile !== "zain-studio-ux", model: null }));

type Handler = (init: RequestInit | undefined, url: string) => unknown;

export interface MockFetch {
  fn: ReturnType<typeof vi.fn>;
  calls: (method: string, path: string) => { body: unknown }[];
}

export function mockFetch(routes: Record<string, Handler | unknown>): MockFetch {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? "GET"} ${url}`;
    const route = key in routes ? routes[key] : routes[url];
    if (route === undefined) return new Response(JSON.stringify({ error: `no route ${key}` }), { status: 404 });
    const data = typeof route === "function" ? (route as Handler)(init, url) : route;
    if (data instanceof Response) return data;
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return {
    fn,
    calls: (method, path) =>
      fn.mock.calls
        .filter(([u, i]) => String(u) === path && ((i as RequestInit | undefined)?.method ?? "GET") === method)
        .map(([, i]) => ({ body: (i as RequestInit | undefined)?.body ? JSON.parse(String((i as RequestInit).body)) : undefined })),
  };
}

export function renderUi(ui: ReactElement) {
  focusManager.setFocused(false);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

export function resetStore() {
  useUiStore.setState(initialUiState);
}
