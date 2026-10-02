import { techSetup, type TechSetupOptions } from "../../server/src/org/techSetup";
import type { ExecFileLike } from "../../server/src/telegram/ceoWake";
import { ROSTER } from "../../shared/roster";
import { TECH_TEAMS } from "../../shared/techTeams";
import { KANBAN, setup, task } from "./helpers";

const HOME = "/home/zain";
const pms = ROSTER.filter((a) => a.teamRole === "project-manager").map((a) => a.profile);

interface Exec {
  file: string;
  args: readonly string[];
}

function world(options: { websiteExists?: boolean; cloned?: string[]; hired?: string[]; charters?: string[]; viewError?: string } = {}) {
  const calls: Exec[] = [];
  const made: string[] = [];
  const execFile: ExecFileLike = async (file, args) => {
    calls.push({ file, args });
    if (args[0] === "repo" && args[1] === "view") {
      if (options.viewError) throw Object.assign(new Error("exit 1"), { stderr: options.viewError });
      if (args[2] === "abdelhalimemara/zain-group-website" && !options.websiteExists) {
        throw Object.assign(new Error("exit 1"), {
          stderr: "GraphQL: Could not resolve to a Repository with the name 'abdelhalimemara/zain-group-website'. (repository)",
        });
      }
    }
    return { stdout: "", stderr: "" };
  };
  const created: unknown[] = [];
  const s = setup({
    [`GET ${KANBAN}/board`]: () => ({
      columns: [{ name: "done", tasks: (options.charters ?? []).map((title, i) => task({ id: `t_c${i}`, title, status: "done" })) }],
      tenants: [], assignees: [], latest_event_id: 1, now: 2,
    }),
    "GET /api/profiles": () => ({
      profiles: (options.hired ?? pms).map((name) => ({ name, is_default: false, model: null, provider: null, description: "", skill_count: 0 })),
    }),
    [`POST ${KANBAN}/tasks`]: (c) => {
      created.push(c.body);
      return { task: task({ id: `t_new${created.length}` }) };
    },
  });
  const lines: string[] = [];
  const opts = (apply: boolean): TechSetupOptions => ({
    hermes: s.hermes,
    execFile,
    home: HOME,
    exists: async (p) => (options.cloned ?? []).some((team) => p.startsWith(`${HOME}/ZainTech/${team}/`)),
    mkdir: async (p) => {
      made.push(p);
    },
    teams: TECH_TEAMS,
    roster: ROSTER,
    apply,
    ghBin: "/opt/gh",
    log: (l) => lines.push(l),
  });
  return { calls, made, created, lines, opts, hermesFetch: s.hermesFetch };
}

const writes = (calls: Exec[]) => calls.filter((c) => c.args[1] !== "view");

describe("tech:setup", () => {
  it("dry run only reads and says what it would do", async () => {
    const w = world();
    const result = await techSetup(w.opts(false));
    expect(writes(w.calls)).toEqual([]);
    expect(w.calls.map((c) => c.args.slice(0, 3).join(" "))).toEqual(["repo view abdelhalimemara/zain-group-website"]);
    expect(w.made).toEqual([]);
    expect(w.created).toEqual([]);
    expect(w.hermesFetch.called(`POST ${KANBAN}/tasks`)).toHaveLength(0);
    expect(result).toEqual({ createdRepos: [], cloned: [], charters: [], warnings: [] });
    expect(w.lines).toContain("would create private repo abdelhalimemara/zain-group-website: gh repo create abdelhalimemara/zain-group-website --private --add-readme");
    expect(w.lines).toContain(`would clone abdelhalimemara/zain-group-website into ${HOME}/ZainTech/website/zain-group-website (after creating it)`);
    expect(w.lines).toContain('would create "StoreLens · Team charter & status" for zain-tech-storelens-pm');
  });

  it("apply creates the missing private repo, clones every team and opens one charter per team", async () => {
    const w = world();
    const result = await techSetup(w.opts(true));
    expect(writes(w.calls).map((c) => [c.file, ...c.args])).toEqual([
      ...TECH_TEAMS.filter((t) => t.createRepo).map((t) => ["/opt/gh", "repo", "create", t.repo, "--private", "--add-readme", "--description", t.summary]),
      ...TECH_TEAMS.map((t) => ["/opt/gh", "repo", "clone", t.repo, `${HOME}/ZainTech/${t.id}/${t.repo.split("/")[1]}`, "--", "--filter=blob:none"]),
    ]);
    expect(w.made).toEqual(TECH_TEAMS.map((t) => `${HOME}/ZainTech/${t.id}`));
    expect(result.createdRepos).toEqual(["abdelhalimemara/zain-group-website"]);
    expect(result.cloned).toHaveLength(TECH_TEAMS.length);
    expect(w.created).toHaveLength(TECH_TEAMS.length);
    expect(w.created[0]).toMatchObject({
      title: "StoreLens · Team charter & status",
      assignee: "zain-tech-storelens-pm",
      tenant: "zain-tech",
      triage: false,
    });
  });

  it("is idempotent: existing repo, clones and charters are left alone", async () => {
    const w = world({
      websiteExists: true,
      cloned: TECH_TEAMS.map((t) => t.id),
      charters: TECH_TEAMS.map((t) => `${t.name} · Team charter & status`),
    });
    const result = await techSetup(w.opts(true));
    expect(writes(w.calls)).toEqual([]);
    expect(w.created).toEqual([]);
    expect(result).toEqual({ createdRepos: [], cloned: [], charters: [], warnings: [] });
  });

  it("skips charters for teams whose Project Manager is not hired yet", async () => {
    const w = world({ websiteExists: true, cloned: TECH_TEAMS.map((t) => t.id), hired: ["zain-tech-bookme-pm"] });
    const result = await techSetup(w.opts(true));
    expect(w.created).toHaveLength(1);
    expect(w.created[0]).toMatchObject({ assignee: "zain-tech-bookme-pm" });
    expect(result.warnings).toHaveLength(TECH_TEAMS.length - 1);
  });

  it("stops rather than creating a repo when gh fails for another reason", async () => {
    const w = world({ viewError: "error connecting to api.github.com" });
    await expect(techSetup(w.opts(true))).rejects.toThrow(/gh repo view abdelhalimemara\/zain-group-website failed/);
    expect(writes(w.calls)).toEqual([]);
  });
});
