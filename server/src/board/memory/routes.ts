import type { Hono } from "hono";
import { BOARD_MEMORY_API, MEMORY_NOTE_ID, type BoardMemoryResponse } from "../../../../shared/boardMemory";
import { boardMembers } from "../../../../shared/roster";
import { HttpError, badRequest } from "../../http";
import { fullRoster, type HireStore } from "../../org/hireStore";
import { BOARD_PROFILE, type MemoryStore } from "./notes";

async function seats(hires: HireStore): Promise<string[]> {
  return boardMembers(await fullRoster(hires)).map((a) => a.profile).filter((p) => BOARD_PROFILE.test(p));
}

/** Board memory API (shared/boardMemory.ts): the founder reads every member's notes and deletes wrong ones. */
export function memoryRoutes(app: Hono, memory: MemoryStore, hires: HireStore): void {
  app.get(BOARD_MEMORY_API.list, async (c) => {
    const profiles = await seats(hires);
    const members = await Promise.all(profiles.map(async (profile) => ({ profile, notes: await memory.notes(profile) })));
    return c.json({ members } satisfies BoardMemoryResponse);
  });

  app.delete(`${BOARD_MEMORY_API.list}/:profile/notes/:id`, async (c) => {
    const profile = c.req.param("profile");
    const id = c.req.param("id");
    if (!BOARD_PROFILE.test(profile) || !(await seats(hires)).includes(profile)) throw badRequest("not a board member");
    if (!MEMORY_NOTE_ID.test(id)) throw badRequest("invalid note id");
    if (!(await memory.remove(profile, id))) throw new HttpError(404, `note ${id} not found`);
    return c.body(null, 204);
  });
}
