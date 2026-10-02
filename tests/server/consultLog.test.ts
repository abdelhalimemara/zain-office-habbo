import type { ConsultationRecord } from "../../server/src/board/consultLog";
import { fakeKanban } from "./fakeKanban";
import { setup } from "./helpers";

describe("consultation log", () => {
  it("records each consultation, groups the answers once every task is done, and syncs the row", async () => {
    const kanban = fakeKanban(["zain-board-hormozi", "zain-board-buffett"]);
    const synced: ConsultationRecord[] = [];
    const sink = {
      syncConsultation: async (r: ConsultationRecord) => (synced.push(structuredClone(r)), { pageId: "row", url: "https://notion.so/row" }),
      syncMeeting: async () => ({ pageId: "x", url: "x" }),
    };
    const clock = { t: 1_790_000_000 };
    const s = setup(kanban.routes, { sink, now: () => clock.t });
    expect((await s.send("POST", "/api/board/consult", { question: "Raise prices 20%?" })).status).toBe(201);
    let [record] = await s.consultationStore.list();
    expect(record).toMatchObject({ question: "Raise prices 20%?", status: "open", members: ["zain-board-hormozi", "zain-board-buffett"], notionDirty: false });
    expect(synced.map((r) => r.status)).toEqual(["open"]);

    kanban.complete("t_1", "Yes, raise.");
    await s.consultations.tick();
    expect((await s.consultationStore.list())[0]!.status).toBe("open");
    kanban.complete("t_2", null, "Only with proof of value.");
    await s.consultations.tick();
    [record] = await s.consultationStore.list();
    expect(record!.answers).toEqual([
      { member: "zain-board-hormozi", text: "Yes, raise." },
      { member: "zain-board-buffett", text: "Only with proof of value." },
    ]);
    expect(record).toMatchObject({ status: "answered", notionPageUrl: "https://notion.so/row" });
    expect(synced.at(-1)!.status).toBe("answered");
    await s.consultations.tick();
    expect(synced).toHaveLength(2);
  });

  it("closes a consultation with a silent advisor after 30 minutes", async () => {
    const kanban = fakeKanban(["zain-board-hormozi"]);
    const clock = { t: 1_790_000_000 };
    const s = setup(kanban.routes, { now: () => clock.t });
    await s.send("POST", "/api/board/consult", { question: "Q?" });
    clock.t += 31 * 60;
    await s.consultations.tick();
    expect((await s.consultationStore.list())[0]!.answers).toEqual([{ member: "zain-board-hormozi", text: "Alex Hormozi did not respond." }]);
  });
});
