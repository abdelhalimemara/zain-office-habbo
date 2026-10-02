import { describe, expect, it } from "vitest";
import { AUDITS_API, type AuditRequestResponse } from "../../shared/audits";
import { isMandate, pendingApprovals, waitingSubtaskReviews } from "../../shared/flow";
import type { KanbanTask } from "../../shared/hermes";
import { ROSTER } from "../../shared/roster";
import { memoryRecordStore } from "../../server/src/board/recordStore";
import { AUDIT_AGENT } from "../../server/src/growth/audit/analysis";
import { AuditEngine } from "../../server/src/growth/audit/engine";
import { AUDIT_AUTHOR } from "../../server/src/growth/audit/parent";
import { REQUEST_MARKER_PREFIX } from "../../server/src/growth/audit/requests";
import { pdfFile } from "../../server/src/growth/audit/steps";
import type { StoredAudit } from "../../server/src/growth/audit/types";
import { CeoWake } from "../../server/src/telegram/ceoWake";
import { LEAD_ID, auditRig, fakeApify, fakeChrome, fakeCrm, publicResolver, tempRoot, theStudioLead } from "./auditFakes";
import { fakeKanban } from "./fakeKanban";
import { mockExec, setup } from "./helpers";

const draftOf = (body: string) => JSON.parse(/Draft:\n```json\n([\s\S]*?)\n```/.exec(body)![1]!) as Record<string, unknown>;

async function requestApi() {
  const kanban = fakeKanban([AUDIT_AGENT]);
  const root = await tempRoot();
  const t = setup(kanban.routes, {
    audits: (hermes) =>
      new AuditEngine({
        store: memoryRecordStore<StoredAudit>(),
        apify: fakeApify().runner,
        hermes,
        crm: fakeCrm({ [LEAD_ID]: theStudioLead }).crm,
        pdf: fakeChrome().pdf,
        root,
        resolve: publicResolver,
        log: () => undefined,
      }),
  });
  return { ...t, kanban };
}

describe("audit requests (Susu asks Rami)", () => {
  it("creates Rami's task with the request, subscribes the CEO wake, and is not an HQ mandate", async () => {
    const { send, kanban, exec } = await requestApi();
    const res = await send("POST", AUDITS_API.request, { website: "thestudio.sa", name: "THE STUDIO", notes: "Founder met them at an event." });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AuditRequestResponse;
    expect(body).toEqual({ taskId: "t_1", assignee: AUDIT_AGENT });
    const task = kanban.tasks.get("t_1")!;
    expect(task).toMatchObject({ title: "Prospect audit: THE STUDIO", assignee: AUDIT_AGENT, tenant: "zain-growth", triage: false });
    expect(task.body).toContain('"website": "https://thestudio.sa/"');
    expect(task.body).toContain("Founder met them at an event.");
    expect(task.body).toContain(`${REQUEST_MARKER_PREFIX}thestudio.sa -->`);
    expect(task.body).toContain("parentTaskId");
    // Woken like a mandate: the CEO's Telegram home is subscribed to this task.
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]!.args).toContain("t_1");
    // ...but never in the approvals inbox, even parked in review.
    const parked: KanbanTask = { ...task, status: "review", created_by: "zain-ceo" };
    expect(isMandate(parked, ROSTER)).toBe(false);
    expect(pendingApprovals({ columns: [{ name: "review", tasks: [parked] }], tenants: [], assignees: [], latest_event_id: 1, now: 1 }, ROSTER)).toEqual([]);
    expect(waitingSubtaskReviews({ columns: [{ name: "review", tasks: [parked] }], tenants: [], assignees: [], latest_event_id: 1, now: 1 }, ROSTER)).toHaveLength(1);
  });

  it("names the task from the CRM record, and refuses bad requests", async () => {
    const { send, kanban } = await requestApi();
    expect((await send("POST", AUDITS_API.request, { leadId: LEAD_ID })).status).toBe(201);
    expect(kanban.tasks.get("t_1")!.title).toBe("Prospect audit: THE STUDIO");
    for (const [req, status] of [
      [{}, 400],
      [{ website: "http://10.0.0.1/" }, 400],
      [{ website: "thestudio.sa", notes: "x".repeat(4001) }, 400],
      [{ leadId: "11111111-2222-3333-4444-555555555555" }, 404],
    ] as const) {
      expect((await send("POST", AUDITS_API.request, req)).status).toBe(status);
    }
    expect(kanban.tasks.size).toBe(1);
  });

  it("resubscribes open audit requests after a restart", async () => {
    const exec = mockExec();
    const hermes = { homeChannels: async () => [{ platform: "telegram", chat_id: "1", thread_id: "", name: "Home" }] };
    const wake = new CeoWake({ hermes: hermes as never, execFile: exec.execFile, hermesBin: "/opt/hermes", log: () => undefined });
    const request = { id: "t_9", title: "Prospect audit: X", body: `${REQUEST_MARKER_PREFIX}x.sa -->`, assignee: AUDIT_AGENT, status: "blocked" } as KanbanTask;
    const n = await wake.backfill({ columns: [{ name: "blocked", tasks: [request] }], tenants: [], assignees: [], latest_event_id: 1, now: 1 }, ROSTER);
    expect(n).toBe(1);
  });
});

