import { homedir } from "node:os";
import { join } from "node:path";

export const ACCOUNTS_PROFILE = "zain-hq-accounts";

export function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HERMES_HOME || join(homedir(), ".hermes");
}
