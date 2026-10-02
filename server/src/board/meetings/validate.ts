import {
  FOUNDER_REMARK_MAX,
  MAX_DISCUSSION_ROUNDS,
  MEETING_BRIEF_MAX,
  MEETING_TOPIC_MAX,
  type BoardMeeting,
  type FounderRemarkRequest,
  type MeetingMode,
  type StartMeetingRequest,
} from "../../../../shared/meetings";
import { TASK_ID, badRequest, requiredString } from "../../http";

export type MeetingRequest = StartMeetingRequest & { requestedBy: BoardMeeting["requestedBy"] };

const REQUESTERS: readonly BoardMeeting["requestedBy"][] = ["hq", "ceo", "board"];
const MODES: readonly MeetingMode[] = ["chat", "voice"];
const NEXT: readonly NonNullable<FounderRemarkRequest["next"]>[] = ["continue", "extra-round", "to-vote"];

export function parseStartMeeting(body: Record<string, unknown>): MeetingRequest {
  const topic = requiredString(body, "topic", 1, MEETING_TOPIC_MAX);
  const brief = requiredString(body, "brief", 1, MEETING_BRIEF_MAX);
  const members = body.members;
  if (members !== undefined && (!Array.isArray(members) || members.length === 0 || !members.every((m) => typeof m === "string"))) {
    throw badRequest("members must be a non-empty array of board profiles");
  }
  if (body.boardOnly !== undefined && typeof body.boardOnly !== "boolean") throw badRequest("boardOnly must be a boolean");
  const mode = body.mode ?? "chat";
  if (!MODES.includes(mode as MeetingMode)) throw badRequest("mode must be chat or voice");
  const rounds = body.discussionRounds ?? 1;
  if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 1 || rounds > MAX_DISCUSSION_ROUNDS) {
    throw badRequest(`discussionRounds must be an integer in 1..${MAX_DISCUSSION_ROUNDS}`);
  }
  const related = body.relatedTaskId;
  if (related !== undefined && related !== null && (typeof related !== "string" || !TASK_ID.test(related))) {
    throw badRequest("relatedTaskId must be a task id");
  }
  const requestedBy = body.requestedBy ?? "hq";
  if (!REQUESTERS.includes(requestedBy as BoardMeeting["requestedBy"])) throw badRequest("requestedBy must be hq, ceo or board");
  return {
    topic,
    brief,
    ...(members ? { members: [...new Set(members as string[])] } : {}),
    boardOnly: body.boardOnly === true,
    mode: mode as MeetingMode,
    discussionRounds: rounds,
    ...(typeof related === "string" ? { relatedTaskId: related } : {}),
    requestedBy: requestedBy as BoardMeeting["requestedBy"],
  };
}

export function parseRemark(body: Record<string, unknown>): Required<FounderRemarkRequest> {
  const text = requiredString(body, "text", 1, FOUNDER_REMARK_MAX);
  const next = body.next ?? "continue";
  if (!NEXT.includes(next as (typeof NEXT)[number])) throw badRequest("next must be continue, extra-round or to-vote");
  return { text, next: next as Required<FounderRemarkRequest>["next"] };
}

const MEETING_ID = /^mtg_[a-f0-9]{10}$/;

export function meetingIdParam(id: string | undefined): string {
  if (!id || !MEETING_ID.test(id)) throw badRequest("invalid meeting id");
  return id;
}
