import { boardSoul } from "../../server/src/org/boardPersona";
import { approvalsSection } from "../../server/src/telegram/ceoSoul";
import {
  decide,
  marker,
  minutesTaskBody,
  parseVote,
  roundKind,
  roundLabel,
  roundTaskBody,
  transcript,
  voteRound,
  votesSummary,
} from "../../server/src/board/meetings/rounds";
import { findBoardMember } from "../../shared/board";
import type { BoardMeeting, MeetingVote } from "../../shared/meetings";

const meeting = (over: Partial<BoardMeeting> = {}): BoardMeeting => ({
  id: "mtg_0000000001",
  topic: "Raise prices",
  brief: "Should Studio raise retainers 20%?",
  members: ["zain-board-hormozi", "zain-board-buffett"],
  boardOnly: false,
  discussionRounds: 2,
  status: "in-round",
  currentRound: 1,
  turns: [],
  votes: [],
  requestedBy: "hq",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("round sequence", () => {
  it("is opening → discussion × N → vote", () => {
    expect([1, 2, 3, 4].map((r) => roundKind(r, 2))).toEqual(["opening", "discussion", "discussion", "vote"]);
    expect([1, 2, 3, 4].map((r) => roundLabel(r, 2))).toEqual(["Opening", "Discussion 1", "Discussion 2", "Vote"]);
    expect(voteRound(2)).toBe(4);
    expect(roundKind(2, 0)).toBe("vote");
    expect(marker("mtg_1", 3)).toBe("<!-- zain-meeting:mtg_1:3 -->");
  });

  it("writes the transcript by speaker title and round", () => {
    const text = transcript(
      [
        { round: 1, kind: "opening", speaker: "zain-board-hormozi", text: "Raise.", at: 1 },
        { round: 1, kind: "opening", speaker: "founder", text: "Be careful.", at: 2 },
        { round: 2, kind: "discussion", speaker: "zain-board-buffett", text: "Agree with Alex.", at: 3 },
      ],
      2,
    );
    expect(text).toBe(
      "--- Round 1 · Opening ---\nAlex Hormozi: Raise.\n\nFounder (Abdelhalim): Be careful.\n\n--- Round 2 · Discussion 1 ---\nWarren Buffett: Agree with Alex.",
    );
  });

  it("puts the rules, transcript, remarks and the vote contract into round tasks", () => {
    const m = meeting({ turns: [{ round: 1, kind: "opening", speaker: "founder", text: "Mind churn.", at: 1 }] });
    const vote = roundTaskBody(m, 4);
    expect(vote).toContain("Round 4 of 4 · Vote");
    expect(vote).toContain("VOTE: approve|approve-with-conditions|reject|abstain");
    expect(vote).toContain("CONDITIONS:");
    expect(vote).toContain("- Mind churn.");
    const discussion = roundTaskBody(m, 2);
    expect(discussion).toContain("Address your colleagues by name");
    expect(discussion).not.toContain("VOTE:");
  });
});

describe("vote parsing", () => {
  it.each([
    ["VOTE: approve\nGreat offer.", { vote: "approve", rationale: "Great offer." }],
    ["vote: Approve with conditions\nCONDITIONS: test first\nWhy not.", { vote: "approve-with-conditions", conditions: "test first", rationale: "Why not." }],
    ["**VOTE:** REJECT\n\nToo risky.", { vote: "reject", rationale: "Too risky." }],
    ["\n VOTE: abstain\nConflicted.", { vote: "abstain", rationale: "Conflicted." }],
    ["VOTE: approve_with_conditions\nCONDITIONS: cap at 10%\n", { vote: "approve-with-conditions", conditions: "cap at 10%", rationale: "" }],
  ])("parses %j", (text, expected) => expect(parseVote("m", text)).toEqual({ member: "m", ...expected }));

  it.each(["I approve.", "VOTE: maybe\nhmm", "", "My vote: approve"])("treats malformed %j as abstain with the raw text", (text) => {
    expect(parseVote("m", text)).toEqual({ member: "m", vote: "abstain", rationale: text.trim() || "(no answer)" });
  });
});

describe("decision", () => {
  const v = (vote: MeetingVote["vote"]): MeetingVote => ({ member: "x", vote, rationale: "" });
  it.each([
    [["approve", "approve", "reject"], "approved"],
    [["approve", "approve-with-conditions", "reject"], "approved-with-conditions"],
    [["reject", "reject", "approve"], "rejected"],
    [["approve", "reject"], "no-decision"],
    [["abstain", "abstain"], "no-decision"],
    [["approve", "abstain", "abstain"], "approved"],
  ] as const)("%j → %s", (votes, decision) => expect(decide(votes.map(v))).toBe(decision));

  it("summarises the count", () => {
    expect(votesSummary(["approve", "approve", "approve", "approve-with-conditions", "reject"].map((x) => v(x as never)))).toBe(
      "Approve 3 · Conditions 1 · Reject 1",
    );
    expect(votesSummary([])).toBe("No votes");
  });

  it("asks the chair for concise minutes with the votes", () => {
    const body = minutesTaskBody(
      meeting({ votes: [{ member: "zain-board-hormozi", vote: "approve", rationale: "Price on value." }], decision: "approved" }),
    );
    expect(body.startsWith("<!-- zain-meeting:mtg_0000000001:minutes -->")).toBe(true);
    expect(body).toContain("- Alex Hormozi: approve — Price on value.");
    expect(body).toContain("Decision: approved (Approve 1)");
    expect(body).toContain("actions with owners");
  });
});

describe("meeting conduct in SOULs", () => {
  it("tells advisors how to behave in meetings", () => {
    const soul = boardSoul(findBoardMember("zain-board-hormozi")!);
    expect(soul).toContain("## Board meetings");
    expect(soul).toContain("engage with your colleagues' points by name");
    expect(soul).toContain("Change your mind when you are persuaded, and say so plainly.");
    expect(soul).toContain("VOTE: approve|approve-with-conditions|reject|abstain");
  });

  it("tells the CEO how to convene, chair and relay", () => {
    const text = approvalsSection(8787);
    expect(text).toContain("### Board meetings");
    expect(text).toContain(`curl -sS -X POST http://127.0.0.1:8787/api/board/meetings -H 'Content-Type: application/json' -d '{"topic":"<short topic>"`);
    expect(text).toContain('"requestedBy":"ceo"');
    expect(text).toMatch(/tell the user how it ended: the decision and how the vote went/);
    expect(text).toContain("/board/meetings/<meeting id>/remarks");
    expect(text).toContain('"tell the board: …"');
  });
});
