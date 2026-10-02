import { setupProspectAudits } from "../growth/audit/notion";
import { NotionClient, envToken } from "../notion/client";

setupProspectAudits({ notion: new NotionClient(envToken()), apply: process.argv.includes("--apply"), root: process.cwd() }).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Notion setup failed");
  process.exitCode = 1;
});
