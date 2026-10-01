import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp, defaultClients } from "./app";
import { fileHireStore } from "./org/hireStore";

const HOST = "127.0.0.1";
const port = Number(process.env.ZAIN_SERVER_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`ZAIN_SERVER_PORT must be a TCP port, got ${process.env.ZAIN_SERVER_PORT}`);
}

const app = createApp({ ...defaultClients(process.env), hires: fileHireStore(process.cwd()) });

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`Zain HQ server listening on http://${HOST}:${info.port}`);
});
