import { defaultClients } from "../app";
import { hermesPython, runGmailSetup } from "../clientChannels/gmail";

runGmailSetup({ apply: process.argv.includes("--apply"), hermes: defaultClients(process.env).hermes, python: hermesPython() })
  .then((outcome) => {
    if (outcome === "needs-auth") process.exitCode = 1;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Gmail setup failed");
    process.exitCode = 1;
  });
