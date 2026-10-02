import { describe, expect, it } from "vitest";
import { AUDITS_API, type AuditResponse, type AuditsResponse } from "../../shared/audits";
import type { AuditEngine } from "../../server/src/growth/audit/engine";
import { REQUESTED_BY_HEADER } from "../../server/src/growth/audit/routes";
import { LEAD_ID, auditRig } from "./auditFakes";
import { setup } from "./helpers";

const analysis = {
  executiveSummary: "Good base, weak search.",
  findings: [{ section: "search", title: "Invisible", detail: "Not on page one.", severity: "high" }],
  opportunities: [{ title: "Win searches", service: "Zain Growth · SEO & AI Search", impact: "high", effort: "M" }],
  competitors: [],
  pitchAngle: "Lead with search.",
};

async function api() {
  const rig = await auditRig();
  let engine: AuditEngine | undefined;
  const t = setup({}, { audits: () => (engine = rig.engine) });
  return { ...t, rig, engine: engine! };
}

describe("audits API", () => {
  it("starts an audit from a CRM lead and lists it", async () => {
    const { send } = await api();
    const res = await send("POST", AUDITS_API.list, { leadId: LEAD_ID });
    expect(res.status).toBe(201);
    const { audit } = (await res.json()) as AuditResponse;
    expect(audit).toMatchObject({ status: "queued", requestedBy: "hq", prospect: { name: "THE STUDIO", leadId: LEAD_ID } });
    const list = (await (await send("GET", AUDITS_API.list)).json()) as AuditsResponse;
    expect(list.audits.map((a) => a.id)).toEqual([audit.id]);
    const one = (await (await send("GET", AUDITS_API.one(audit.id))).json()) as AuditResponse;
    expect(one.audit.id).toBe(audit.id);
  });

  it("records agents that start audits with curl", async () => {
    const { send } = await api();
    const res = await send("POST", AUDITS_API.list, { website: "thestudio.sa", name: "THE STUDIO", socials: { instagram: "@thestudio.sa" } }, { [REQUESTED_BY_HEADER]: "agent" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as AuditResponse).audit).toMatchObject({ requestedBy: "agent", prospect: { instagram: "@thestudio.sa", website: "https://thestudio.sa/" } });
  });

  it.each([
    [{}, 400, "give leadId, companyId or website"],
    [{ leadId: "not-a-uuid" }, 400, "leadId must be a CRM record id"],
    [{ website: 42 }, 400, "website must be a string"],
    [{ website: "http://192.168.1.10/admin" }, 400, "not an IP address"],
    [{ website: "gopher://thestudio.sa" }, 400, "http or https"],
    [{ website: "thestudio.sa", socials: ["x"] }, 400, "socials must be an object"],
    [{ leadId: "11111111-2222-3333-4444-555555555555" }, 404, "not found"],
  ])("refuses %j", async (body, status, message) => {
    const { send } = await api();
    const res = await send("POST", AUDITS_API.list, body);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: string }).error).toContain(message);
  });

  it("answers 409 for a second audit of the same prospect", async () => {
    const { send } = await api();
    expect((await send("POST", AUDITS_API.list, { leadId: LEAD_ID })).status).toBe(201);
    const again = await send("POST", AUDITS_API.list, { website: "https://thestudio.sa" });
    expect(again.status).toBe(409);
  });

  it("serves the PDF once rendered, and supports cancel and retry", async () => {
    const { send, rig, engine } = await api();
    const { audit } = (await (await send("POST", AUDITS_API.list, { leadId: LEAD_ID })).json()) as AuditResponse;
    expect((await send("GET", AUDITS_API.pdf(audit.id))).status).toBe(404);
    expect((await send("POST", AUDITS_API.retry(audit.id), {})).status).toBe(409);
    await rig.drive();
    rig.hermes.complete(`\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``);
    await rig.drive();
    const pdf = await send("GET", AUDITS_API.pdf(audit.id));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/^inline; filename="aud_0001\.pdf"/);
    expect(await pdf.text()).toContain("%PDF");
    expect((await send("GET", `${AUDITS_API.pdf(audit.id)}?download=1`)).headers.get("content-disposition")).toMatch(/^attachment/);
    expect((await send("POST", AUDITS_API.cancel(audit.id), {})).status).toBe(409); // already done

    const second = (await (await send("POST", AUDITS_API.list, { website: "other.sa" })).json()) as AuditResponse;
    const cancelled = await send("POST", AUDITS_API.cancel(second.audit.id), {});
    expect(((await cancelled.json()) as AuditResponse).audit.status).toBe("cancelled");
    await engine.idle();
    const retried = await send("POST", AUDITS_API.retry(second.audit.id), {});
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as AuditResponse).audit.status).toBe("queued");
    await engine.idle();
  });

  it("validates ids and keeps the guard on audit routes", async () => {
    const { send } = await api();
    expect((await send("GET", AUDITS_API.one("nope"))).status).toBe(404);
    expect((await send("GET", "/api/growth/audits/a%20b")).status).toBe(400);
    expect((await send("POST", AUDITS_API.list, "website=x", { "Content-Type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await send("POST", AUDITS_API.list, { website: "thestudio.sa" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await send("GET", AUDITS_API.list, undefined, { Host: "evil.example" })).status).toBe(403);
  });
});
