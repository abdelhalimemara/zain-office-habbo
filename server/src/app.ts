import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ReconcilerStatus } from "../../shared/api";
import { VOICE_API } from "../../shared/voice";
import type { ConsultationLog } from "./board/consultLog";
import { dashboardSection, HERMES_DASHBOARD_CHARS, type DashboardReader } from "./board/memory/dashboard";
import { boardLedger, memorySection } from "./board/memory/ledger";
import type { MemoryStore } from "./board/memory/notes";
import { memoryRoutes } from "./board/memory/routes";
import type { MeetingEngine } from "./board/meetings/engine";
import { meetingRoutes } from "./board/meetings/routes";
import type { ConnectionsService } from "./connections/service";
import { localOnly, parseOriginList, type GuardOptions } from "./guard";
import { leadershipRoutes } from "./leadership/routes";
import type { LeadershipService } from "./leadership/service";
import { HermesClient } from "./hermes/client";
import { HeadcountSource } from "./headcount/catalog";
import { health } from "./health";
import { CeoWake } from "./telegram/ceoWake";
import { HttpError, errorResponse, optionalString, readJsonObject, requiredString, taskIdParam } from "./http";
import { boardWithProgress } from "./org/board";
import type { BriefReader } from "./org/privateBriefs";
import { consultBoard, parseConsult } from "./org/consult";
import { hire, parseHireRequest } from "./org/hire";
import { fullRoster, type HireStore } from "./org/hireStore";
import { mergeRoster } from "./org/rosterView";
import { allTeams, memoryTeamStore, type TeamStore } from "./org/teamStore";
import { createTeam, defaultGhExec, listTeams, parseTeamRequest, type GhCheck } from "./org/techTeams";
import type { LiveService } from "./voice/live";
import type { VoiceService } from "./voice/service";
import { voiceRoutes } from "./voice/routes";
import { UI_AUTHOR, approve, createMandate, parseMandate, reject, reopen, taskDetail, unblock } from "./org/tasks";

export interface AppDeps {
  hermes: HermesClient;
  headcount: HeadcountSource;
  hires: HireStore;
  ceoWake: CeoWake;
  connections: ConnectionsService;
  meetings: MeetingEngine;
  consultations: ConsultationLog;
  /** Board members' notes from earlier meetings; consultations go without when omitted. */
  memory?: MemoryStore;
  /** The company dashboard; consultations go without when omitted. */
  dashboard?: DashboardReader;
  /** ElevenLabs voices for voice meetings. */
  voice: VoiceService;
  /** Live voice meetings on the ElevenLabs Board Room agent; their routes answer 503 when omitted. */
  live?: LiveService;
  /** Leadership (VP) meetings; their routes are absent when omitted. */
  leadership?: LeadershipService;
  /** Board members' private briefs, read only when writing their SOUL. */
  briefs: BriefReader;
  guard?: GuardOptions;
  /** Status of the background dependency reconciler, when one runs alongside the app. */
  reconcilerStatus?: () => ReconcilerStatus;
  /** Zain Tech teams added at runtime; in memory when omitted. */
  teams?: TeamStore;
  /** How POST /api/tech/teams asks `gh` whether a repo exists. */
  gh?: GhCheck;
}

export const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 128 * 1024;

export function createApp(deps: AppDeps): Hono {
  const { hermes, headcount, hires, ceoWake, guard = { port: DEFAULT_PORT } } = deps;
  const teams = deps.teams ?? memoryTeamStore();
  const gh = deps.gh ?? { execFile: defaultGhExec };
  const app = new Hono();

  app.use("/api/*", localOnly(guard));
  const smallBodies = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: () => {
      throw new HttpError(413, "request body too large");
    },
  });
  // Recordings have their own, larger limit (voiceRoutes).
  app.use("/api/*", (c, next) => (c.req.path === VOICE_API.transcribe ? next() : smallBodies(c, next)));
  app.onError(errorResponse);

  app.get("/api/health", async (c) => c.json(await health(hermes, deps.reconcilerStatus, ceoWake)));

  app.get("/api/connections", async (c) => c.json(await deps.connections.get()));

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
    return c.json(await createMandate(req, hermes, hires, ceoWake, await allTeams(teams)), 201);
  });

  app.post("/api/approvals/:id/approve", async (c) => {
    const id = taskIdParam(c);
    const body = await readJsonObject(c);
    const note = optionalString(body, "note", 2000);
    const finalText = body.finalText === undefined ? undefined : requiredString(body, "finalText", 1, 4000);
    return c.json({ task: await approve(id, { note, finalText }, hermes, hires) });
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

  app.post("/api/tasks/:id/unblock", async (c) => {
    const id = taskIdParam(c);
    const instructions = requiredString(await readJsonObject(c), "instructions", 1, 4000);
    return c.json({ task: await unblock(id, instructions, hermes, hires) });
  });

  app.post("/api/board/consult", async (c) => {
    const req = parseConsult(await readJsonObject(c));
    const ledger = boardLedger(await deps.meetings.list().catch(() => []));
    const dashboard = dashboardSection((await deps.dashboard?.().catch(() => null)) ?? null, HERMES_DASHBOARD_CHARS);
    const memory = async (member: string) => [...memorySection(ledger, (await deps.memory?.notes(member)) ?? []), ...dashboard];
    const res = await consultBoard(req, { hermes, hires, ceoWake, memory });
    await deps.consultations.record(req, res).catch((err: unknown) => console.warn(`consultations: could not log (${err instanceof Error ? err.message : "error"})`));
    return c.json(res, 201);
  });

  meetingRoutes(app, deps.meetings);
  if (deps.leadership) leadershipRoutes(app, deps.leadership);
  if (deps.memory) memoryRoutes(app, deps.memory, hires);
  voiceRoutes(app, deps.voice, deps.meetings, deps.live);

  app.get("/api/roster", async (c) => {
    const [roster, profiles] = await Promise.all([fullRoster(hires), hermes.listProfiles()]);
    return c.json(mergeRoster(roster, profiles));
  });

  app.post("/api/hire", async (c) => {
    const agent = await parseHireRequest(await readJsonObject(c), { headcount, hires, teams });
    const result = await hire(agent, { hermes, headcount, hires, briefs: deps.briefs, teams });
    return c.json(result);
  });

  app.get("/api/tech/teams", async (c) => c.json(await listTeams(teams, hires, hermes)));

  app.post("/api/tech/teams", async (c) => {
    const req = parseTeamRequest(await readJsonObject(c));
    return c.json({ team: await createTeam(req, teams, gh) }, 201);
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
  HERMES_BIN?: string;
}

export function guardOptions(port: number, env: Env): GuardOptions {
  return { port, extraOrigins: parseOriginList(env.ZAIN_ALLOWED_ORIGINS) };
}

export function defaultClients(env: Env): Pick<AppDeps, "hermes" | "headcount" | "ceoWake"> {
  const hermes = new HermesClient({ baseUrl: env.HERMES_URL, token: env.HERMES_SESSION_TOKEN });
  return {
    hermes,
    headcount: new HeadcountSource({ ref: env.HEADCOUNT_REF }),
    ceoWake: new CeoWake({ hermes, hermesBin: env.HERMES_BIN }),
  };
}
