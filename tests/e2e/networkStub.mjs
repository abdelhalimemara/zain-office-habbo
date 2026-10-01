import cp from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

// Preloaded into the real server (node --import) by the e2e harness. The server has no setting for
// the headcount source, so GitHub is answered from this fixture, and every other non-loopback request
// (and the real Hermes port) is refused so a test can never leak to the network or the user's Hermes.

// Must match HEADCOUNT_REF in server/src/headcount/catalog.ts; any other ref answers 404, so an
// unpinned fetch shows up as a failed install-skill step in the hire scenario.
const PINNED_REF = "98d1c17d480f606060102a781f9a8601690685f7";
const TREE_URL = `https://api.github.com/repos/cbrock84/headcount/git/trees/${PINNED_REF}?`;
const RAW_URL = `https://raw.githubusercontent.com/cbrock84/headcount/${PINNED_REF}/`;
const GITHUB = /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//;
const SKILL_FILE = /plugins\/([a-z0-9-]+)\/skills\/([a-z0-9-]+)\/SKILL\.md$/;
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):(\d+)\//;
const REAL_HERMES_PORT = "9119";

export const E2E_SKILL_MARKER = "E2E_STUB_SKILL_BODY";

const SKILLS = {
  marketing: ["brand-voice", "video-content", "visual-content", "marketing-copywriting", "social-post-craft"],
  product: ["brand-identity", "design-system", "interface-craft", "visual-reference-generation"],
  technology: ["code-review", "api-design"],
};

const tree = Object.entries(SKILLS).flatMap(([dept, skills]) =>
  skills.map((skill) => ({ path: `plugins/${dept}/skills/${skill}/SKILL.md`, type: "blob" })),
);

// The server shells out to the `hermes` CLI (HERMES_BIN), which writes to the user's real ~/.hermes.
// Record what HERMES_BIN this process sees, and refuse to run any `hermes` binary but the stub.
const stubBin = process.env.E2E_HERMES_STUB;
if (process.env.E2E_SERVER_ENV_FILE) {
  appendFileSync(process.env.E2E_SERVER_ENV_FILE, `${JSON.stringify({ pid: process.pid, HERMES_BIN: process.env.HERMES_BIN ?? null })}\n`);
}
const mayRun = (file) => {
  const f = String(file);
  if (/(^|\/)hermes$/.test(f) || f.includes("/.local/bin/hermes")) return false;
  return f === stubBin || !/hermes/i.test(f.split("/").pop() ?? "");
};
const refused = (file) => new Error(`e2e isolation: refused to run ${file}`);
for (const name of ["execFile", "spawn", "execFileSync", "spawnSync"]) {
  const original = cp[name];
  const guarded = function (file, ...rest) {
    if (!mayRun(file)) throw refused(file);
    return original.call(this, file, ...rest);
  };
  if (original[promisify.custom]) {
    guarded[promisify.custom] = (file, ...rest) => (mayRun(file) ? original[promisify.custom](file, ...rest) : Promise.reject(refused(file)));
  }
  cp[name] = guarded;
}
syncBuiltinESMExports();

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(TREE_URL)) {
    return new Response(JSON.stringify({ tree }), { headers: { "Content-Type": "application/json" } });
  }
  if (url.startsWith(RAW_URL)) {
    const match = SKILL_FILE.exec(url);
    if (!match) return new Response("not found", { status: 404 });
    const [, dept, skill] = match;
    const md = `---\nname: ${skill}\ndescription: Use for ${skill} work in ${dept}.\n---\n\n# ${skill}\n\n${E2E_SKILL_MARKER} ${dept}:${skill}\n`;
    return new Response(md, { headers: { "Content-Type": "text/markdown" } });
  }
  if (GITHUB.test(url)) return new Response(JSON.stringify({ message: "Not Found (unpinned ref)" }), { status: 404 });
  const loopback = LOOPBACK.exec(url);
  if (!loopback || loopback[2] === REAL_HERMES_PORT) {
    throw new TypeError(`e2e network stub refused ${url}`);
  }
  return realFetch(input, init);
};
