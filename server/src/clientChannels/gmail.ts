import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { CLIENT_REPLY_PREFIX } from "../../../shared/flow";
import type { CronJob, CronJobSpec, HermesClient } from "../hermes/client";
import { SENT_MARKER } from "../org/clientPersona";
import { ACCOUNTS_PROFILE, hermesHome } from "./hermesPaths";

export const JOB_NAME = "zain-ahmad-gmail-inbox";
export const HANDLED_LABEL = "Zain/Handled";
export const SCHEDULE = "every 15m";
const DEFAULT_PYTHON = join(
  hermesHome(),
  "installs/b2d8ea97e879ccae/environments/27281a14ceb54dd188fddb90080be0ea/venv/bin/python",
);

/** The google-workspace skill's scripts as cloned into Ahmad's profile. */
export function skillScripts(home = hermesHome()): string {
  return join(home, "profiles", ACCOUNTS_PROFILE, "skills", "productivity", "google-workspace", "scripts");
}

export interface PythonResult {
  code: number;
  stdout: string;
}

/** Runs Hermes' Python with Ahmad's profile as HERMES_HOME, so the skill uses his google_token.json. */
export type PythonRunner = (args: string[]) => Promise<PythonResult>;

export function hermesPython(env: NodeJS.ProcessEnv = process.env, home = hermesHome(env)): PythonRunner {
  const run = promisify(execFile);
  const python = env.ZAIN_HERMES_PYTHON || DEFAULT_PYTHON;
  const childEnv = {
    ...env,
    HERMES_HOME: join(home, "profiles", ACCOUNTS_PROFILE),
    PYTHONPATH: join(home, "hermes-agent"),
  };
  return async (args) => {
    try {
      const { stdout } = await run(python, args, { env: childEnv, timeout: 60_000 });
      return { code: 0, stdout };
    } catch (err) {
      const e = err as { code?: unknown; stdout?: string };
      return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "" };
    }
  };
}

/** setup.py --check: exit 0 means Ahmad's Gmail token is valid. Output names paths, never tokens. */
export async function checkGmailToken(python: PythonRunner, home = hermesHome()): Promise<{ ok: boolean; detail: string }> {
  const { code, stdout } = await python([join(skillScripts(home), "setup.py"), "--check"]);
  return { ok: code === 0, detail: stdout.trim().split("\n")[0] ?? "" };
}

/** The skill can list labels but not create them, so the label is ensured here once. */
export function labelScript(scriptsDir: string, create: boolean): string {
  return [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(scriptsDir)})`,
    "from google_api import build_service",
    'svc = build_service("gmail", "v1")',
    `name = ${JSON.stringify(HANDLED_LABEL)}`,
    'found = [l for l in svc.users().labels().list(userId="me").execute().get("labels", []) if l["name"] == name]',
    "if found:",
    '    print(json.dumps({"id": found[0]["id"], "created": False}))',
    ...(create
      ? [
          "else:",
          '    made = svc.users().labels().create(userId="me", body={"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"}).execute()',
          '    print(json.dumps({"id": made["id"], "created": True}))',
        ]
      : ["else:", '    print(json.dumps({"id": None, "created": False}))']),
  ].join("\n");
}

export async function handledLabel(python: PythonRunner, create: boolean, home = hermesHome()): Promise<{ id: string | null; created: boolean }> {
  const { code, stdout } = await python(["-c", labelScript(skillScripts(home), create)]);
  if (code !== 0) throw new Error(`could not read Gmail labels (exit ${code})`);
  const last = stdout.trim().split("\n").pop() ?? "";
  const parsed = JSON.parse(last) as { id: string | null; created: boolean };
  return { id: parsed.id, created: parsed.created };
}

const ACTIVATION = /after:(\d{9,11})\b/;

/** The activation time (unix seconds) baked into an existing job's prompt, if any. */
export function activationOf(job: CronJob | undefined): number | null {
  const match = job?.prompt ? ACTIVATION.exec(job.prompt) : null;
  return match ? Number(match[1]) : null;
}

/**
 * What each run of the inbox loop must do; the SOUL carries the routine/commitment rules.
 * `activatedAt` (unix seconds) keeps the loop off the mailbox's existing backlog: Gmail's
 * `after:` accepts epoch seconds.
 */
export function inboxPrompt(labelId: string, activatedAt: number): string {
  return [
    "You are running Ahmad Al Zain's Gmail inbox loop. Follow your client-communication charter (your SOUL) exactly.",
    "Use the google-workspace skill (google_api.py gmail …) for all Gmail work.",
    "",
    "1. Pending approved replies first. List your kanban tasks titled \"" + CLIENT_REPLY_PREFIX + " …\" with channel email that are done (completed in the last 14 days).",
    `   For each one whose comments do not contain "${SENT_MARKER}": send the task's result EXACTLY as written as an in-thread reply to the message id in its body (gmail reply <messageId> --body …), then kanban_comment "${SENT_MARKER}" on the task. Never send one twice.`,
    `2. New mail only. Search \`is:unread in:inbox after:${activatedAt} -category:promotions -category:social -category:updates -category:forums\` (max 20). Never handle, reply to or relabel mail received before this loop was activated, even if it is unread.`,
    "   Skip and just mark read: no-reply/noreply, mailer-daemon, notifications and other automated senders, newsletters, and anything from your own address.",
    "3. For each remaining message (gmail get <id>):",
    "   - Routine (status, scheduling, acknowledgements, FAQs, already-approved deliverables): reply in-thread with gmail reply <id> so threadId, In-Reply-To and References are kept.",
    `   - Commitment (price, discount, quote, scope, deadline/date, contract/terms, complaint/escalation, refund/credit, anything new or unclear): reply in-thread with a brief holding message, then kanban_create "${CLIENT_REPLY_PREFIX} <client> — <topic>" assigned to yourself, tenant zain-hq, no parents, with a body listing: channel: email, client: <address>, threadId: <id>, messageId: <id>, their message, your proposed reply and why it needs approval. Then call kanban_request_review on it with your proposed reply as the summary.`,
    `4. Mark every message you handled or skipped as read and label it ${HANDLED_LABEL}: gmail modify <id> --add-labels ${labelId} --remove-labels UNREAD.`,
    "",
    "Never send a commitment without HQ approval, never reveal other clients' details or credentials, and reply in the client's language.",
    "If there is nothing to do, respond with exactly [SILENT].",
  ].join("\n");
}

