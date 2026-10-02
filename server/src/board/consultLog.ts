import { randomBytes } from "node:crypto";
import type { BoardConsultRequest, BoardConsultResponse } from "../../../shared/api";
import type { KanbanTask } from "../../../shared/hermes";
import type { HermesClient } from "../hermes/client";
import { STUCK_AFTER_SECONDS } from "./meetings/engine";
import { speakerName } from "./meetings/rounds";
import type { RecordStore } from "./recordStore";

export interface ConsultationRecord {
  id: string;
  question: string;
  members: string[];
  /** member profile → kanban task id */
  tasks: Record<string, string>;
  createdAt: number;
  status: "open" | "answered";
  answers: { member: string; text: string }[];
  notionPageId?: string;
  notionPageUrl?: string;
  notionDirty?: boolean;
  notionSyncError?: string;
}

export interface ConsultationSink {
  syncConsultation(record: ConsultationRecord, pageId: string | undefined): Promise<{ pageId: string; url: string }>;
}

export function isConsultationRecord(v: unknown): v is ConsultationRecord {
  const r = v as ConsultationRecord;
  return !!r && typeof r.id === "string" && typeof r.question === "string" && !!r.tasks;
}

/** Keeps board consultations (one request, one task per advisor) together so they can be logged as one row. */
export class ConsultationLog {
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(
    private readonly deps: {
      hermes: HermesClient;
      store: RecordStore<ConsultationRecord>;
      sink?: ConsultationSink;
      now?: () => number;
      log?: (line: string) => void;
    },
  ) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = deps.log ?? console.log;
  }

  async record(req: BoardConsultRequest, res: BoardConsultResponse): Promise<void> {
    const record: ConsultationRecord = {
      id: `cns_${randomBytes(5).toString("hex")}`,
      question: req.question,
      members: res.tasks.map((t) => t.assignee ?? "").filter(Boolean),
      tasks: Object.fromEntries(res.tasks.filter((t) => t.assignee).map((t) => [t.assignee!, t.id])),
      createdAt: this.now(),
      status: "open",
      answers: [],
      notionDirty: true,
    };
    await this.deps.store.put(record);
    await this.sync(record);
  }

  async tick(): Promise<void> {
    const records = (await this.deps.store.list()).filter((r) => r.status === "open" || r.notionDirty);
    if (records.length === 0) return;
    const board: KanbanTask[] = (await this.deps.hermes.board()).columns.flatMap((c) => c.tasks);
    for (const record of records) {
      try {
        if (record.status === "open") await this.check(record, board);
        if (record.notionDirty) await this.sync(record);
      } catch (err) {
        this.log(`consultations: ${record.id} failed (${err instanceof Error ? err.message : "error"})`);
      }
    }
  }

  private async check(record: ConsultationRecord, board: readonly KanbanTask[]): Promise<void> {
    const stuck = this.now() - record.createdAt > STUCK_AFTER_SECONDS;
    const answers: ConsultationRecord["answers"] = [];
    for (const member of record.members) {
      const id = record.tasks[member]!;
      const onBoard = board.find((t) => t.id === id);
      const task = onBoard?.status === "done" || !onBoard ? (await this.deps.hermes.task(id)).task : onBoard;
      if (task.status === "done") answers.push({ member, text: (task.result ?? task.latest_summary ?? "").trim() || "(no answer)" });
      else if (stuck) answers.push({ member, text: `${speakerName(member)} did not respond.` });
      else return;
    }
    record.answers = answers;
    record.status = "answered";
    record.notionDirty = true;
    await this.deps.store.put(record);
  }

  private async sync(record: ConsultationRecord): Promise<void> {
    if (!this.deps.sink) return;
    try {
      const { pageId, url } = await this.deps.sink.syncConsultation(record, record.notionPageId);
      record.notionPageId = pageId;
      record.notionPageUrl = url;
      record.notionDirty = false;
      delete record.notionSyncError;
    } catch (err) {
      record.notionSyncError = (err instanceof Error ? err.message : "Notion sync failed").slice(0, 200);
      this.log(`consultations: Notion sync for ${record.id} failed; retrying next tick`);
    }
    await this.deps.store.put(record);
  }
}
