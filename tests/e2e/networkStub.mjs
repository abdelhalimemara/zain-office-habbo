// Preloaded into the real server (node --import) by the e2e harness. The server has no setting for
// the headcount source, so GitHub is answered from this fixture, and every other non-loopback request
// (and the real Hermes port) is refused so a test can never leak to the network or the user's Hermes.

const TREE_URL = "https://api.github.com/repos/cbrock84/headcount/";
const RAW_URL = "https://raw.githubusercontent.com/cbrock84/headcount/";
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
  const loopback = LOOPBACK.exec(url);
  if (!loopback || loopback[2] === REAL_HERMES_PORT) {
    throw new TypeError(`e2e network stub refused ${url}`);
  }
  return realFetch(input, init);
};