export function inboxJobSpec(labelId: string, activatedAt: number): CronJobSpec {
  return {
    name: JOB_NAME,
    schedule: SCHEDULE,
    prompt: inboxPrompt(labelId, activatedAt),
    deliver: "local",
    skills: ["google-workspace"],
    enabled_toolsets: ["terminal", "skills", "kanban"],
  };
}

/** The fields that differ from the desired spec (empty when the job is up to date). */
export function jobDrift(job: CronJob, spec: CronJobSpec): Partial<CronJobSpec> {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const drift: Partial<CronJobSpec> = {};
  if (job.prompt !== spec.prompt) drift.prompt = spec.prompt;
  if (job.schedule_display !== SCHEDULE) drift.schedule = spec.schedule;
  if (job.deliver !== spec.deliver) drift.deliver = spec.deliver;
  if (!same(job.skills, spec.skills)) drift.skills = spec.skills;
  if (!same(job.enabled_toolsets, spec.enabled_toolsets)) drift.enabled_toolsets = spec.enabled_toolsets;
  return drift;
}

export interface GmailSetupOptions {
  apply: boolean;
  hermes: HermesClient;
  python: PythonRunner;
  home?: string;
  now?: () => Date;
  log?: (line: string) => void;
}

export type GmailSetupOutcome = "needs-auth" | "dry-run" | "created" | "updated" | "unchanged";

export async function runGmailSetup({ apply, hermes, python, home = hermesHome(), now = () => new Date(), log = console.log }: GmailSetupOptions): Promise<GmailSetupOutcome> {
  const token = await checkGmailToken(python, home);
  log(`Gmail token for ${ACCOUNTS_PROFILE}: ${token.ok ? "valid" : "missing or invalid"}${token.detail ? ` (${token.detail})` : ""}`);
  if (!token.ok) {
    log("Finish Google sign-in first: open the auth URL, approve with Ahmad's Gmail, then run setup.py --auth-code <code> with HERMES_HOME set to his profile.");
    return "needs-auth";
  }
  const label = await handledLabel(python, apply, home);
  log(`Label ${HANDLED_LABEL}: ${label.id ? `${label.created ? "created" : "found"} (${label.id})` : "missing; --apply creates it"}`);

  const existing = (await hermes.cronJobs(ACCOUNTS_PROFILE)).find((j) => j.name === JOB_NAME);
  const activatedAt = activationOf(existing) ?? Math.floor(now().getTime() / 1000);
  log(`Mail handled from ${new Date(activatedAt * 1000).toISOString()} on${activationOf(existing) ? " (kept from the existing job)" : ""}; the existing backlog is never touched.`);
  const spec = inboxJobSpec(label.id ?? "<label id>", activatedAt);
  const drift = existing ? jobDrift(existing, spec) : null;
  if (!apply) {
    if (!existing) log(`Would create cron job ${JOB_NAME} (${SCHEDULE}, delivery local only, skills google-workspace, toolsets terminal+skills+kanban).`);
    else if (Object.keys(drift!).length) log(`Would update cron job ${JOB_NAME} (${existing.id}): ${Object.keys(drift!).join(", ")}.`);
    else log(`Cron job ${JOB_NAME} (${existing.id}) is up to date.`);
    log("Dry run. Re-run with --apply to make these changes.");
    return "dry-run";
  }
  let job: CronJob;
  let outcome: GmailSetupOutcome;
  if (!existing) {
    job = await hermes.createCronJob(ACCOUNTS_PROFILE, spec);
    outcome = "created";
  } else if (Object.keys(drift!).length) {
    job = await hermes.updateCronJob(ACCOUNTS_PROFILE, existing.id, drift!);
    outcome = "updated";
  } else {
    job = existing;
    outcome = "unchanged";
  }
  log(`Cron job ${JOB_NAME}: ${outcome} (${job.id}), state ${job.state ?? "scheduled"}, next run ${job.next_run_at ?? "soon"}.`);
  log("");
  log("Next steps:");
  log("1. Run `npm run seed:roster -- --refresh-personas --apply` so Ahmad's SOUL has the Gmail inbox rules.");
  log("2. Email Ahmad from another address; within ~15 minutes he replies (routine) or holds and raises a Client reply for HQ.");
  log("3. Watch runs in the Hermes dashboard → Cron (deliveries stay local; nothing is posted to Telegram).");
  return outcome;
}
