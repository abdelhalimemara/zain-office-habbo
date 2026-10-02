import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export interface Prompter {
  ask(question: string, options?: { hidden?: boolean; fallback?: string }): Promise<string>;
  close(): void;
}

/** Terminal prompts; hidden answers are never echoed (keystrokes are swallowed, not masked). */
export function terminalPrompter(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Prompter {
  let muted = false;
  const echo = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) output.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input, output: echo, terminal: true });
  return {
    ask: (question, { hidden = false, fallback } = {}) =>
      new Promise((resolve) => {
        output.write(fallback ? `${question} [${fallback}]: ` : `${question}: `);
        muted = hidden;
        rl.question("", (answer) => {
          muted = false;
          if (hidden) output.write("\n");
          resolve(answer.trim() || fallback || "");
        });
      }),
    close: () => rl.close(),
  };
}
