import type { BoardMeeting, Decision, MeetingStatus } from "../../../shared/meetings";
import type { ConsultationRecord, ConsultationSink } from "../board/consultLog";
import type { MeetingSink } from "../board/meetings/engine";
import { FOUNDER, meetingRoundLabel, speakerName, votesSummary } from "../board/meetings/rounds";
import { CEO_PROFILE } from "../../../shared/roster";
import { readBoardRoomIds, type BoardRoomIds } from "./boardRoom";
import { NotionClient, RICH_TEXT_MAX, bullet, callout, heading, paragraphs, richText } from "./client";

type Json = Record<string, unknown>;

const STATUS: Record<MeetingStatus, string> = {
  live: "Live",
  "in-round": "In round",
  "awaiting-founder": "Awaiting founder",
  voting: "Voting",
  minutes: "Minutes",
  concluded: "Concluded",
  cancelled: "Cancelled",
};

const DECISION: Record<Decision, string> = {
  approved: "Approved",
  "approved-with-conditions": "Approved with conditions",
  rejected: "Rejected",
  "no-decision": "No decision",
};

const REQUESTED_BY: Record<BoardMeeting["requestedBy"], string> = { hq: "HQ", ceo: "CEO", board: "Board" };
const VOTE_LABEL = { approve: "Approve", "approve-with-conditions": "Approve with conditions", reject: "Reject", abstain: "Abstain" };

const text = (value: string) => ({ rich_text: richText(value.slice(0, RICH_TEXT_MAX)) });
const select = (name: string | undefined) => ({ select: name ? { name } : null });
const date = (unixSeconds: number) => ({ date: { start: new Date(unixSeconds * 1000).toISOString() } });
const members = (profiles: readonly string[]) => ({ multi_select: profiles.map((p) => ({ name: speakerName(p) })) });

export function meetingProperties(m: BoardMeeting): Json {
  return {
    Name: { title: richText(m.topic) },
    Type: select("Meeting"),
    Status: select(STATUS[m.status]),
    Date: date(m.createdAt),
    "Requested by": select(REQUESTED_BY[m.requestedBy]),
    Members: members(m.members),
    Decision: select(m.decision ? DECISION[m.decision] : undefined),
    Votes: text(m.votes.length ? votesSummary(m.votes) : ""),
    Conclusion: text(m.conclusion ?? ""),
    "Zain HQ ID": text(m.id),
  };
}

const emojiFor = (speaker: string) => (speaker === FOUNDER ? "🧑‍💼" : speaker === CEO_PROFILE ? "📝" : "💬");

export function meetingBlocks(m: BoardMeeting): Json[] {
  const blocks: Json[] = [heading("Brief"), ...paragraphs(m.brief)];
  let round = 0;
  for (const turn of m.turns) {
    if (turn.speaker === CEO_PROFILE && m.conclusion !== undefined && turn.text === m.conclusion) continue;
    if (turn.round !== round) {
      round = turn.round;
      blocks.push(heading(`Round ${round} · ${meetingRoundLabel(round, m.discussionRounds, m.mode)}`));
    }
    blocks.push(callout(speakerName(turn.speaker), turn.text, emojiFor(turn.speaker)));
  }
  if (m.votes.length) {
    blocks.push(heading("Votes"));
    for (const v of m.votes) {
      const conditions = v.conditions ? ` (conditions: ${v.conditions})` : "";
      blocks.push(bullet(`${speakerName(v.member)} — ${VOTE_LABEL[v.vote]}${conditions}: ${v.rationale}`));
    }
    if (m.decision) blocks.push(...paragraphs(`Decision: ${DECISION[m.decision]} (${votesSummary(m.votes)})`));
  }
  if (m.conclusion) blocks.push(heading("Conclusion"), ...paragraphs(m.conclusion));
  return blocks;
}

export function consultationProperties(r: ConsultationRecord): Json {
  const short = r.question.replace(/\s+/g, " ").trim();
  return {
    Name: { title: richText(`Consultation: ${short.length > 80 ? `${short.slice(0, 80)}…` : short}`) },
    Type: select("Consultation"),
    Status: select(r.status === "answered" ? "Answered" : "Awaiting answers"),
    Date: date(r.createdAt),
    "Requested by": select("HQ"),
    Members: members(r.members),
    "Zain HQ ID": text(r.id),
  };
}

export function consultationBlocks(r: ConsultationRecord): Json[] {
  return [
    heading("Question"),
    ...paragraphs(r.question),
    heading("Answers"),
    ...(r.answers.length ? r.answers.map((a) => callout(speakerName(a.member), a.text)) : paragraphs("Waiting for the advisors' answers.")),
  ];
}

/**
 * Mirrors meetings and consultations into the Board Meetings data source: one row per Zain HQ id
 * (found again by that id), whose page body is rewritten from scratch on every sync.
 */
export class NotionBoardSink implements MeetingSink, ConsultationSink {
  private ids: BoardRoomIds | null = null;

  constructor(
    private readonly notion: NotionClient,
    private readonly root: string,
  ) {}

  syncMeeting(m: BoardMeeting, pageId: string | undefined) {
    return this.upsert(m.id, pageId, meetingProperties(m), meetingBlocks(m));
  }

  syncConsultation(r: ConsultationRecord, pageId: string | undefined) {
    return this.upsert(r.id, pageId, consultationProperties(r), consultationBlocks(r));
  }

  private async boardRoom(): Promise<BoardRoomIds> {
    this.ids ??= await readBoardRoomIds(this.root);
    if (!this.ids) throw new Error("Notion Board Room is not set up yet — run npm run board:notion -- --apply");
    return this.ids;
  }

  private async upsert(id: string, knownPageId: string | undefined, properties: Json, blocks: Json[]): Promise<{ pageId: string; url: string }> {
    const { dataSourceId } = await this.boardRoom();
    let pageId = knownPageId;
    if (!pageId) {
      const found = await this.notion.request<{ results: { id: string }[] }>("POST", `/data_sources/${dataSourceId}/query`, {
        filter: { property: "Zain HQ ID", rich_text: { equals: id } },
        page_size: 1,
      });
      pageId = found.results[0]?.id;
    }
    const page = pageId
      ? await this.notion.request<{ id: string; url: string }>("PATCH", `/pages/${pageId}`, { properties })
      : await this.notion.request<{ id: string; url: string }>("POST", "/pages", {
          parent: { type: "data_source_id", data_source_id: dataSourceId },
          properties,
        });
    for (const child of await this.notion.children(page.id)) {
      await this.notion.request("DELETE", `/blocks/${String(child.id)}`);
    }
    await this.notion.append(page.id, blocks);
    return { pageId: page.id, url: page.url };
  }
}
