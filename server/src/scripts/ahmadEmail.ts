import { defaultClients } from "../app";
import { runEmailSetup } from "../clientChannels/emailSetup";
import { terminalPrompter, type Prompter } from "../clientChannels/prompt";

const apply = process.argv.includes("--apply");
const prompter: Prompter = apply ? terminalPrompter() : { ask: async () => "", close: () => undefined };

runEmailSetup({ apply, hermes: defaultClients(process.env).hermes, prompter })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "email setup failed");
    process.exitCode = 1;
  })
  .finally(() => prompter.close());
