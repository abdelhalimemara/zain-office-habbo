import { setupBoardRoom } from "../notion/boardRoom";
import { NotionClient, envToken } from "../notion/client";

setupBoardRoom({ notion: new NotionClient(envToken()), apply: process.argv.includes("--apply"), root: process.cwd() }).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Notion setup failed");
  process.exitCode = 1;
});
