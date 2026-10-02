import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HANDLED_LABEL,
  JOB_NAME,
  SCHEDULE,
  activationOf,
  gmailCommand,
  resolveHermesPython,
  inboxJobSpec,
  inboxPrompt,
  jobDrift,
  labelScript,
  runGmailSetup,
  skillScripts,
  type PythonRunner,
} from "../../server/src/clientChannels/gmail";
import { setup, type Handler } from "./helpers";

const HOME = "/h";
const LABEL = "Label_42";
const T = 1_790_000_000;
const now = () => new Date(T * 1000);
const PY = "/h/installs/x/environments/e/venv/bin/python";
const GMAIL = gmailCommand(PY, HOME);

function python(opts: { token?: boolean; label?: string | null; created?: boolean } = {}) {
  const calls: string[][] = [];
  const run: PythonRunner = async (args) => {
    calls.push(args);
    if (args[0]!.endsWith("setup.py")) {
      return opts.token === false ? { code: 1, stdout: "NOT_AUTHENTICATED: No token at /h/profiles/zain-hq-accounts/google_token.json\n" } : { code: 0, stdout: "AUTHENTICATED: Token valid\n" };
    }
    return { code: 0, stdout: `${JSON.stringify({ id: opts.label === undefined ? LABEL : opts.label, created: opts.created ?? false })}\n` };
  };
  return { run, calls };
}

function cronApi(jobs: unknown[], extra: Record<string, Handler> = {}) {
  return setup({
    "GET /api/cron/jobs": () => jobs,
    "POST /api/cron/jobs": (c) => ({ id: "job1", state: "scheduled", next_run_at: "2026-10-02T12:02:00Z", ...(c.body as object) }),
    "PUT /api/cron/jobs/job1": (c) => ({ id: "job1", state: "scheduled", ...((c.body as { updates: object }).updates) }),
    ...extra,
  });
}

describe("Gmail inbox loop job", () => {
  it("runs every 2 minutes in Ahmad's profile, delivering locally only, with the skill and the tools it needs", () => {
    expect(inboxJobSpec(LABEL, T, GMAIL)).toEqual({
      name: "zain-ahmad-gmail-inbox",
      schedule: "every 15m",
      prompt: inboxPrompt(LABEL, T, GMAIL),
      deliver: "local",
      skills: ["google-workspace"],
      enabled_toolsets: ["terminal", "skills", "kanban"],
    });
  });

  it("tells Ahmad to send approved replies once, triage unread mail and label it handled", () => {
    const prompt = inboxPrompt(LABEL, T, GMAIL);
    const sent = prompt.indexOf("Pending approved replies first");
    const unread = prompt.indexOf("New mail");
    expect(sent).toBeGreaterThan(-1);
    expect(unread).toBeGreaterThan(sent);
    expect(prompt).toContain('whose comments do not contain "Sent via email"');
    expect(prompt).toContain("send the task's result EXACTLY as written as an in-thread reply");
    expect(prompt).toContain('then kanban_comment "Sent via email" on the task. Never send one twice.');
    expect(prompt).toContain(`is:unread in:inbox after:${T} -category:promotions -category:social`);
    expect(prompt).toContain("Never handle, reply to or relabel mail received before this loop was activated");
    expect(prompt).toMatch(/no-reply\/noreply, mailer-daemon/);
    expect(prompt).toContain("gmail reply <id> so threadId, In-Reply-To and References are kept");
    expect(prompt).toContain("channel: email, client: <address>, threadId: <id>, messageId: <id>");
    expect(prompt).toContain("Then call kanban_request_review");
    expect(prompt).toContain(`gmail modify <id> --add-labels ${LABEL} --remove-labels UNREAD`);
    expect(prompt).toContain("[SILENT]");
  });

  it("detects drift only in the fields the script owns", () => {
    const spec = inboxJobSpec(LABEL, T, GMAIL);
    const current = { id: "job1", name: JOB_NAME, prompt: spec.prompt, schedule_display: SCHEDULE, deliver: "local", skills: ["google-workspace"], enabled_toolsets: ["terminal", "skills", "kanban"] };
    expect(jobDrift(current, spec)).toEqual({});
    expect(jobDrift({ ...current, deliver: "telegram", schedule_display: "every 5m" }, spec)).toEqual({ deliver: "local", schedule: "every 15m" });
  });

  it("looks the label up, creating it only on apply", () => {
    expect(labelScript("/s", false)).not.toContain("labels().create");
    expect(labelScript("/s", true)).toContain("labels().create");
    expect(labelScript("/s", true)).toContain(JSON.stringify(HANDLED_LABEL));
    expect(skillScripts(HOME)).toBe("/h/profiles/zain-hq-accounts/skills/productivity/google-workspace/scripts");
  });
});

