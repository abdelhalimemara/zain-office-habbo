import { mandateBody, profileDescription, soulFor } from "../../server/src/org/persona";
import { HQ_API } from "../../server/src/org/techPersona";
import { ROSTER, findAgent } from "../../shared/roster";
import { TECH_TEAMS, type TechTeam } from "../../shared/techTeams";

const soul = (profile: string, teams?: readonly TechTeam[]) => soulFor(findAgent(profile)!, ROSTER, teams);
const vp = soul("zain-tech-vp");
const head = soul("zain-tech-storelens-head");
const pm = soul("zain-tech-storelens-pm");
const specialist = soul("zain-tech-storelens-frontend");
const platform = soul("zain-tech-devops");

function hireCurl(text: string): Record<string, unknown> {
  const match = /curl -sS -X POST (\S+)\/hire -H 'Content-Type: application\/json' -d '([^']+)'/.exec(text);
  expect(match).not.toBeNull();
  expect(match![1]).toBe(HQ_API);
  return JSON.parse(match![2]!) as Record<string, unknown>;
}

describe("Zain Tech personas", () => {
  it("gives every tech agent the git rules", () => {
    for (const s of [vp, head, pm, specialist, platform]) {
      expect(s).toContain("## Git rules (Zain Tech, non-negotiable)");
      expect(s).toMatch(/NEVER force-push/);
      expect(s).toMatch(/never rewrite published history/);
      expect(s).toMatch(/Never change repo settings, branch protection, collaborators, webhooks, secrets/);
      expect(s).toMatch(/Deploys and releases need HQ approval/);
      expect(s).toContain("zain/<task-id>-<slug>");
      expect(s).toContain("~/ZainTech/<team>/<repo>");
      expect(s).toMatch(/Never commit secrets/);
      expect(s).toMatch(/tests, typecheck and lint before opening a PR/);
    }
    expect(soul("zain-studio-vp")).not.toContain("Git rules");
  });

  it("lets only Head Engineers merge", () => {
    expect(head).toMatch(/You are the only one on the team who merges/);
    expect(head).toContain("gh pr merge");
    for (const s of [specialist]) expect(s).toMatch(/Never merge/);
    expect(pm).toMatch(/you do not write code/);
    expect(pm).not.toMatch(/only one on the team who merges/);
  });

  it("has the VP fan mandates out to team leads only", () => {
    expect(vp).toContain("## Your organisation (you own every team)");
    for (const t of TECH_TEAMS) {
      expect(vp).toContain(`\`${t.repo}\``);
      expect(vp).toContain(`   - \`zain-tech-${t.id}-head\``);
      expect(vp).toContain(`   - \`zain-tech-${t.id}-pm\``);
    }
    expect(vp).not.toContain("   - `zain-tech-storelens-frontend`");
    expect(vp).not.toContain("   - `zain-tech-fullstack`");
    expect(vp).toMatch(/Never assign work to specialists yourself/);
    expect(vp).toContain('kanban_request_review(reviewer=\\"zain-tech-vp\\")'.replace(/\\"/g, '"'));
    expect(vp).toMatch(/That review is yours, not HQ's/);
    expect(vp).toContain("kanban_request_changes");
  });

  it("documents the hiring curl with a valid JSON body for a team specialist", () => {
    const body = hireCurl(vp);
    expect(body).toMatchObject({ division: "tech", rank: "specialist", team: "storelens", teamRole: "specialist", reportsTo: "zain-tech-storelens-head" });
    expect((body.skills as string[]).every((s) => s.startsWith("agency:"))).toBe(true);
    expect(vp).toMatch(/Hiring \(no approval needed\)/);
    expect(vp).toContain(`${HQ_API}/tech/teams`);
  });

  it("has the Head Engineer fan out to their own specialists and request review from the VP, not HQ", () => {
    expect(head).toContain("`abdelhalimemara/storelens`");
    expect(head).toContain("~/ZainTech/storelens/storelens");
    expect(head).toContain("   - `zain-tech-storelens-frontend`");
    expect(head).toContain("   - `zain-tech-security` — Security Reviewer (shared)");
    expect(head).not.toContain("   - `zain-tech-bookme-frontend`");
    expect(head).toContain("kanban_link(parent_id=<subtask id>, child_id=<your task id>)");
    expect(head).toContain('kanban_block(kind="dependency"');
    expect(head).toContain('kanban_request_review(summary=<roll-up>, reviewer="zain-tech-vp")');
    expect(head).toMatch(/never to HQ/);
    expect(head).toMatch(/Do NOT pass `parents`/);
    const order = ["kanban_create", "kanban_link", "kanban_block", "gh pr diff", "kanban_request_review"].map((t) => head.indexOf(t));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("has the PM own scope, the weekly status on the tracking task and risk escalation", () => {
    expect(pm).toContain('"StoreLens · Team charter & status"');
    expect(pm).toMatch(/weekly team status as a comment/);
    expect(pm).toMatch(/Escalate risks .* to the VP Tech/);
    expect(pm).toMatch(/You never assign engineering work/);
  });

  it("has specialists open a PR, link it on the task for their Head Engineer and complete", () => {
    expect(specialist).toContain("gh pr create");
    expect(specialist).toContain("Request review from your Head Engineer (`zain-tech-storelens-head`)");
    expect(specialist).toContain("kanban_comment");
    expect(specialist).toContain("kanban_complete");
    expect(specialist).toContain("Your focus: React web app");
  });

  it("gives platform specialists cross-team instructions", () => {
    expect(platform).toContain("## Shared platform team");
  });

  it("puts the team's stack and focus in profile descriptions", () => {
    const description = profileDescription(findAgent("zain-tech-bookme-payments")!);
    expect(description).toContain("BookMe · Payments Engineer");
    expect(description).toContain("Moyasar");
    expect(description).toContain("payments billing engineer");
    expect(description.length).toBeLessThanOrEqual(400);
  });

  it("writes Zain Tech mandates with the lead fan-out and includes runtime teams", () => {
    const extra = { id: "zainpay", name: "Zain Pay", repo: "abdelhalimemara/zainpay", summary: "Payments." };
    const body = mandateBody("Brief", findAgent("zain-tech-vp")!, ROSTER, [...TECH_TEAMS, extra]);
    expect(body).toContain("`zainpay`");
    expect(body).toContain("   - `zain-tech-website-pm`");
    expect(soul("zain-tech-vp", [...TECH_TEAMS, extra])).toContain("### Zain Pay (`zainpay`, repo `abdelhalimemara/zainpay`)");
  });
});
