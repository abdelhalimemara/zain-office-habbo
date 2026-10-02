import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { join } from "node:path";
import { AccessVerifier, loadAccessConfig } from "./access";
import { fileDashboard } from "./board/memory/dashboard";
import { DEFAULT_PORT, createApp, defaultClients, guardOptions } from "./app";
import { ConsultationLog, isConsultationRecord } from "./board/consultLog";
import { fileMemoryStore } from "./board/memory/notes";
import { MeetingEngine, isStoredMeeting } from "./board/meetings/engine";
import { fileRecordStore } from "./board/recordStore";
import { ConnectionsService } from "./connections/service";
import { NotionClient, envToken } from "./notion/client";
import { NotionBoardSink } from "./notion/sync";
import { fileHireStore, fullRoster } from "./org/hireStore";
import { fileBriefs } from "./org/privateBriefs";
import { Reconciler } from "./org/reconcile";
import { fileTeamStore } from "./org/teamStore";
import { fileVoiceStore } from "./voice/assignments";
import { ElevenLabsClient, envApiKey } from "./voice/elevenlabs";
import { LiveService } from "./voice/live";
import { BoardRoomAgent, LEADERSHIP_ROOM, fileAgentStore } from "./voice/liveAgent";
import { weeklyPrioritiesPath } from "./leadership/context";
import { execSouls } from "./leadership/prompt";
import { LeadershipService } from "./leadership/service";
import { allTeams } from "./org/teamStore";
import { fileSouls } from "./voice/livePrompt";
import { VoiceService } from "./voice/service";

const HOST = "127.0.0.1";
const port = Number(process.env.ZAIN_SERVER_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`ZAIN_SERVER_PORT must be a TCP port, got ${process.env.ZAIN_SERVER_PORT}`);
}

const clients = defaultClients(process.env);
const hires = fileHireStore(process.cwd());
const root = process.cwd();
const sink = new NotionBoardSink(new NotionClient(envToken()), root);
const labs = new ElevenLabsClient(envApiKey());
const memory = fileMemoryStore(root);
const voice = new VoiceService({ root, client: labs, store: fileVoiceStore(root), roster: () => fullRoster(hires) });
const dashboard = fileDashboard();
const meetings = new MeetingEngine({
  hermes: clients.hermes,
  hires,
  ceoWake: clients.ceoWake,
  store: fileRecordStore(join(root, ".zain", "meetings.json"), isStoredMeeting),
  sink,
  memory,
  dashboard,
  onTurns: (meeting, from) => voice.prefetch(meeting, from),
});
const teams = fileTeamStore(root);
const leadership = new LeadershipService({
  meetings,
  hermes: clients.hermes,
  hires,
  ceoWake: clients.ceoWake,
  teams: () => allTeams(teams),
  souls: execSouls(),
  dashboard,
  prioritiesPath: weeklyPrioritiesPath(),
});
const live = new LiveService({
  client: labs,
  agent: new BoardRoomAgent(labs, fileAgentStore(root)),
  leadership: { agent: new BoardRoomAgent(labs, fileAgentStore(root, LEADERSHIP_ROOM.key), console.warn, LEADERSHIP_ROOM), prompt: (m) => leadership.prompt(m) },
  voice,
  meetings,
  souls: fileSouls(),
  briefs: fileBriefs(root),
  memory,
  dashboard,
});
const consultations = new ConsultationLog({
  hermes: clients.hermes,
  store: fileRecordStore(join(root, ".zain", "consultations.json"), isConsultationRecord),
  sink,
});
const reconciler = new Reconciler({
  hermes: clients.hermes,
  hires,
  ceoWake: clients.ceoWake,
  steps: [() => meetings.tick(), () => consultations.tick()],
});
const app = createApp({
  ...clients,
  hires,
  teams,
  leadership,
  dashboard,
  briefs: fileBriefs(process.cwd()),
  guard: { ...guardOptions(port, process.env), access: remoteAccess() },
  reconcilerStatus: () => reconciler.status(),
  meetings,
  consultations,
  memory,
  voice,
  live,
  connections: new ConnectionsService({ hermes: clients.hermes, ceoWake: clients.ceoWake, hermesBin: process.env.HERMES_BIN }),
});

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`Zain HQ server listening on http://${HOST}:${info.port}`);
  reconciler.start();
});

/** Remote access via the Cloudflare Tunnel, from .zain/tunnel.json; a broken file stops the server rather than opening up. */
function remoteAccess(): AccessVerifier | null {
  const config = loadAccessConfig(process.cwd());
  if (!config) return null;
  console.log(`zain: remote access on https://${config.host} for ${config.emails.length} allowed email(s)`);
  return new AccessVerifier(config);
}