describe("npm run ahmad:gmail", () => {
  it("stops before touching anything when the Gmail token is not valid", async () => {
    const lines: string[] = [];
    const py = python({ token: false });
    const { hermes, hermesFetch } = cronApi([]);
    expect(await runGmailSetup({ apply: true, hermes, python: py.run, home: HOME, pythonPath: PY, now, log: (l) => lines.push(l) })).toBe("needs-auth");
    expect(py.calls).toEqual([["/h/profiles/zain-hq-accounts/skills/productivity/google-workspace/scripts/setup.py", "--check"]]);
    expect(hermesFetch.calls).toEqual([]);
    expect(lines.join("\n")).toContain("--auth-code");
  });

  it("dry run checks the token and label read-only and creates no job", async () => {
    const lines: string[] = [];
    const py = python({ label: null });
    const { hermes, hermesFetch } = cronApi([]);
    expect(await runGmailSetup({ apply: false, hermes, python: py.run, home: HOME, pythonPath: PY, now, log: (l) => lines.push(l) })).toBe("dry-run");
    expect(py.calls[1]![1]).not.toContain("labels().create");
    expect(hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(hermesFetch.called("GET /api/cron/jobs")[0]!.query.get("profile")).toBe("zain-hq-accounts");
    expect(lines).toContain(`Would create cron job ${JOB_NAME} (every 15m, delivery local only, skills google-workspace, toolsets terminal+skills+kanban).`);
  });

  it("creates the job once, in Ahmad's profile, with the label id in its prompt", async () => {
    const py = python({ created: true });
    const { hermes, hermesFetch } = cronApi([{ id: "other", name: "daily-brief" }]);
    expect(await runGmailSetup({ apply: true, hermes, python: py.run, home: HOME, pythonPath: PY, now, log: () => undefined })).toBe("created");
    expect(py.calls[1]![1]).toContain("labels().create");
    const created = hermesFetch.called("POST /api/cron/jobs");
    expect(created).toHaveLength(1);
    expect(created[0]!.query.get("profile")).toBe("zain-hq-accounts");
    expect(created[0]!.body).toEqual(inboxJobSpec(LABEL, T, GMAIL));
  });

  it("updates only drifted fields of the existing job, and leaves an up-to-date job alone", async () => {
    const spec = inboxJobSpec(LABEL, T, GMAIL);
    const current = { id: "job1", name: JOB_NAME, prompt: "old prompt", schedule_display: SCHEDULE, deliver: "local", skills: ["google-workspace"], enabled_toolsets: ["terminal", "skills", "kanban"] };
    const drifted = cronApi([current]);
    expect(await runGmailSetup({ apply: true, hermes: drifted.hermes, python: python().run, home: HOME, pythonPath: PY, now, log: () => undefined })).toBe("updated");
    expect(drifted.hermesFetch.called("PUT /api/cron/jobs/job1").map((c) => c.body)).toEqual([{ updates: { prompt: spec.prompt } }]);
    expect(drifted.hermesFetch.called("POST /api/cron/jobs")).toEqual([]);

    const fresh = cronApi([{ ...current, prompt: spec.prompt }]);
    expect(await runGmailSetup({ apply: true, hermes: fresh.hermes, python: python().run, home: HOME, pythonPath: PY, now, log: () => undefined })).toBe("unchanged");
    expect(fresh.hermesFetch.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("keeps the original activation time when updating, so the backlog stays untouched", async () => {
    const earlier = T - 86_400;
    const current = { id: "job1", name: JOB_NAME, prompt: inboxPrompt("old", earlier, GMAIL), schedule_display: SCHEDULE, deliver: "local", skills: ["google-workspace"], enabled_toolsets: ["terminal", "skills", "kanban"] };
    expect(activationOf(current)).toBe(earlier);
    const { hermes, hermesFetch } = cronApi([current]);
    await runGmailSetup({ apply: true, hermes, python: python().run, home: HOME, pythonPath: PY, now, log: () => undefined });
    expect(hermesFetch.called("PUT /api/cron/jobs/job1")[0]!.body).toEqual({ updates: { prompt: inboxPrompt(LABEL, earlier, GMAIL) } });
    expect(activationOf(undefined)).toBeNull();
  });

  it("fails clearly when Gmail labels cannot be read", async () => {
    const run: PythonRunner = async (args) => (args[0]!.endsWith("setup.py") ? { code: 0, stdout: "ok" } : { code: 2, stdout: "" });
    const { hermes } = cronApi([]);
    await expect(runGmailSetup({ apply: true, hermes, python: run, home: HOME, pythonPath: PY, now, log: () => undefined })).rejects.toThrow("could not read Gmail labels (exit 2)");
  });
});

describe("Gmail command for the agent", () => {
  it("bakes Ahmad's profile, Hermes on PYTHONPATH and Hermes' Python into one shell prefix", () => {
    expect(GMAIL).toBe(
      "env HERMES_HOME=/h/profiles/zain-hq-accounts PYTHONPATH=/h/hermes-agent /h/installs/x/environments/e/venv/bin/python /h/profiles/zain-hq-accounts/skills/productivity/google-workspace/scripts/google_api.py",
    );
    expect(gmailCommand("/opt/my python/bin/python", "/h")).toContain("'/opt/my python/bin/python'");
    const prompt = inboxPrompt(LABEL, T, GMAIL);
    expect(prompt).toContain(`GMAIL="${GMAIL}"`);
    expect(prompt).toContain("never plain `python`");
    expect(prompt).toContain("`$GMAIL gmail reply <id> --body …`");
  });

  it("resolves Hermes' Python from the install facts, or the override", async () => {
    const home = await mkdtemp(join(tmpdir(), "zain-hermes-"));
    await expect(resolveHermesPython({}, home)).rejects.toThrow(/ZAIN_HERMES_PYTHON/);
    const env = join(home, "installs", "abc", "environments", "e1", "venv");
    await mkdir(join(env, "bin"), { recursive: true });
    await writeFile(join(env, "bin", "python"), "");
    await mkdir(join(home, "installs", "stale"), { recursive: true });
    await writeFile(join(home, "installs", "stale", "facts.json"), JSON.stringify({ packages: { venv: { environment: "/gone" } } }));
    await writeFile(join(home, "installs", "abc", "facts.json"), JSON.stringify({ packages: { venv: { environment: env } } }));
    expect(await resolveHermesPython({}, home)).toBe(join(env, "bin", "python"));
    expect(await resolveHermesPython({ ZAIN_HERMES_PYTHON: "/custom/python" }, home)).toBe("/custom/python");
    await rm(home, { recursive: true, force: true });
  });
});
