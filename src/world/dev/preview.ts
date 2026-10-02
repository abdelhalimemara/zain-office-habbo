import { DIVISION_IDS, type DivisionId } from "../../../shared/divisions";
import type { AgentActivity, DivisionStats } from "../../../shared/flow";
import { ROSTER } from "../../../shared/roster";
import { World, type WorldAgent, type WorldView } from "../index";

const ACTIVITIES: AgentActivity[] = ["working", "blocked", "awaiting-approval", "queued", "idle"];
const params = new URLSearchParams(location.search);

function mockAgents(): WorldAgent[] {
  const agents: WorldAgent[] = ROSTER.map((a, i) => ({
    profile: a.profile,
    title: a.title,
    division: a.division,
    rank: a.rank,
    activity: a.rank === "board" ? "working" : ACTIVITIES[i % ACTIVITIES.length]!,
    bubble: i % 3 === 0 ? "Q4 launch brief" : undefined,
    hired: params.get("vacant") === "all" ? false : a.rank === "board" || i % 7 !== 6,
  }));
  const extraBoard = [
    { profile: "zain-board-bezos", title: "Board · Jeff Bezos" },
    { profile: "zain-board-buffett", title: "Board · Warren Buffett" },
    { profile: "zain-board-jobs", title: "Board · Steve Jobs" },
  ];
  for (const b of extraBoard) {
    if (agents.some((a) => a.profile === b.profile)) continue;
    agents.push({ ...b, division: "hq", rank: "board", activity: "idle", hired: params.get("board") === "all" });
  }
  return agents;
}

function mockStats(): Record<DivisionId, DivisionStats> {
  const out = {} as Record<DivisionId, DivisionStats>;
  DIVISION_IDS.forEach((d, i) => {
    out[d] = { working: 2 + i, blocked: i % 2, awaitingApproval: i % 3 === 0 ? 0 : i, queued: 3, done: 10 };
  });
  return out;
}

const stage = document.getElementById("stage")!;
const report = (msg: unknown) => {
  document.getElementById("log")!.textContent = `ERROR: ${msg instanceof Error ? `${msg.message} ${msg.stack}` : String(msg)}`;
};
window.addEventListener("error", (e) => report(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => report(e.reason));
const log = document.getElementById("log")!;
const bar = document.getElementById("bar")!;
let agents = mockAgents();

const insetValues = (params.get("insets") ?? "").split(",").map(Number);
const insets = { top: insetValues[0] || 0, right: insetValues[1] || 0, bottom: insetValues[2] || 0, left: insetValues[3] || 0 };

const world = await World.create(stage, {
  onSelectBuilding: (d) => {
    log.textContent = `building: ${d}`;
    world.setView({ kind: "floor", division: d });
  },
  onSelectAgent: (p) => {
    log.textContent = `agent: ${p}`;
    world.setSelectedAgent(p);
  },
}, { insets, debugHotspots: params.get("debug") === "hotspots" });

const initial: WorldView = params.get("view") && params.get("view") !== "city"
  ? { kind: "floor", division: params.get("view") as DivisionId }
  : { kind: "city" };
world.setView(initial);
if (params.get("agents") !== "none") world.setAgents(agents);
world.setDivisionStats(mockStats());
if (params.get("select")) world.setSelectedAgent(params.get("select"));

const button = (label: string, fn: () => void) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  bar.appendChild(b);
};
button("city", () => world.setView({ kind: "city" }));
for (const d of DIVISION_IDS) button(d, () => world.setView({ kind: "floor", division: d }));
button("shuffle", () => {
  agents = agents.map((a) => ({ ...a, activity: ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)]! }));
  world.setAgents(agents);
});
button("panel", () => world.setInsets({ ...insets, right: insets.right ? 0 : 420 }));
button("destroy", () => world.destroy());

Object.assign(window, { world });
