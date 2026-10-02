import { defaultClients } from "../app";
import { runWhatsAppSetup } from "../clientChannels/whatsappSetup";

runWhatsAppSetup({
  apply: process.argv.includes("--apply"),
  routeOnly: process.argv.includes("--route-only"),
  hermes: defaultClients(process.env).hermes,
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "WhatsApp setup failed");
  process.exitCode = 1;
});
