import { DEFAULT_PORT, defaultClients } from "../app";
import { installCeoApprovals } from "../telegram/ceoSoul";

const port = Number(process.env.ZAIN_SERVER_PORT ?? DEFAULT_PORT);

installCeoApprovals({
  hermes: defaultClients(process.env).hermes,
  apply: process.argv.includes("--apply"),
  port,
  root: process.cwd(),
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
