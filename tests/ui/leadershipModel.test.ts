import { describe, expect, it } from "vitest";
import { ACTION_DETAIL_MAX, ACTIONS_MAX, type ActionItem } from "@shared/leadership";
import type { BoardMeeting } from "@shared/meetings";
import { worldInsets } from "../../src/app/worldModel";
import { meetingsPollInterval, MEETING_POLL_IDLE_MS } from "../../src/api/meetingHooks";
import { railVisible } from "../../src/state/rail";
import { assignFailures } from "../../src/ui/ActionReview";
import {
  draftsFrom,
  hasErrors,
  meetingsOfKind,
  mondayOf,
  newDraft,
  priorityCounts,
  seatLabel,
  sortByPriority,
  toUpdateRequest,
  validateReview,
} from "../../src/ui/leadershipModel";
import { LIVE_COPY } from "../../src/ui/liveModel";
import { rosterEntries } from "./helpers";

const action = (id: string, partial: Partial<ActionItem> = {}): ActionItem => ({ id, division: "hq", title: `T ${id}`, detail: "", priority: "P2", status: "proposed", ...partial });

describe("leadershipModel", () => {
  it("filters meetings by kind, a missing kind being board", () => {
    const ms = [
      { id: "a", updatedAt: 1 },
      { id: "b", kind: "leadership" as const, updatedAt: 3 },
      { id: "c", kind: "board" as const, updatedAt: 2 },
      { id: "d", kind: "leadership" as const, updatedAt: 5 },
    ];
    expect(meetingsOfKind(ms, "board").map((m) => m.id)).toEqual(["c", "a"]);
    expect(meetingsOfKind(ms, "leadership").map((m) => m.id)).toEqual(["d", "b"]);
    expect(meetingsOfKind(undefined, "board")).toEqual([]);
  });

  it("labels seats by role and anyone else by roster name", () => {
    expect(seatLabel("default", rosterEntries)).toBe("CEO");
    expect(seatLabel("zain-labs-vp", rosterEntries)).toBe("VP Labs");
    expect(seatLabel("zain-hq-accounts", rosterEntries)).toBe("Ahmad Al Zain");
  });

  it("finds the Monday of the week", () => {
    expect(mondayOf(new Date(2026, 9, 2)).getDate()).toBe(28);
    expect(mondayOf(new Date(2026, 8, 28)).getDate()).toBe(28);
    expect(mondayOf(new Date(2026, 9, 4)).getDate()).toBe(28);
  });

  it("drops dropped actions, sorts P1 first stably, and counts priorities", () => {
    const rows = draftsFrom([action("a", { priority: "P3" }), action("b", { priority: "P1" }), action("c", { status: "dropped" }), action("d", { priority: "P1" })]);
    expect(rows.map((r) => r.id)).toEqual(["b", "d", "a"]);
    expect(priorityCounts(rows)).toEqual({ P1: 2, P2: 0, P3: 1 });
    expect(sortByPriority([{ priority: "P2" as const, n: 1 }, { priority: "P1" as const, n: 2 }, { priority: "P2" as const, n: 3 }]).map((r) => r.n)).toEqual([2, 1, 3]);
  });

  it("validates titles, detail, due dates, priorities and the action cap", () => {
    const ok = draftsFrom([action("a")]);
    expect(hasErrors(validateReview("x", ok))).toBe(false);
    const bad = [{ ...ok[0]!, title: "  ", detail: "d".repeat(ACTION_DETAIL_MAX + 1), due: "2026-02-30" }];
    expect(validateReview("x", bad).rows.a).toEqual({ title: "Give the action a title.", detail: `Keep the detail to ${ACTION_DETAIL_MAX} characters.`, due: "Use a real date." });
    expect(validateReview("x", Array.from({ length: ACTIONS_MAX + 1 }, () => newDraft())).list).toBe(`At most ${ACTIONS_MAX} actions.`);
    // An assigned row is a mandate already: it is never re-validated.
    expect(hasErrors(validateReview("", [{ ...bad[0]!, status: "assigned" }]))).toBe(false);
  });

  it("builds the PUT body with trimmed text and no empty due date", () => {
    const rows = [...draftsFrom([action("a", { title: " Ship ", due: "2026-10-09" })]), { ...newDraft("P1", "tech"), title: "New" }];
    const body = toUpdateRequest(" P ", rows);
    expect(body.priorities).toBe("P");
    expect(body.actions[0]).toEqual({ id: "a", division: "hq", title: "Ship", detail: "", priority: "P2", due: "2026-10-09" });
    expect(body.actions[1]).toMatchObject({ division: "tech", title: "New", priority: "P1" });
    expect(body.actions[1]!.id).toMatch(/^local-/);
    expect(body.actions[1]).not.toHaveProperty("due");
  });

  it("reads per-action assign failures from results, else from what stayed proposed", () => {
    const meeting = { outcome: { priorities: "", actions: [action("a", { status: "assigned", taskId: "t1" }), action("b")] } } as BoardMeeting;
    expect(assignFailures(["a", "b"], { meeting })).toEqual({ b: "The mandate wasn't created." });
    expect(assignFailures(["a", "b"], { meeting, results: [{ id: "a", ok: true, taskId: "t1" }, { id: "b", ok: false, error: "VP not hired" }] })).toEqual({ b: "VP not hired" });
  });

  it("treats assigned meetings as settled for polling", () => {
    expect(meetingsPollInterval([{ status: "assigned" }])).toBe(MEETING_POLL_IDLE_MS);
  });

  it("insets the world and hides the rail for the leadership panel like the meeting room", () => {
    const viewport = { width: 1440, height: 900 };
    expect(worldInsets("leadership", viewport, 56)).toEqual(worldInsets("meeting", viewport, 56));
    expect(railVisible({ kind: "city" }, "leadership")).toBe(false);
  });

  it("words the live room for each kind", () => {
    expect(LIVE_COPY.board.endButton).toBe("End meeting & vote");
    expect(LIVE_COPY.leadership.endButton).toBe("End meeting & draft tasks");
  });
});
