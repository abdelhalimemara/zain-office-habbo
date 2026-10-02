import { splitBySpeaker } from "../../shared/voice";
const sp = [{ tag: "Hormozi", profile: "h", name: "H" }, { tag: "Jobs", profile: "j", name: "J" }];
describe("splitBySpeaker", () => {
  it("splits tagged parts; untagged text that opens a message comes back without a speaker", () => {
    expect(splitBySpeaker("Welcome. <Hormozi>Open it.</Hormozi><Jobs>Only if great", sp)).toEqual([
      { tag: null, text: "Welcome." }, { tag: "Hormozi", text: "Open it." }, { tag: "Jobs", text: "Only if great" },
    ]);
    expect(splitBySpeaker("  ", sp)).toEqual([]);
  });

  it("gives untagged text after a tagged part to that speaker: there is no chair", () => {
    expect(splitBySpeaker("<Hormozi>Raise it.</Hormozi> Then test. <Jobs>No.</Jobs> Really.", sp)).toEqual([
      { tag: "Hormozi", text: "Raise it. Then test." }, { tag: "Jobs", text: "No. Really." },
    ]);
    expect(splitBySpeaker("<Chair>Order.</Chair>", sp)).toEqual([{ tag: null, text: "<Chair>Order.</Chair>" }]);
  });
});
