import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ReconcilerStatus } from "../../shared/api";
import { localOnly, parseOriginList, type GuardOptions } from "./guard";
import { HermesClient } from "./hermes/client";
import { HeadcountSource } from "./headcount/catalog";
import { health } from "./health";
import { HttpError, errorResponse, optionalString, readJsonObject, requiredString, taskIdParam } from "./http";
import { boardWithProgress } from "./org/board";
import { hire, parseHireRequest } from "./org/hire";
import { fullRoster, type HireStore } from "./org/hireStore";
import { mergeRoster } from "./org/rosterView";
import { UI_AUTHOR, approve, createMandate, parseMandate, reject, reopen, taskDetail } from "./org/tasks";

export interface AppDeps {
  hermes: HermesClient;
  headcount: HeadcountSource;
  hires: HireStore;
  guard?: GuardOptions;
  /** Status of the background dependency reconciler, when one runs alongside the app. */
  reconcilerStatus?: () => ReconcilerStatus;
}

export const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 128 * 1024;

export function createApp(deps: AppDeps): Hono {
  const { hermes, headcount, hires, guard = { port: DEFAULT_PORT } } = deps;
  const app = new Hono();

  app.use("/api/*", localOnly(guard));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new HttpError(413, "request body too large");
      },
    }),
  );
  app.onError(errorResponse);

  app.get("/api/health", async (c) => c.json(await health(hermes, deps.reconcilerStatus)));

  app.get("/api/board", async (c) => c.json(await boardWithProgress(hermes, hires)));

  app.get("/api/tasks/:id", async (c) => c.json(await taskDetail(taskIdParam(c), hermes, hires)));

  app.post("/api/tasks/:id/comments", async (c) => {
    const id = taskIdParam(c);
    const body = requiredString(await readJsonObject(c), "body", 1, 20_000);
    await hermes.addComment(id, body, UI_AUTHOR);
    return c.json(await taskDetail(id, hermes, hires), 201);
  });

  app.post("/api/mandates", async (c) => {
    const req = parseMandate(await readJsonObject(c));
    return c.json(await createMandate(req, hermes, hires), 201);
  });

  app.post("/api/approvals/:id/approve", async (c) => {
    const id = taskIdParam(c);
    const note = optionalString(await readJsonObject(c), "note", 2000);
    return c.json({ task: await approve(id, note, hermes) });
  });

  app.post("/api/approvals/:id/reject", async (c) => {
    const id = taskIdParam(c);
    const reason = requiredString(await readJsonObject(c), "reason", 1, 2000);
    return c.json({ task: await reject(id, reason, hermes, hires) });
  });

  app.post("/api/tasks/:id/reopen", async (c) => {
    const id = taskIdParam(c);
    const instructions = requiredString(await readJsonObject(c), "instructions", 1, 4000);
    return c.json({ task: await reopen(id, instructions, hermes, hires) });
  });

  app.get("/api/roster", async (c) => {
    const [roster, profiles] = await Promise.all([fullRoster(hires), hermes.listProfiles()]);
    return c.json(mergeRoster(roster, profiles));
  });

  app.post("/api/hire", async (c) => {
    const agent = await parseHireRequest(await readJsonObject(c), { headcount, hires });
    const result = await hire(agent, { hermes, headcount, hires });
    return c.json(result);
  });

  app.get("/api/headcount/catalog", async (c) => c.json(await headcount.catalog()));

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return app;
}

export interface Env {
  HERMES_URL?: string;
  HERMES_SESSION_TOKEN?: string;
  HEADCOUNT_REF?: string;
  ZAIN_ALLOWED_ORIGINS?: string;
}

export function guardOptions(port: number, env: Env): GuardOptions {
  return { port, extraOrigins: parseOriginList(env.ZAIN_ALLOWED_ORIGINS) };
}

export function defaultClients(env: Env): Pick<AppDeps, "hermes" | "headcount"> {
  return {
    hermes: new HermesClient({ baseUrl: env.HERMES_URL, token: env.HERMES_SESSION_TOKEN }),
    headcount: new HeadcountSource({ ref: env.HEADCOUNT_REF }),
  };
}
