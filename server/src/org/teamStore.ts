import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { REPO_PATTERN, TEAM_ID_PATTERN, TECH_TEAMS, type TechTeam } from "../../../shared/techTeams";

export interface TeamStore {
  list(): Promise<TechTeam[]>;
  save(team: TechTeam): Promise<void>;
}

export function memoryTeamStore(initial: TechTeam[] = []): TeamStore {
  const teams = [...initial];
  return {
    list: async () => [...teams],
    save: async (team) => {
      const i = teams.findIndex((t) => t.id === team.id);
      if (i >= 0) teams[i] = team;
      else teams.push(team);
    },
  };
}

function isTeam(value: unknown): value is TechTeam {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    TEAM_ID_PATTERN.test(t.id) &&
    typeof t.name === "string" &&
    typeof t.repo === "string" &&
    REPO_PATTERN.test(t.repo) &&
    typeof t.summary === "string" &&
    (t.stack === undefined || typeof t.stack === "string")
  );
}

/** Teams the VP Tech added at runtime, persisted to `<root>/.zain/teams.json`. */
export function fileTeamStore(root: string): TeamStore {
  const file = join(root, ".zain", "teams.json");

  async function read(): Promise<TechTeam[]> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isTeam) : [];
  }

  async function write(team: TechTeam): Promise<void> {
    const teams = (await read()).filter((t) => t.id !== team.id);
    teams.push(team);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(teams, null, 2)}\n`, "utf8");
    await rename(tmp, file);
  }

  let queue: Promise<void> = Promise.resolve();
  return {
    list: read,
    save: (team) => {
      const saved = queue.then(() => write(team));
      queue = saved.catch(() => undefined);
      return saved;
    },
  };
}

/** Built-in teams first, then runtime teams that don't reuse a built-in id. */
export async function allTeams(store: TeamStore): Promise<TechTeam[]> {
  const extras = (await store.list()).filter((t) => !TECH_TEAMS.some((b) => b.id === t.id));
  return [...TECH_TEAMS, ...extras];
}
