import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentsInDivision } from "../../shared/roster";
import type { CreateTaskInput, UpdateTaskInput } from "../../shared/hermes";
import type { Page } from "./browser";
import { clickThrough, enterBuilding, scanHits } from "./canvas";
import { approvalsBadge, hudStatus, openApp, realErrors, startStack, type Stack } from "./harness";
import { sleep, until } from "./processes";

const TASKS = "/api/plugins/kanban/tasks";
const MANDATE = "Launch film for Zain Studio";
const ROLL_UP = "Roll-up: storyboard approved by Brand, three cuts delivered by Video.";
let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
});

afterAll(async () => {
  await stack?.stop();
});

/** Text of the kanban card whose title contains `title`, or null. */
const card = (page: Page, title: string) =>
  page.eval<string | null>(
    `[...document.querySelectorAll('.zui-panel .zui-card')].find((c) => c.textContent.includes(${JSON.stringify(title)}))?.textContent ?? null`,
  );

/** aria-label of the lane holding that card, e.g. "Blocked (1)". */
const laneOf = (page: Page, title: string) =>
  page.eval<string | null>(
    `[...document.querySelectorAll('.zui-panel .zui-card')].find((c) => c.textContent.includes(${JSON.stringify(title)}))?.closest('section')?.getAttribute('aria-label') ?? null`,
  );

/** Page expression: the mandate's kanban card exists and contains `text`. */
const mandateCardHas = (text: string) =>
  `!!([...document.querySelectorAll('.zui-panel .zui-card')].find((c) => c.textContent.includes(${JSON.stringify(MANDATE)}))?.textContent.includes(${JSON.stringify(text)}))`;

async function openStudioKanban(page: Page): Promise<void> {
  const here = await page.eval<string>("__e2e.text('.zui-breadcrumb [aria-current=page]') ?? ''");
  if (here !== "Zain Studio") expect((await enterBuilding(page, "Zain Studio")).at(-1)?.result).toBe("Zain Studio");
  await page.click(".zui-hud button", "Kanban");
  await page.waitFor("__e2e.text('.zui-panel h2') === 'Zain Studio · Kanban'", "studio kanban");
}

