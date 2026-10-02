import type { Hono } from "hono";
import { LEADERSHIP_API } from "../../../shared/leadership";
import { MEETING_BRIEF_MAX, MEETING_TOPIC_MAX } from "../../../shared/meetings";
import { meetingIdParam } from "../board/meetings/validate";
import { badRequest, optionalString, readJsonObject } from "../http";
import { parseAssign, parseUpdateActions } from "./actions";
import type { LeadershipService, StartLeadership } from "./service";

export function parseStartLeadership(body: Record<string, unknown>): StartLeadership {
  const topic = optionalString(body, "topic", MEETING_TOPIC_MAX)?.trim();
  const brief = optionalString(body, "brief", MEETING_BRIEF_MAX)?.trim();
  const { members } = body;
  if (members !== undefined && (!Array.isArray(members) || members.length === 0 || !members.every((m) => typeof m === "string"))) {
    throw badRequest("members must be a non-empty array of leadership seats");
  }
  return {
    ...(topic ? { topic } : {}),
    ...(brief ? { brief } : {}),
    ...(members ? { members: [...new Set(members as string[])] } : {}),
  };
}

/** Leadership (VP) meetings API (shared/leadership.ts LEADERSHIP_API). Reading and cancelling go through MEETINGS_API. */
export function leadershipRoutes(app: Hono, leadership: LeadershipService): void {
  app.post(LEADERSHIP_API.start, async (c) => c.json({ meeting: await leadership.start(parseStartLeadership(await readJsonObject(c))) }, 201));

  app.put(`${LEADERSHIP_API.start}/:id/actions`, async (c) => {
    const id = meetingIdParam(c.req.param("id"));
    return c.json({ meeting: await leadership.updateActions(id, parseUpdateActions(await readJsonObject(c))) });
  });

  app.post(`${LEADERSHIP_API.start}/:id/actions/assign`, async (c) => {
    const id = meetingIdParam(c.req.param("id"));
    return c.json({ meeting: await leadership.assign(id, parseAssign(await readJsonObject(c))) });
  });
}
