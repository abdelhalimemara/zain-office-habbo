import type { HermesClient } from "../hermes/client";
import { ACCOUNTS_PROFILE, hermesHome, profileEnvPath, writeEnvFile } from "./envFile";
import type { Prompter } from "./prompt";
import { enableKanbanToolsets } from "./toolsets";

const SECURITY = ["tls", "starttls", "plain"] as const;
type Security = (typeof SECURITY)[number];

export interface EmailSettings {
  address: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
}

/** plugins/platforms/email: these four enable the adapter; ports and security have defaults. */
export const EMAIL_KEYS = [
  "EMAIL_ADDRESS",
  "EMAIL_PASSWORD",
  "EMAIL_IMAP_HOST",
  "EMAIL_IMAP_PORT",
  "EMAIL_IMAP_SECURITY",
  "EMAIL_SMTP_HOST",
  "EMAIL_SMTP_PORT",
  "EMAIL_SMTP_SECURITY",
  "EMAIL_ALLOW_ALL_USERS",
] as const;

async function askUntil<T>(prompter: Prompter, question: string, parse: (s: string) => T | null, fallback?: string, hidden = false): Promise<T> {
  for (;;) {
    const value = parse(await prompter.ask(question, { hidden, fallback }));
    if (value !== null) return value;
  }
}

const host = (s: string) => (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s) ? s : null);
const port = (s: string) => (/^\d{1,5}$/.test(s) && +s >= 1 && +s <= 65535 ? +s : null);
const security = (s: string) => (SECURITY.includes(s.toLowerCase() as Security) ? (s.toLowerCase() as Security) : null);

export async function collectEmailSettings(prompter: Prompter): Promise<EmailSettings> {
  const address = await askUntil(prompter, "Ahmad's email address", (s) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null));
  const domain = address.split("@")[1]!;
  const password = await askUntil(prompter, "Email password or app password (hidden)", (s) => (s ? s : null), undefined, true);
  const imapHost = await askUntil(prompter, "IMAP host", host, `imap.${domain}`);
  const imapPort = await askUntil(prompter, "IMAP port", port, "993");
  const imapSecurity = await askUntil(prompter, "IMAP security (tls/starttls/plain)", security, "tls");
  const smtpHost = await askUntil(prompter, "SMTP host", host, `smtp.${domain}`);
  const smtpPort = await askUntil(prompter, "SMTP port", port, "587");
  const smtpSecurity = await askUntil(prompter, "SMTP security (tls/starttls/plain)", security, smtpPort === 465 ? "tls" : "starttls");
  return { address, password, imapHost, imapPort, imapSecurity, smtpHost, smtpPort, smtpSecurity };
}

/** Anyone may email Ahmad (the user's choice), so the adapter accepts every sender. */
export function emailEnv(s: EmailSettings): Record<(typeof EMAIL_KEYS)[number], string> {
  return {
    EMAIL_ADDRESS: s.address,
    EMAIL_PASSWORD: s.password,
    EMAIL_IMAP_HOST: s.imapHost,
    EMAIL_IMAP_PORT: String(s.imapPort),
    EMAIL_IMAP_SECURITY: s.imapSecurity,
    EMAIL_SMTP_HOST: s.smtpHost,
    EMAIL_SMTP_PORT: String(s.smtpPort),
    EMAIL_SMTP_SECURITY: s.smtpSecurity,
    EMAIL_ALLOW_ALL_USERS: "true",
  };
}

export interface EmailSetupOptions {
  apply: boolean;
  hermes: HermesClient;
  prompter: Prompter;
  home?: string;
  now?: () => Date;
  log?: (line: string) => void;
}

export async function runEmailSetup({ apply, hermes, prompter, home = hermesHome(), now = () => new Date(), log = console.log }: EmailSetupOptions): Promise<"dry-run" | "written"> {
  const path = profileEnvPath(ACCOUNTS_PROFILE, home);
  if (!apply) {
    log(`Dry run. With --apply this will ask for Ahmad's mailbox (the password is typed hidden) and:`);
    log(`- back up ${path}, then set ${EMAIL_KEYS.join(", ")} there (mode 600; values are never printed)`);
    log(`- enable the kanban toolset for ${ACCOUNTS_PROFILE} on email and WhatsApp (platform_toolsets)`);
    return "dry-run";
  }
  const settings = await collectEmailSettings(prompter);
  const written = await writeEnvFile(path, emailEnv(settings), now());
  log(`Saved ${written.keys.length} email settings for ${settings.address} to ${written.path} (mode 600).`);
  if (written.backup) log(`Backup of the previous file: ${written.backup}`);
  const toolsets = await enableKanbanToolsets(hermes, ["email", "whatsapp"]);
  log(`Toolsets: ${Object.entries(toolsets).map(([p, t]) => `${p}=[${t.join(", ")}]`).join(" ")}`);
  log("");
  log("Next steps:");
  log("1. Wait about 30 seconds: the gateway picks up the new email platform on its own. If you changed existing credentials, run `hermes gateway restart`.");
  log("2. Check Hermes' dashboard status shows email connected for zain-hq-accounts, then send a test email to Ahmad.");
  log("3. Run `npm run seed:roster -- --refresh-personas --apply` so Ahmad's SOUL has the client-communication charter.");
  return "written";
}
