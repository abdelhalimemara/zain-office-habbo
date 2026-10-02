import type { Hono } from "hono";
import { MEETINGS_API } from "../../../../shared/meetings";
import { readJsonObject } from "../../http";
import type { MeetingEngine } from "./engine";
import { meetingIdParam, parseRemark, parseStartMeeting } from "./validate";

/** Board meetings API (shared/meetings.ts MEETINGS_API); the CEO convenes through it with curl. */
export function meetingRoutes(app: Hono, meetings: MeetingEngine): void {
  app.get(MEETINGS_API.list, async (c) => c.json({ meetings: await meetings.list() }));

  app.post(MEETINGS_API.list, async (c) => {
    const req = parseStartMeeting(await readJsonObject(c));
    return c.json({ meeting: await meetings.start(req) }, 201);
  });

  app.get(`${MEETINGS_API.list}/:id`, async (c) => c.json({ meeting: await meetings.get(meetingIdParam(c.req.param("id"))) }));

  app.post(`${MEETINGS_API.list}/:id/remarks`, async (c) => {
    const id = meetingIdParam(c.req.param("id"));
    return c.json({ meeting: await meetings.remark(id, parseRemark(await readJsonObject(c))) });
  });

  app.post(`${MEETINGS_API.list}/:id/cancel`, async (c) => {
    const id = meetingIdParam(c.req.param("id"));
    await readJsonObject(c);
    return c.json({ meeting: await meetings.cancel(id) });
  });
}
