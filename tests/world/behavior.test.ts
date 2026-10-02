import { EmoteDirector, dirFacing, finishEmote, seatPose, segmentFacing, stateEmote, type EmoteInput } from "../../src/world/behavior";

describe("facing", () => {
  it("maps plan directions to avatar facings", () => {
    expect(dirFacing("+y")).toBe("SW");
    expect(dirFacing("+x")).toBe("SE");
    expect(dirFacing("-y")).toBe("NE");
    expect(dirFacing("-x")).toBe("NW");
  });

  it("faces the screen direction of each walk segment", () => {
    expect(segmentFacing(1, 0, "SW")).toBe("SE");
    expect(segmentFacing(0, 1, "SE")).toBe("SW");
    expect(segmentFacing(-1, 0, "SW")).toBe("NW");
    expect(segmentFacing(0, -1, "SW")).toBe("NE");
    expect(segmentFacing(1, 1, "SE")).toBe("SE");
    expect(segmentFacing(1, 1, "NW")).toBe("SW");
    expect(segmentFacing(1, -1, "NE")).toBe("NE");
    expect(segmentFacing(0, 0, "NW")).toBe("NW");
  });
});

describe("poses and emotes", () => {
  it("types while working and sits otherwise", () => {
    expect(seatPose({ activity: "working", hired: true })).toBe("type");
    expect(seatPose({ activity: "blocked", hired: true })).toBe("sit");
    expect(seatPose({ activity: "working", hired: false })).toBe("sit");
    expect(stateEmote("blocked")).toBe("frustrated");
    expect(stateEmote("awaiting-approval")).toBe("thinking");
    expect(stateEmote("queued")).toBe("none");
    expect([finishEmote(2), finishEmote(3)]).toEqual(["celebrate", "thumbsUp"]);
  });

  const base: EmoteInput = { activity: "working", hired: true, selected: false, walking: false, restingMs: 0, current: "none" };

  it("loops frustration while blocked and clears it afterwards", () => {
    const d = new EmoteDirector(1);
    expect(d.next({ ...base, activity: "blocked" }, 16)).toBe("frustrated");
    expect(d.next({ ...base, activity: "blocked", current: "frustrated" }, 16)).toBeNull();
    expect(d.next({ ...base, activity: "working", current: "frustrated" }, 16)).toBe("none");
  });

  it("thinks on entering awaiting approval and again every few seconds", () => {
    const d = new EmoteDirector(1);
    expect(d.next({ ...base, activity: "awaiting-approval" }, 16)).toBe("thinking");
    expect(d.next({ ...base, activity: "awaiting-approval", current: "thinking" }, 3000)).toBeNull();
    expect(d.next({ ...base, activity: "awaiting-approval" }, 5000)).toBe("thinking");
  });

  it("celebrates finished work, waves once when selected and gets sleepy after a long idle rest", () => {
    const d = new EmoteDirector(4);
    d.next(base, 16);
    expect(d.next({ ...base, activity: "idle" }, 16)).toBe("celebrate");
    expect(d.next({ ...base, activity: "idle", selected: true }, 16)).toBe("wave");
    expect(d.next({ ...base, activity: "idle", selected: true }, 16)).toBeNull();
    expect(d.next({ ...base, activity: "idle", restingMs: 20_000 }, 16)).toBe("sleepy");
    expect(d.next({ ...base, activity: "idle", walking: true, current: "sleepy" }, 16)).toBe("none");
  });

  it("keeps vacant agents emote-free", () => {
    const d = new EmoteDirector(1);
    expect(d.next({ ...base, hired: false, activity: "blocked" }, 16)).toBeNull();
    expect(d.next({ ...base, hired: false, current: "wave" }, 16)).toBe("none");
  });
});
