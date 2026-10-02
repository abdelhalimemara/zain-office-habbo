import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { ConnectionsService } from "./connections/service";
import { DEFAULT_PORT, createApp, defaultClients, guardOptions } from "./app";
import { fileHireStore } from "./org/hireStore";
import { fileBriefs } from "./org/privateBriefs";
import { Reconciler } from "./org/reconcile";

const HOST = "127.0.0.1";
const port = Number(process.env.ZAIN_SERVER_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`ZAIN_SERVER_PORT must be a TCP port, got ${process.env.ZAIN_SERVER_PORT}`);
}

const clients = defaultClients(process.env);
const hires = fileHireStore(process.cwd());
const reconciler = new Reconciler({ hermes: clients.hermes, hires, ceoWake: clients.ceoWake });
const app = createApp({
  ...clients,
  hires,
  briefs: fileBriefs(process.cwd()),
  guard: guardOptions(port, process.env),
  reconcilerStatus: () => reconciler.status(),
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
