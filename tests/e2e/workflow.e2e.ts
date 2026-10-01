import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentsInDivision } from "../../shared/roster";
import type { CreateTaskInput, UpdateTaskInput } from "../../shared/hermes";
import { clickThrough, enterBuilding, scanHits } from "./canvas";
import { approvalsBadge, hudStatus, openApp, realErrors, startStack, type Stack } from "./harness";
import { until } from "./processes";

const TASKS = "/api/plugins/kanban/tasks";
let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
});

afterAll(async () => {
  await stack?.stop();
});

describe("HQ mandate → approval workflow", () => {
  it("golden path: load, send a mandate to Zain Studio, see it awaiting approval, approve it", async () => {
    const { page, hermes } = stack;
    hermes.homeChannel = true;
    await openApp(stack);

    await page.waitFor(
      `!!document.querySelector('.zui-dot-item[title="Hermes: reachable"]') && !!document.querySelector('.zui-dot-item[title="Telegram: connected"]')`,
      "HUD shows Hermes + Telegram connected",
      15_000,
    );
    await page.waitFor("document.querySelector('.app-world canvas')?.width > 64", "world rendered");
    await new Promise((r) => setTimeout(r, 1500));
    expect(realErrors(page)).toEqual([]);
    await stack.shot("city");

    await page.click(".zui-hud button", "New mandate");
    await page.waitFor("__e2e.text('[role=dialog] h2') === 'New mandate'", "mandate dialog");
    await page.select("#mandate-division", "studio");
    expect(await page.eval("__e2e.text('[role=dialog] .zui-hint')")).toContain("zain-studio-vp");
    await page.type("#mandate-title", "Launch film for Zain Studio");
    await page.type("#mandate-brief", "Storyboard and cut a 30s launch film.");
    await page.click("[role=dialog] button", "Send mandate");
    await page.waitFor("__e2e.text('[role=dialog] h2') === 'Mandate sent'", "mandate sent confirmation");

    const creates = hermes.called("POST", TASKS);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.query.get("board")).toBe("zain-group");
    const sent = creates[0]!.body as CreateTaskInput;
    expect(sent).toMatchObject({
      title: "Launch film for Zain Studio",
      assignee: "zain-studio-vp",
      tenant: "zain-studio",
      triage: true,
      priority: 0,
    });
    expect(sent.body).toContain("Storyboard and cut a 30s launch film.");
    for (const member of agentsInDivision("studio").filter((a) => a.rank !== "vp")) {
      expect(sent.body).toContain(`\`${member.profile}\``);
    }
    expect(sent.body).not.toMatch(/zain-(hq|growth|labs|tech)-/);
    expect(hermes.called("POST", /\/home-subscribe\/telegram$/)).toHaveLength(1);
    expect(await page.eval("__e2e.text('[role=dialog]')")).toContain("You'll get Telegram updates");

    await page.click("[role=dialog] button", "Close");
    await page.waitFor("!document.querySelector('[role=dialog]')", "dialog closed");
    expect(await approvalsBadge(page)).toBeNull();

    const id = [...hermes.tasks.keys()][0]!;
    hermes.setStatus(id, "review", { latest_summary: "Storyboard + three cuts delivered.", result: "Final roll-up from VP Studio" });
    const flagged = Date.now();
    await page.waitFor("document.querySelector('.zui-hud .zui-count--alert')?.textContent === '1'", "approval badge = 1", 8_000);
    expect(Date.now() - flagged).toBeLessThan(6_000);

    await page.click(".zui-hud button", "Approvals, 1 pending");
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (1)'", "approvals inbox");
    const inbox = await page.eval<string>("__e2e.text('.zui-panel')");
    expect(inbox).toContain("Launch film for Zain Studio");
    expect(inbox).toContain("Storyboard + three cuts delivered.");
    expect(inbox).toContain("VP Studio");
    await stack.shot("approvals");

    await page.type(".zui-approval textarea", "Ship it");
    await page.click(".zui-approval button", "Approve");
    await until(() => hermes.tasks.get(id)!.status === "done", "task done in Hermes");
    const task = hermes.tasks.get(id)!;
    expect(task.result).toBe("Final roll-up from VP Studio");
    expect(hermes.comments.get(id)).toEqual([expect.objectContaining({ author: "zain-hq-ui", body: "Approved by HQ: Ship it" })]);
    const patch = hermes.called("PATCH", `${TASKS}/${id}`)[0]!.body as UpdateTaskInput;
    expect(patch).toMatchObject({ status: "done", summary: "Approved by HQ: Ship it" });

    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (0)'", "inbox empties");
    expect(await approvalsBadge(page)).toBeNull();
    expect(realErrors(page)).toEqual([]);
  });

  it("reject path: a reason is required, then the mandate goes back to the division manager", async () => {
    const { page, hermes } = stack;
    // Review was routed to a specialist; rejecting must re-pin the mandate to the VP.
    const task = hermes.seedTask({
      title: "Q4 rebrand deck",
      tenant: "zain-studio",
      assignee: "zain-studio-brand",
      status: "review",
      latest_summary: "Deck v1 ready",
    });
    await openApp(stack);
    await page.waitFor("document.querySelector('.zui-hud .zui-count--alert')?.textContent === '1'", "approval badge = 1", 8_000);
    await page.click(".zui-hud button", "Approvals, 1 pending");
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (1)'", "approvals inbox");

    await page.click(".zui-approval button", "Request changes");
    await page.waitFor("__e2e.text('.zui-approval .zui-error') === 'A reason is required to request changes.'", "inline reason error");
    expect(await page.eval("document.querySelector('.zui-approval textarea').getAttribute('aria-invalid')")).toBe("true");
    expect(hermes.called("PATCH", `${TASKS}/${task.id}`)).toHaveLength(0);
    expect(hermes.called("POST", `${TASKS}/${task.id}/comments`)).toHaveLength(0);

    await page.type(".zui-approval textarea", "Needs an Arabic version of every slide");
    expect(await page.eval("document.querySelector('.zui-approval .zui-error')")).toBeNull();
    await page.click(".zui-approval button", "Request changes");
    await until(() => hermes.tasks.get(task.id)!.assignee === "zain-studio-vp", "mandate re-pinned to the VP");

    expect(hermes.tasks.get(task.id)!.status).toBe("ready");
    expect(hermes.comments.get(task.id)).toEqual([
      expect.objectContaining({ author: "zain-hq-ui", body: "Changes requested by HQ: Needs an Arabic version of every slide" }),
    ]);
    const patches = hermes.called("PATCH", `${TASKS}/${task.id}`).map((c) => c.body);
    expect(patches).toEqual([{ status: "todo" }, { assignee: "zain-studio-vp" }]);
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (0)'", "inbox empties");
    expect(realErrors(page)).toEqual([]);
  });

  it("navigation: building click enters the floor, VP click opens the kanban, others open their card, breadcrumb returns", async () => {
    const { page } = stack;
    await page.reducedMotion(true);
    await openApp(stack);

    const entered = await enterBuilding(page, "Zain Studio");
    expect(entered.at(-1)?.result).toBe("Zain Studio");
    await page.waitFor("!!__e2e.find('.zui-breadcrumb button', '‹ City')", "breadcrumb back link");
    await new Promise((r) => setTimeout(r, 800));
    await stack.shot("studio-floor");

    const panelTitle = () => page.eval<string>("__e2e.text('.zui-panel h2') ?? ''");
    const hits = await scanHits(page);
    expect(hits.length).toBeGreaterThan(0);
    let kanbanShot = false;
    const outcomes = await clickThrough(
      page,
      hits,
      6,
      async () => {
        const title = await panelTitle();
        if (title === "Zain Studio · Kanban" && !kanbanShot) {
          kanbanShot = true;
          await page.waitFor("!!document.querySelector('.zui-kanban')", "kanban columns");
          await stack.shot("studio-kanban");
        }
        return title;
      },
      (o) => o.some((x) => x.result === "Zain Studio · Kanban") && o.some((x) => x.result && x.result !== "Zain Studio · Kanban"),
      async (title) => {
        if (title) await page.press("Escape");
      },
    );
    const results = outcomes.map((o) => o.result);
    expect(results).toContain("Zain Studio · Kanban");
    // A specialist click opens their agent card (the panel title is their roster title).
    const studioTitles = agentsInDivision("studio").filter((a) => a.rank !== "vp").map((a) => a.title);
    expect(results.some((r) => studioTitles.includes(r))).toBe(true);

    await page.press("Escape");
    await page.click(".zui-breadcrumb button", "‹ City");
    await page.waitFor("__e2e.text('.zui-breadcrumb [aria-current=page]') === 'City'", "back in the city");
    expect(await hudStatus(page, "Hermes")).toBe("Hermes: reachable");
    expect(realErrors(page)).toEqual([]);
    await page.reducedMotion(false);
  });
});
