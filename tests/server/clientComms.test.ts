import { HOLDING_MESSAGE } from "../../server/src/org/clientPersona";
import { profileDescription, soulFor } from "../../server/src/org/persona";
import { approvalsSection } from "../../server/src/telegram/ceoSoul";
import { ROSTER, findAgent } from "../../shared/roster";

const ahmad = findAgent("zain-hq-accounts")!;
const soul = soulFor(ahmad, ROSTER);

describe("Ahmad's client-communication charter", () => {
  it("names him and his channels", () => {
    expect(soul).toContain("You are Ahmad Al Zain, Account Management Lead at Zain Group.");
    expect(soul).toContain("on your own Gmail address and your own WhatsApp number");
    expect(soul).toMatch(/Anyone may message you/);
    expect(profileDescription(ahmad)).toContain("Ahmad Al Zain, Account Management Lead");
    expect(profileDescription(ahmad)).toContain("Handles client communication on email and whatsapp.");
  });

  it("separates routine replies from commitments that need HQ approval", () => {
    const routine = soul.slice(soul.indexOf("### Routine"), soul.indexOf("### Commitments"));
    for (const item of ["Status updates", "scheduling", "acknowledgements", "frequently asked questions", "already approved"]) {
      expect(routine).toContain(item);
    }
    const commitments = soul.slice(soul.indexOf("### Commitments"), soul.indexOf("### Approval workflow"));
    for (const item of ["Pricing, discounts and quotes", "Scope changes", "Deadlines and dates", "Contracts, legal and terms", "complaints and escalations", "refunds and credits", "unclear"]) {
      expect(commitments).toContain(item);
    }
    expect(soul).toContain("Never send a commitment without approval.");
  });

  it("spells out the approval workflow through a Client reply task", () => {
    expect(soul).toContain(HOLDING_MESSAGE);
    expect(soul).toContain('title "Client reply: <client> — <topic>", `assignee="zain-hq-accounts"` (yourself) and `tenant="zain-hq"`');
    expect(soul).toContain("`channel: email` or `channel: whatsapp`, the client, their message, your proposed reply and why it needs approval; for email also `threadId` and `messageId`");
    expect(soul).toContain("call `kanban_request_review` with your proposed reply, exactly as the client would read it, as the `summary`");
    expect(soul).toContain("On a review-requested wake, do nothing. On a completed wake, send the result there.");
    expect(soul).toContain("the completed task's result, read with `kanban_show`) exactly");
    expect(soul).toContain('leaves the comment "Sent via email" on the task. A task with that comment has been sent: never send it again.');
    expect(soul).toContain("### Your Gmail inbox loop");
    expect(soul).toContain("never reply to the mailbox's older backlog");
    expect(soul).toContain("Run Gmail commands only with the exact command prefix your inbox-loop instructions give");
    expect(soul).toContain("`gmail reply <messageId>`");
    expect(soul).toContain("`Zain/Handled`");
    expect(soul).toMatch(/If HQ sends it back.*revise the reply and request review again/);
    const steps = ["holding message", "kanban_create", "kanban_request_review", "Sending the approved text"].map((s) => soul.indexOf(s));
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it("covers tone, confidentiality, AI honesty and staying out of mandates", () => {
    expect(soul).toMatch(/Bilingual: reply in the client's language \(Arabic or English\)/);
    expect(soul).toContain("Never share another client's information");
    expect(soul).toContain("do not deny it: say you are Zain's AI account assistant working with the team");
    expect(soul).toContain("Never ask clients for passwords or secrets");
    expect(soul).toContain("Never create mandates and never assign work to other agents");
    expect(soul).toContain("`kanban_comment`");
    expect(soul).toContain("Request review from HQ only for client replies");
    expect(soul).not.toContain("Do not request review from HQ");
  });

  it("is only for agents with client channels", () => {
    const finance = soulFor(findAgent("zain-hq-finance")!, ROSTER);
    expect(finance).not.toContain("## Client communication");
    expect(finance).toContain("Do not request review from HQ");
  });
});

describe("CEO approvals section: client replies", () => {
  const text = approvalsSection(8787);
  it("relays client replies with the client, channel, message and proposed reply, and applies decisions", () => {
    expect(text).toContain("### Client replies");
    expect(text).toContain('"Client reply: <client> — <topic>"');
    expect(text).toContain("curl -sS http://127.0.0.1:8787/api/tasks/<id>");
    expect(text).toMatch(/who the client is, on which channel \(email or WhatsApp\), what they asked, and then quote Ahmad's proposed reply word for word/);
    expect(text).toContain('Ask whether to send it as is, send it with their edits, or send it back to Ahmad with notes.');
    expect(text).toContain(`-d '{"finalText":"<their exact text>","note":"via Telegram"}'`);
    expect(text).toContain(`/approvals/<id>/reject -H 'Content-Type: application/json' -d '{"reason":"<their notes>"}'`);
  });
});
