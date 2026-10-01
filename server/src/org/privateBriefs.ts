import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Reads a board member's private brief; it is only ever embedded into that member's SOUL. */
export type BriefReader = (profile: string) => Promise<string>;

export function briefPath(profile: string): string {
  return `.zain/board/${profile}.md`;
}

/**
 * Briefs live at `<root>/.zain/board/<profile>.md` (gitignored, like hires.json). Errors name the
 * path only, never the content, because they surface in hire steps and script output.
 */
export function fileBriefs(root: string): BriefReader {
  return async (profile) => {
    if (!/^zain-board-[a-z0-9-]+$/.test(profile)) throw new Error(`invalid board profile ${profile}`);
    let text: string;
    try {
      text = await readFile(join(root, briefPath(profile)), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(code === "ENOENT" ? `missing private brief ${briefPath(profile)}` : `cannot read private brief ${briefPath(profile)} (${code ?? "error"})`);
    }
    if (!text.trim()) throw new Error(`empty private brief ${briefPath(profile)}`);
    return text;
  };
}
