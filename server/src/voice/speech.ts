/** ElevenLabs takes up to 5000 characters per request; leave headroom. */
export const SPEECH_MAX_CHARS = 4500;

/** Ends of sentences in English and Arabic. */
const SENTENCE_END = /[.!?؟۔\n]/;

/** Cuts at the last sentence end within `max` (or the last space, if no sentence ends late enough). */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  for (let i = head.length - 1; i >= max / 2; i--) {
    if (SENTENCE_END.test(head[i]!)) return head.slice(0, i + 1).trim();
  }
  const space = head.lastIndexOf(" ");
  return (space > max / 2 ? head.slice(0, space) : head).trim();
}

/** A turn's text as it should be spoken: no markdown symbols, links, code or markup. */
export function speechText(text: string, max = SPEECH_MAX_CHARS): string {
  const plain = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/\|/g, " ")
    .replace(/^[ \t:]*[-*_=][ \t:*_=-]*$/gm, " ")
    .replace(/\*\*|__|~~|\*/g, "")
    .replace(/(^|[\s(])_(\S(?:[^_]*\S)?)_(?=$|[\s).,;:!?])/gm, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cap(plain, max);
}
