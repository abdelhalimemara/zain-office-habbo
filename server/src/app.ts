import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { localOnly } from "./guard";
import { HermesClient } from "./hermes/client";
import { HeadcountSource } from "./headcount/catalog";
import { health } from "./health";
import { HttpError, errorResponse, optionalString, readJsonObject, requiredString, taskIdParam } from "./http";
import { hire, parseHireRequest } from "./org/hire";
import { fullRoster, type HireStore } from "./org/hireStore";
import { mergeRoster } from "./org/rosterView";
import { UI_AUTHOR, approve, createMandate, parseMandate, reject, taskDetail } from "./org/tasks";

export interface AppDeps {
  hermes: HermesClient;
  headcount: HeadcountSource;
  hires: HireStore;
}

const MAX_BODY_BYTES = 128 * 1024;

export function createApp(deps: AppDeps): Hono {
  const { hermes, headcount, hires } = deps;
  const app = new Hono();

  app.use("/api/*", localOnly);
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

  app.get("/api/health", async (c) => c.json(await health(hermes)));

  app.get("/api/board", async (c) => c.json(await hermes.board()));

  app.get("/api/tasks/:id", async (c) => c.json(await taskDetail(taskIdParam(c), hermes)));

  app.post("/api/tasks/:id/comments", async (c) => {
    const id = taskIdParam(c);
    const body = requiredString(await readJsonObject(c), "body", 1, 20_000);
    await hermes.addComment(id, body, UI_AUTHOR);
    return c.json(await taskDetail(id, hermes), 201);
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
}

export function defaultClients(env: Env): Pick<AppDeps, "hermes" | "headcount"> {
  return {
    hermes: new HermesClient({ baseUrl: env.HERMES_URL, token: env.HERMES_SESSION_TOKEN }),
    headcount: new HeadcountSource(),
  };
}
