import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { END_MARKER, START_MARKER, approvalsSection, installCeoApprovals, withApprovals } from "../../server/src/telegram/ceoSoul";
import { setup } from "./helpers";

const ORIGINAL = "# CEO\n\nYou are the CEO of Zain Group.\n";

function ceo(initial: string) {
  let soul = initial;
  const s = setup({
    "GET /api/profiles/default/soul": () => ({ content: soul, exists: true }),
    "PUT /api/profiles/default/soul": (c) => {
      soul = (c.body as { content: string }).content;
      return { ok: true };
    },
  });
  return { ...s, soul: () => soul, puts: () => s.hermesFetch.called("PUT /api/profiles/default/soul") };
}

let dir: string;
const lines: string[] = [];
const run = (h: ReturnType<typeof ceo>, apply: boolean) =>
  installCeoApprovals({ hermes: h.hermes, apply, port: 8787, root: dir, now: () => new Date("2026-10-02T09:30:00Z"), log: (l) => lines.push(l) });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zain-ceo-"));
  lines.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("approvalsSection", () => {
  const text = approvalsSection(8787);

  it("is bounded by the markers and scoped to the zain-group board", () => {
    expect(text.startsWith(START_MARKER)).toBe(true);
    expect(text.endsWith(END_MARKER)).toBe(true);
    expect(text).toContain("board `zain-group`");
  });

  it("tells the CEO exactly how to apply each decision through Zain HQ", () => {
    expect(text).toContain("Reply *approve*, or *send back:* <instructions>.");
    expect(text).toContain(`curl -sS -X POST http://127.0.0.1:8787/api/approvals/<id>/approve -H 'Content-Type: application/json' -d '{"note":"via Telegram"}'`);
    expect(text).toContain(`http://127.0.0.1:8787/api/approvals/<id>/reject -H 'Content-Type: application/json' -d '{"reason":"<their words>"}'`);
    expect(text).toContain(`http://127.0.0.1:8787/api/tasks/<id>/unblock -H 'Content-Type: application/json' -d '{"instructions":"<their words>"}'`);
    expect(text).toContain("✅ <title> is done.");
    expect(text).toMatch(/409 means it was already decided/);
    expect(text).toMatch(/Connection refused means Zain HQ is not running/);
    expect(text).toMatch(/Never approve or send back without an explicit reply/);
    expect(text).toMatch(/Use only task ids that came from a wake message/);
  });

  it("uses the configured server port", () => {
    expect(approvalsSection(9000)).toContain("http://127.0.0.1:9000/api/approvals");
  });
});

describe("withApprovals", () => {
  const section = approvalsSection(8787);

  it("appends once and is idempotent", () => {
    const once = withApprovals(ORIGINAL, section);
    expect(once).toBe(`${ORIGINAL}\n${section}\n`);
    expect(withApprovals(once, section)).toBe(once);
  });

  it("replaces only the text between the markers", () => {
    const soul = `Intro\n\n${START_MARKER}\nold rules\n${END_MARKER}\n\nOutro stays exactly\n`;
    expect(withApprovals(soul, section)).toBe(`Intro\n\n${section}\n\nOutro stays exactly\n`);
  });
});

describe("installCeoApprovals", () => {
  it("never writes without --apply and prints the change", async () => {
    const h = ceo(ORIGINAL);
    expect(await run(h, false)).toBe("dry-run");
    expect(h.puts()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
    expect(lines).toContain(`+ ${START_MARKER}`);
    expect(lines.some((l) => l.startsWith("Dry run."))).toBe(true);
  });

  it("backs up the current SOUL before writing, then becomes a no-op", async () => {
    const h = ceo(ORIGINAL);
    expect(await run(h, true)).toBe("written");
    const backups = await readdir(join(dir, ".zain"));
    expect(backups).toEqual(["ceo-soul.backup-2026-10-02T09-30-00-000Z.md"]);
    expect(await readFile(join(dir, ".zain", backups[0]!), "utf8")).toBe(ORIGINAL);
    expect(h.soul()).toBe(withApprovals(ORIGINAL, approvalsSection(8787)));
    expect(h.soul().startsWith(ORIGINAL)).toBe(true);

    lines.length = 0;
    expect(await run(h, true)).toBe("unchanged");
    expect(h.puts()).toHaveLength(1);
    expect(await readdir(join(dir, ".zain"))).toHaveLength(1);
  });

  it("shows and replaces an outdated section, keeping the surrounding text", async () => {
    const h = ceo(`${ORIGINAL}\n${START_MARKER}\nold rules\n${END_MARKER}\nP.S. keep me\n`);
    await run(h, true);
    expect(lines).toContain("- old rules");
    expect(h.soul()).toBe(`${ORIGINAL}\n${approvalsSection(8787)}\nP.S. keep me\n`);
  });
});
