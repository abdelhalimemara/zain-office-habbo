import { SPEECH_MAX_CHARS, speechText } from "../../server/src/voice/speech";

describe("speechText", () => {
  it("strips markdown symbols, links, code fences and markup", () => {
    const md = [
      "<!-- zain-meeting:mtg_1:2 -->",
      "## My view",
      "",
      "> **Short answer:** _yes_, with ~~no~~ conditions.",
      "- Price on [value](https://example.com/value), not cost.",
      "* See https://example.com/raw for `numbers`.",
      "```ts",
      "const x = 1;",
      "```",
      "| Option | Cost |",
      "|---|:---:|",
      "| Cairo | 2m |",
      "---",
      "VOTE: approve",
    ].join("\n");
    expect(speechText(md)).toBe(
      ["My view", "", "Short answer: yes, with no conditions.", "Price on value, not cost.", "See for numbers.", "", "Option Cost", "", "Cairo 2m", "", "VOTE: approve"].join("\n"),
    );
  });

  it("keeps Arabic text and snake_case words intact", () => {
    expect(speechText("**رأيي:** نعم، بشروط. use eleven_multilingual_v2")).toBe("رأيي: نعم، بشروط. use eleven_multilingual_v2");
  });

  it("caps long text at a sentence end within the limit", () => {
    const sentence = "Volume beats overhead every single time. ";
    const out = speechText(sentence.repeat(200));
    expect(out.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
    expect(out.length).toBeGreaterThan(SPEECH_MAX_CHARS - sentence.length);
    expect(out.endsWith("time.")).toBe(true);
    expect(speechText("word ".repeat(2000)).length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
  });

  it("is empty when there is nothing to say", () => {
    expect(speechText("```\ncode only\n```\n<!-- marker -->")).toBe("");
  });
});
