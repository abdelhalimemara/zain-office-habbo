import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RosterResponse } from "../../shared/api";
import { enterBuilding } from "./canvas";
import { hudStatus, openApp, realErrors, startStack, type Stack } from "./harness";
import { sleep, until } from "./processes";

const E2E_SKILL_MARKER = "E2E_STUB_SKILL_BODY";
let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
});

afterAll(async () => {
  await stack?.stop();
});

/** Raw HTTP so the test controls Host/Origin exactly (fetch would normalise them). */
function raw(base: string, method: string, path: string, headers: Record<string, string>, body?: string): Promise<number> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("operations", () => {
  it("hire: a new Zain Studio specialist with two headcount skills", async () => {
    const { page, hermes } = stack;
    await openApp(stack);
    await page.click(".zui-hud button", "Hire");
    await page.waitFor("__e2e.text('[role=dialog] h2') === 'Hire an agent'", "hire dialog");
    await page.select("#hire-division", "studio");
    await page.type("#hire-title", "Motion Designer");
    expect(await page.eval("document.querySelector('#hire-profile').value")).toBe("zain-studio-motion-designer");
    expect(await page.eval("document.querySelector('#hire-reports').value")).toBe("zain-studio-vp");
    await page.waitFor("document.querySelectorAll('[role=dialog] .zui-skill-group').length > 0", "headcount catalog");
    await page.click("[role=dialog] .zui-check", "brand-voice");
    await page.click("[role=dialog] .zui-check", "video-content");
    expect(await page.eval("[...document.querySelectorAll('[role=dialog] .zui-chips button')].map((b) => b.getAttribute('aria-label'))")).toEqual([
      "Remove marketing:brand-voice",
      "Remove marketing:video-content",
    ]);
    await stack.shot("hire");

    await page.click("[role=dialog] button[type=submit]", "Hire");
    await page.waitFor("__e2e.text('[role=dialog] h2') === 'Hired'", "hire result", 20_000);
    const steps = await page.eval<string[]>("[...document.querySelectorAll('[role=dialog] .zui-step')].map((li) => li.className + ' ' + li.textContent.trim())");
    expect(steps).toHaveLength(5);
    expect(steps.every((s) => s.includes("zui-step--ok"))).toBe(true);
    expect(steps.join("\n")).toMatch(/create-profile zain-studio-motion-designer[\s\S]*write-soul[\s\S]*describe[\s\S]*install-skill marketing:brand-voice[\s\S]*install-skill marketing:video-content/);
    await stack.shot("hire-result");

    const name = "zain-studio-motion-designer";
    const created = hermes.called("POST", "/api/profiles");
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toEqual({ name, clone_from: "default", clone_channels: false, description: expect.stringContaining("Motion Designer") });
    expect(hermes.souls.get(name)).toContain("You report to VP Studio (`zain-studio-vp`)");
    expect(hermes.descriptions.get(name)).toContain("Zain Studio · Motion Designer (specialist)");
    expect(hermes.skills.map((s) => [s.name, s.profile, s.category])).toEqual([
      ["hc-marketing-brand-voice", name, "headcount"],
      ["hc-marketing-video-content", name, "headcount"],
    ]);
    for (const s of hermes.skills) expect(s.content).toContain(E2E_SKILL_MARKER);
    const order = hermes.calls.filter((c) => c.method !== "GET" && !c.path.startsWith("/api/plugins/kanban")).map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual([
      "POST /api/profiles",
      `PUT /api/profiles/${name}/soul`,
      `PUT /api/profiles/${name}/description`,
      "POST /api/skills",
      "POST /api/skills",
    ]);

    const roster = (await (await fetch(`${stack.serverUrl}/api/roster`)).json()) as RosterResponse;
    expect(roster.agents.find((a) => a.profile === name)).toMatchObject({ hired: true, division: "studio", reportsTo: "zain-studio-vp" });
    await page.click("[role=dialog] button", "Done");
    expect(realErrors(page)).toEqual([]);
  });

  it("security smoke against the running server (and through the Vite proxy)", async () => {
    const { serverUrl, webUrl, hermes } = stack;
    const before = hermes.calls.length;
    const host = new URL(serverUrl).host;
    const json = { "Content-Type": "application/json", Host: host };
    const mandate = JSON.stringify({ division: "studio", title: "x" });

    expect(await raw(serverUrl, "POST", "/api/mandates", { "Content-Type": "text/plain", Host: host }, mandate)).toBe(415);
    expect(await raw(serverUrl, "POST", "/api/mandates", { ...json, Origin: "http://evil.example" }, mandate)).toBe(403);
    expect(await raw(serverUrl, "POST", "/api/mandates", { ...json, "Sec-Fetch-Site": "cross-site" }, mandate)).toBe(403);
    expect(await raw(serverUrl, "GET", "/api/health", { Host: "evil.example" })).toBe(403);
    expect(await raw(serverUrl, "GET", "/api/health", { Host: `evil.example:${new URL(serverUrl).port}` })).toBe(403);
    // DNS rebinding via the dev proxy: Vite forwards the foreign Host and the server refuses it.
    expect(await raw(webUrl, "GET", "/api/health", { Host: "evil.example" })).toBe(403);
    // Only :5173, the server's own port and ZAIN_ALLOWED_ORIGINS are trusted; another local port is not.
    expect(await raw(serverUrl, "POST", "/api/mandates", { ...json, Origin: "http://127.0.0.1:1" }, mandate)).toBe(403);
    expect(await raw(serverUrl, "POST", "/api/mandates", { ...json, Origin: `http://localhost:${new URL(webUrl).port}0` }, mandate)).toBe(403);
    // Control: well-formed requests from trusted origins pass the guard and reach validation.
    const invalid = JSON.stringify({ division: "nope", title: "x" });
    expect(await raw(serverUrl, "POST", "/api/mandates", { ...json, Origin: `http://${host}` }, invalid)).toBe(400);
    expect(await raw(serverUrl, "POST", "/api/mandates", { ...json, Origin: webUrl }, invalid)).toBe(400);
    expect(hermes.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("re-scrapes the session token when Hermes rotates it", async () => {
    const { page, hermes } = stack;
    await openApp(stack);
    await page.waitFor(`!!document.querySelector('.zui-dot-item[title="Hermes: reachable"]')`, "Hermes reachable");
    hermes.token = "rotated-token-after-hermes-restart";
    const res = await fetch(`${stack.serverUrl}/api/board`);
    expect(res.status).toBe(200);
    expect(hermes.calls.filter((c) => c.path === "/").length).toBeGreaterThanOrEqual(2);
  });

  it("mobile layout screenshots (390x844)", async () => {
    const { page } = stack;
    await openApp(stack, { w: 390, h: 844, mobile: true });
    await page.waitFor("document.querySelector('.app-world canvas')?.width > 64", "world rendered");
    await sleep(800);
    await stack.shot("mobile-city");
    const hudOverflow = await page.eval<boolean>("(() => { const h = document.querySelector('.zui-hud'); return h.scrollWidth > h.clientWidth + 1 || h.getBoundingClientRect().right > innerWidth + 1; })()");
    await page.click(".zui-hud button", "Approvals");
    await page.waitFor("(__e2e.text('.zui-panel h2') ?? '').startsWith('Approvals')", "approvals");
    await stack.shot("mobile-approvals");
    await page.press("Escape");
    await page.click(".zui-hud button", "Hire");
    await page.waitFor("document.querySelectorAll('[role=dialog] .zui-skill-group').length > 0", "hire dialog with catalog");
    await stack.shot("mobile-hire");
    await page.press("Escape");
    expect(hudOverflow).toBe(false);
  });

  it("review dispatch warning: shown when Hermes' kanban.review_dispatch is on (or unset), hidden when off", async () => {
    const { page, hermes } = stack;
    const alert = "document.querySelector('.zui-hud [role=alert]')?.textContent ?? null";
    const health = async () => ((await (await fetch(`${stack.serverUrl}/api/health`)).json()) as { reviewDispatch: string }).reviewDispatch;

    hermes.reviewDispatch = false;
    expect(await health()).toBe("off");
    await openApp(stack);
    await page.waitFor(`!!document.querySelector('.zui-dot-item[title="Hermes: reachable"]')`, "Hermes reachable");
    expect(await page.eval(alert)).toBeNull();

    hermes.reviewDispatch = true;
    expect(await health()).toBe("on");
    await openApp(stack);
    const text = await page.waitFor<string>(alert, "review dispatch warning");
    expect(text).toBe("Hermes review agent is on: it can approve mandates before HQ sees them.");
    await stack.shot("review-dispatch");
    await openApp(stack, { w: 390, h: 844, mobile: true });
    await page.waitFor(alert, "review dispatch warning (mobile)");
    await stack.shot("mobile-review-dispatch");

    hermes.reviewDispatch = undefined;
    expect(await health()).toBe("on");
    hermes.reviewDispatch = false;
    await page.waitFor(`!(${alert})`, "warning clears on the next health poll", 15_000);
  });

  it.fails("KNOWN BUG: side panels (top: 64px) cover the review-dispatch banner, which makes the HUD 88px tall on desktop", async () => {
    const { page, hermes } = stack;
    hermes.reviewDispatch = true;
    try {
      await openApp(stack);
      await page.waitFor("!!document.querySelector('.zui-hud [role=alert]')", "review dispatch warning", 15_000);
      await page.click(".zui-hud button", "Approvals");
      await page.waitFor("!!document.querySelector('.zui-panel')", "approvals panel");
      await sleep(400);
      const { hud, panel } = await page.eval<{ hud: number; panel: number }>(
        "({ hud: document.querySelector('.zui-hud').getBoundingClientRect().bottom, panel: document.querySelector('.zui-panel').getBoundingClientRect().top })",
      );
      expect(panel).toBeGreaterThanOrEqual(hud);
    } finally {
      hermes.reviewDispatch = false;
      await page.press("Escape");
    }
  });

  it.fails("KNOWN BUG: canvas keeps the pointer cursor after entering a floor (World.mountScene resets hover without resetting the cursor)", async () => {
    const { page } = stack;
    await page.reducedMotion(true);
    await openApp(stack);
    await enterBuilding(page, "Zain Studio");
    await sleep(500);
    // Bottom-left corner of the canvas is empty sky on every floor.
    const cursor = await page.eval<string>(`(() => {
      const c = document.querySelector('.app-world canvas');
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: 4, clientY: innerHeight - 4, pointerType: 'mouse', pointerId: 31, bubbles: true }));
      return c.style.cursor;
    })()`);
    await page.reducedMotion(false);
    expect(cursor).not.toBe("pointer");
  });

  it("Hermes down: HUD flips to disconnected and the app keeps working", async () => {
    const { page, hermes } = stack;
    await openApp(stack);
    await page.waitFor(`!!document.querySelector('.zui-dot-item[title="Hermes: reachable"]')`, "Hermes reachable");
    const exceptionsBefore = page.console.filter((e) => e.kind === "exception").length;

    await hermes.stop();
    await page.waitFor(`!!document.querySelector('.zui-dot-item[title="Hermes: unreachable"]')`, "HUD shows Hermes unreachable", 20_000);
    expect(await hudStatus(page, "Telegram")).toBe("Telegram: unknown");

    await page.click(".zui-hud button", "New mandate");
    await page.type("#mandate-title", "Sent while Hermes is down");
    await page.click("[role=dialog] button", "Send mandate");
    const error = await page.waitFor<string>("document.querySelector('[role=dialog] [role=alert]')?.textContent", "mandate error note");
    expect(error).toBe("Hermes isn't reachable. Is it running on this machine?");
    expect(error).not.toMatch(/127\.0\.0\.1|TypeError|http/);
    await stack.shot("hermes-down");
    await page.press("Escape");

    expect(await page.eval("!!document.querySelector('.app-world canvas') && !!document.querySelector('.zui-hud')")).toBe(true);
    expect(page.console.filter((e) => e.kind === "exception").length).toBe(exceptionsBefore);
    await until(async () => (await fetch(`${stack.serverUrl}/api/health`)).ok, "server still serving");
  });
});
