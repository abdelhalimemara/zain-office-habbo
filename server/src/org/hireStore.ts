import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DIVISION_IDS } from "../../../shared/divisions";
import { ROSTER, type RosterAgent } from "../../../shared/roster";

export interface HireStore {
  list(): Promise<RosterAgent[]>;
  save(agent: RosterAgent): Promise<void>;
}

export function memoryHireStore(initial: RosterAgent[] = []): HireStore {
  const hires = [...initial];
  return {
    list: async () => [...hires],
    save: async (agent) => {
      const i = hires.findIndex((h) => h.profile === agent.profile);
      if (i >= 0) hires[i] = agent;
      else hires.push(agent);
    },
  };
}

function isRosterAgent(value: unknown): value is RosterAgent {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.profile === "string" &&
    typeof a.title === "string" &&
    DIVISION_IDS.includes(a.division as RosterAgent["division"]) &&
    (a.rank === "vp" || a.rank === "lead" || a.rank === "specialist") &&
    typeof a.reportsTo === "string" &&
    Array.isArray(a.skills) &&
    a.skills.every((s) => typeof s === "string")
  );
}

/** Locally hired agents that are not part of ROSTER, persisted to `<root>/.zain/hires.json`. */
export function fileHireStore(root: string): HireStore {
  const file = join(root, ".zain", "hires.json");

  async function read(): Promise<RosterAgent[]> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isRosterAgent) : [];
  }

  return {
    list: read,
    save: async (agent) => {
      if (ROSTER.some((a) => a.profile === agent.profile)) return;
      const hires = (await read()).filter((h) => h.profile !== agent.profile);
      hires.push(agent);
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(hires, null, 2)}\n`, "utf8");
      await rename(tmp, file);
    },
  };
}

/** ROSTER first (so `managerOf` keeps picking the canonical VPs), then local extras. */
export async function fullRoster(store: HireStore): Promise<RosterAgent[]> {
  const extras = (await store.list()).filter((h) => !ROSTER.some((a) => a.profile === h.profile));
  return [...ROSTER, ...extras];
}