describe("HQ mandate → VP fan-out → approval", () => {
  it("golden path: mandate goes to the VP, subtasks show progress, the roll-up is approved and kept as the result", async () => {
    const { page, hermes } = stack;
    hermes.homeChannel = true;
    await openApp(stack);
    await page.waitFor(
      `!!document.querySelector('.zui-dot-item[title="Hermes: reachable"]') && !!document.querySelector('.zui-dot-item[title="Telegram: connected"]')`,
      "HUD shows Hermes + Telegram connected",
      15_000,
    );
    await page.waitFor("document.querySelector('.app-world canvas')?.width > 64", "world rendered");
    await sleep(1500);
    expect(await page.eval("!!document.querySelector('.zui-hud [role=alert]')")).toBe(false);
    expect(realErrors(page)).toEqual([]);
    await stack.shot("city");

    await page.click(".zui-hud button", "New mandate");
    await page.waitFor("__e2e.text('[role=dialog] h2') === 'New mandate'", "mandate dialog");
    await page.select("#mandate-division", "studio");
    await page.type("#mandate-title", MANDATE);
    await page.type("#mandate-brief", "Storyboard and cut a 30s launch film.");
    await page.click("[role=dialog] button", "Send mandate");
    await page.waitFor("__e2e.text('[role=dialog] h2') === 'Mandate sent'", "mandate sent confirmation");

    const creates = hermes.called("POST", TASKS);
    expect(creates).toHaveLength(1);
    const sent = creates[0]!.body as CreateTaskInput;
    expect(sent).toMatchObject({ title: MANDATE, assignee: "zain-studio-vp", tenant: "zain-studio", triage: false, priority: 0 });
    expect(sent.body).toContain("Storyboard and cut a 30s launch film.");
    for (const step of ["kanban_create", "kanban_link(parent_id=<subtask id>, child_id=", 'kanban_block(kind="dependency"', "kanban_request_review"]) {
      expect(sent.body).toContain(step);
    }
    for (const member of agentsInDivision("studio").filter((a) => a.rank !== "vp")) expect(sent.body).toContain(`\`${member.profile}\``);
    expect(sent.body).not.toMatch(/zain-(hq|growth|labs|tech)-/);
    expect(hermes.called("POST", /\/home-subscribe\/telegram$/)).toHaveLength(1);
    await page.click("[role=dialog] button", "Close");

    const id = [...hermes.tasks.keys()][0]!;
    expect(hermes.tasks.get(id)!.status).toBe("ready");
    await openStudioKanban(page);
    await page.waitFor(mandateCardHas(MANDATE), "mandate card");
    expect(await laneOf(page, MANDATE)).toBe("Ready (1)");

    // The VP follows the protocol: two team subtasks linked as parents, mandate blocked on them.
    const [brand, video] = hermes.fanOut(id, [
      { title: "Storyboard the launch film", assignee: "zain-studio-brand" },
      { title: "Cut three launch film edits", assignee: "zain-studio-video" },
    ]);
    await page.waitFor(mandateCardHas("0/2 subtasks"), "0/2 subtasks", 8_000);
    expect(await laneOf(page, MANDATE)).toBe("Blocked (1)");
    expect(await laneOf(page, "Storyboard the launch film")).toBe("Ready (2)");

    hermes.complete(brand!.id, "Storyboard approved");
    await page.waitFor(mandateCardHas("1/2 subtasks"), "1/2 subtasks", 8_000);
    hermes.complete(video!.id, "Three cuts delivered");
    await page.waitFor(mandateCardHas("2/2 subtasks"), "2/2 subtasks", 8_000);
    expect(await laneOf(page, MANDATE)).toBe("Ready (1)");
    expect(await card(page, MANDATE)).not.toMatch(/\d+\/\d+ done/);
    await stack.shot("studio-kanban-progress");

    await page.click(".zui-panel .zui-card", MANDATE);
    await page.waitFor(`__e2e.text('.zui-panel h2') === ${JSON.stringify(MANDATE)}`, "task drawer");
    await page.waitFor("document.querySelectorAll('.zui-panel [aria-label=Subtasks] li').length === 2", "subtasks in drawer");
    const drawer = await page.eval<string>("__e2e.text('.zui-panel')");
    expect(drawer).toContain("2/2 subtasks done");
    expect(drawer).toContain("Storyboard the launch film");
    expect(drawer).toContain("Cut three launch film edits");
    await stack.shot("task-subtasks");
    await page.press("Escape");

    expect(await approvalsBadge(page)).toBeNull();
    hermes.requestReview(id, ROLL_UP);
    const flagged = Date.now();
    await page.waitFor("document.querySelector('.zui-hud .zui-count--alert')?.textContent === '1'", "approval badge = 1", 8_000);
    expect(Date.now() - flagged).toBeLessThan(6_000);

    await page.click(".zui-hud button", "Approvals, 1 pending");
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (1)'", "approvals inbox");
    expect(await page.eval("__e2e.text('.zui-panel')")).toContain(ROLL_UP);
    await stack.shot("approvals");
    await page.click(".zui-approval button", "Approve & close");
    await page.waitFor("!!document.querySelector('.zui-approval [role=group][aria-label=\"Confirm close\"]')", "close confirmation");
    expect(hermes.tasks.get(id)!.status).toBe("review");
    await page.click(".zui-approval [role=group] button", "Confirm");
    await until(() => hermes.tasks.get(id)!.status === "done", "mandate done in Hermes");

    expect(hermes.tasks.get(id)!.result).toBe(ROLL_UP);
    const patch = hermes.called("PATCH", `${TASKS}/${id}`)[0]!.body as UpdateTaskInput;
    expect(patch).toEqual({ status: "done", summary: "Approved by HQ", result: ROLL_UP });
    expect(hermes.comments.get(id)).toEqual([expect.objectContaining({ author: "zain-hq-ui", body: "Approved by HQ" })]);
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (0)'", "inbox empties");
    expect(await approvalsBadge(page)).toBeNull();
    expect(realErrors(page)).toEqual([]);
  });

  it("a specialist's own task in review is not an HQ approval: no badge, listed only under subtask reviews", async () => {
    const { page, hermes } = stack;
    const task = hermes.seedTask({ title: "Brand voice audit", tenant: "zain-studio", assignee: "zain-studio-brand", status: "review", latest_summary: "Audit done" });
    await openApp(stack);
    await until(async () => JSON.stringify(await (await fetch(`${stack.serverUrl}/api/board`)).json()).includes(task.id), "task on the board");
    await sleep(3_500); // one full board poll after load
    expect(await approvalsBadge(page)).toBeNull();
    await page.click(".zui-hud button", "Approvals");
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (0)'", "empty approvals");
    const inbox = await page.eval<string>("__e2e.text('.zui-panel')");
    expect(inbox).toContain("Nothing awaiting HQ approval.");
    expect(inbox).toContain("Subtasks waiting for review (1)");
    expect(inbox.indexOf("Brand voice audit")).toBeGreaterThan(inbox.indexOf("Subtasks waiting for review (1)"));
    await page.press("Escape");
  });

  it("send back path: instructions are required, then the mandate goes back to the VP", async () => {
    const { page, hermes } = stack;
    const task = hermes.seedTask({ title: "Q4 rebrand deck", tenant: "zain-studio", assignee: "zain-studio-vp", status: "review", latest_summary: "Deck v1 ready" });
    await openApp(stack);
    await page.waitFor("document.querySelector('.zui-hud .zui-count--alert')?.textContent === '1'", "approval badge = 1", 8_000);
    await page.click(".zui-hud button", "Approvals, 1 pending");
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (1)'", "approvals inbox");

    await page.click(".zui-approval button", "Send back to VP");
    await page.waitFor("__e2e.text('.zui-approval .zui-error') === 'Write instructions for VP Studio to send this back.'", "inline instructions error");
    expect(await page.eval("document.querySelector('.zui-approval textarea').getAttribute('aria-invalid')")).toBe("true");
    expect(hermes.called("PATCH", `${TASKS}/${task.id}`)).toHaveLength(0);

    await page.type(".zui-approval textarea", "Needs an Arabic version of every slide");
    await page.click(".zui-approval button", "Send back to VP");
    await until(() => hermes.tasks.get(task.id)!.status === "ready", "mandate reopened");
    expect(hermes.tasks.get(task.id)!.assignee).toBe("zain-studio-vp");
    expect(hermes.comments.get(task.id)).toEqual([
      expect.objectContaining({ author: "zain-hq-ui", body: "Changes requested by HQ: Needs an Arabic version of every slide" }),
    ]);
    expect(hermes.called("PATCH", `${TASKS}/${task.id}`).map((c) => c.body)).toEqual([{ status: "todo" }]);
    await page.waitFor("__e2e.text('.zui-panel h2') === 'Approvals (0)'", "inbox empties");
    expect(realErrors(page)).toEqual([]);
  });

  it("kanban lanes at 1400x900: Awaiting HQ and Done fit beside the floor, empty lanes collapse", async () => {
    const { page } = stack;
    await openApp(stack);
    await openStudioKanban(page);
    await page.waitFor("document.querySelectorAll('.zui-panel .zui-card').length >= 5", "cards loaded");
    await sleep(400); // let the 160ms slide-in finish before measuring
    const lanes = await page.eval<{ label: string; collapsed: boolean; inView: boolean; box: string }[]>(`(() => {
      const panel = document.querySelector('.zui-panel').getBoundingClientRect();
      return [...document.querySelectorAll('.zui-kanban > section')].map((s) => {
        const r = s.getBoundingClientRect();
        return { label: s.getAttribute('aria-label'), collapsed: s.classList.contains('zui-lane--collapsed'),
          inView: r.width > 0 && r.left >= panel.left && r.right <= Math.min(panel.right, innerWidth) + 0.5,
          box: Math.round(r.left) + '..' + Math.round(r.right) + ' in ' + Math.round(panel.left) + '..' + Math.round(panel.right) };
      });
    })()`);
    expect(lanes.map((l) => l.label)).toEqual(["Inbox (0)", "Ready (1)", "Working (0)", "Blocked (1)", "Awaiting HQ (0)", "Done (3)"]);
    for (const l of lanes) expect(l.collapsed, l.label).toBe(l.label.endsWith("(0)"));
    expect(lanes.filter((l) => !l.inView)).toEqual([]);
    // Awaiting HQ holds mandates only; a specialist's parked review is a blocker for the VP.
    expect(await laneOf(page, "Brand voice audit")).toBe("Blocked (1)");
    const panelWidth = await page.eval<number>("document.querySelector('.zui-panel').getBoundingClientRect().width");
    expect(panelWidth).toBeLessThanOrEqual(Math.min(720, 1400 * 0.52) + 0.5);
    await stack.shot("studio-kanban");
    await page.press("Escape");
  });

  it("kanban lane tabs at 390x844", async () => {
    const { page } = stack;
    await page.reducedMotion(true);
    await openApp(stack, { w: 390, h: 844, mobile: true });
    await openStudioKanban(page);
    await page.waitFor("document.querySelectorAll('.zui-panel [role=tab]').length === 6", "six lane tabs");
    expect(await page.eval("!!document.querySelector('.zui-panel .zui-kanban')")).toBe(false);
    expect(await page.eval("__e2e.text('.zui-panel [role=tab][aria-selected=true]')")).toBe("Blocked 1");
    expect(await page.eval("__e2e.text('.zui-panel [role=tabpanel]')")).toContain("Brand voice audit");
    await page.click(".zui-panel [role=tab]", "Done");
    await page.waitFor("__e2e.text('.zui-panel [role=tab][aria-selected=true]') === 'Done 3'", "Done tab selected");
    expect(await page.eval("__e2e.text('.zui-panel [role=tabpanel]')")).toContain(MANDATE);
    await page.click(".zui-panel [role=tab]", "Working");
    await page.waitFor("__e2e.text('.zui-panel [role=tabpanel]') === 'Nothing here.'", "empty lane hint");
    await page.click(".zui-panel [role=tab]", "Ready");
    expect(await page.eval<boolean>("(() => { const p = document.querySelector('.zui-panel'); return p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= innerWidth + 1; })()")).toBe(true);
    await stack.shot("mobile-kanban");
    await page.press("Escape");
    await page.reducedMotion(false);
  });

  it("navigation: building click enters the floor, VP click opens the kanban, others open their card, breadcrumb returns", async () => {
    const { page } = stack;
    await page.reducedMotion(true);
    await openApp(stack);
    expect((await enterBuilding(page, "Zain Studio")).at(-1)?.result).toBe("Zain Studio");
    await page.waitFor("!!__e2e.find('.zui-breadcrumb button', '‹ City')", "breadcrumb back link");
    await sleep(800);
    await stack.shot("studio-floor");

    const panelTitle = () => page.eval<string>("__e2e.text('.zui-panel h2') ?? ''");
    const outcomes = await clickThrough(
      page,
      await scanHits(page),
      6,
      panelTitle,
      (o) => o.some((x) => x.result === "Zain Studio · Kanban") && o.some((x) => x.result && x.result !== "Zain Studio · Kanban"),
      async (title) => {
        if (title) await page.press("Escape");
      },
    );
    const results = outcomes.map((o) => o.result);
    expect(results).toContain("Zain Studio · Kanban");
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