describe("audits started with a parentTaskId", () => {
  it("comment the result on the parent task once, then unblock it", async () => {
    const rig = await auditRig({ profiles: [AUDIT_AGENT] });
    rig.hermes.add({ id: "t_req", title: "Prospect audit: THE STUDIO", assignee: AUDIT_AGENT, status: "blocked" });
    const res = await rig.engine.start({ leadId: LEAD_ID, parentTaskId: "t_req" }, "agent");
    await rig.drive();
    expect(rig.hermes.comments).toEqual([]); // nothing until the audit ends
    const analysis = [...rig.hermes.tasks.values()].find((t) => t.title.startsWith("Prospect audit · "))!;
    rig.hermes.complete(`\`\`\`json\n${JSON.stringify(draftOf(analysis.body!))}\n\`\`\``);
    await rig.drive();
    expect((await rig.engine.get(res.id)).status).toBe("done");
    expect(rig.hermes.comments).toHaveLength(1);
    const c = rig.hermes.comments[0]!;
    expect(c).toMatchObject({ id: "t_req", author: AUDIT_AUTHOR });
    expect(c.body).toContain("DONE");
    expect(c.body).toMatch(/Score: \d+\/100, grade [A-E]; 6 of 7 areas measured\./);
    expect(c.body).toContain("Top gaps:\n1. Performance Media and Measurement (fair, critical)");
    expect(c.body).toContain(`PDF file: ${pdfFile(rig.root, res.id)}`);
    expect(c.body).toContain(`PDF URL: https://hq.test/api/growth/audits/${res.id}/pdf`);
    expect(c.body).toContain("Notion: https://notion.so/page_1");
    expect(c.body).toContain(`CRM: https://crm.test/object/lead/${LEAD_ID}`);
    expect(rig.hermes.tasks.get("t_req")!.status).toBe("ready");
    // Idempotent: more ticks, and a parent that is no longer blocked, add nothing.
    await rig.drive();
    expect(rig.hermes.comments).toHaveLength(1);
  });

  it("report a failure with the retry command, and report the rerun's outcome again", async () => {
    const opts = { connected: false };
    const rig = await auditRig({ apifyOpts: opts });
    rig.hermes.add({ id: "t_req", title: "Prospect audit: x", assignee: AUDIT_AGENT, status: "blocked" });
    const res = await rig.engine.start({ website: "thestudio.sa", parentTaskId: "t_req" }, "agent");
    await rig.drive();
    expect(rig.hermes.comments).toHaveLength(1);
    expect(rig.hermes.comments[0]!.body).toContain("FAILED");
    expect(rig.hermes.comments[0]!.body).toContain("Error: Apify is not connected.");
    expect(rig.hermes.comments[0]!.body).toContain(`/api/growth/audits/${res.id}/retry`);
    expect(rig.hermes.tasks.get("t_req")!.status).toBe("ready");
    await rig.engine.retry(res.id);
    await rig.drive();
    expect(rig.hermes.comments).toHaveLength(2); // the rerun failed again: news again, once
    await rig.drive();
    expect(rig.hermes.comments).toHaveLength(2);
  });

  it("validates parentTaskId on the start API", async () => {
    const rig = await auditRig();
    const t = setup({}, { audits: () => rig.engine });
    expect((await t.send("POST", AUDITS_API.list, { website: "thestudio.sa", parentTaskId: "../x" })).status).toBe(400);
    const ok = await t.send("POST", AUDITS_API.list, { website: "thestudio.sa", parentTaskId: "t_abc" }, { "X-Zain-Requested-By": "agent" });
    expect(ok.status).toBe(201);
    const { audit } = (await ok.json()) as { audit: { id: string } };
    expect((await rig.store.get(audit.id))!.parent).toEqual({ taskId: "t_abc" });
    await rig.engine.idle();
  });
});
