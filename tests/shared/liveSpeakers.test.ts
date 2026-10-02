import { splitBySpeaker } from "../../shared/voice";
const sp = [{ tag: "Hormozi", profile: "h", name: "H" }, { tag: "Jobs", profile: "j", name: "J" }];
describe("splitBySpeaker", () => {
  it("splits tagged parts and keeps untagged text for the chair", () => {
    expect(splitBySpeaker("Welcome. <Hormozi>Open it.</Hormozi><Jobs>Only if great", sp)).toEqual([
      { tag: null, text: "Welcome." }, { tag: "Hormozi", text: "Open it." }, { tag: "Jobs", text: "Only if great" },
    ]);
    expect(splitBySpeaker("  ", sp)).toEqual([]);
  });
});
