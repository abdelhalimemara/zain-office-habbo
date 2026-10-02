import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API, type TaskDetailResponse } from "@shared/api";
import { AgentCard } from "../../src/ui/AgentCard";
import { ApprovalsInbox } from "../../src/ui/ApprovalsInbox";
import { parseClientReply, parseClientReplyBody } from "../../src/ui/clientReply";
import { Hud } from "../../src/ui/Hud";
import { groupByLane } from "../../src/ui/lanes";
import { TaskCard } from "../../src/ui/TaskCard";
import { TaskDrawer } from "../../src/ui/TaskDrawer";
import { board, mockFetch, renderUi, resetStore, rosterEntries, task } from "./helpers";

const AHMAD = "zain-hq-accounts";
const DRAFT = "Hi Sara, we can deliver the landing page by Thursday 9 Oct for SAR 12,000.";
const EVIL = '<img src=x onerror="window.__pwnedClient=true"><b>now</b>';

const EMAIL_BODY = [
  "**Channel:** email",
  "**Client:** Sara (Nakheel)",
  "**Client's message:**",
  `> Can you do the landing page for 12k by Thursday? ${EVIL}`,
  "**Proposed reply:**",
  DRAFT,
  "**Why approval:** Price and deadline are commitments.",
].join("\n");

const WHATSAPP_BODY = [
  "## Channel",
  "WhatsApp",
  "## Their message",
  "Can we add an Arabic version for free?",
  "## Draft reply",
  "Happy to add Arabic for SAR 3,000.",
  "## Why it needs approval",
  "Scope change and pricing.",
].join("\n");

const emailReply = task({
  id: "cr1",
  title: "Client reply: Sara (Nakheel) — landing page price",
  status: "review",
  assignee: AHMAD,
  tenant: "zain-hq",
  body: EMAIL_BODY,
  latest_summary: DRAFT,
});
const whatsappReply = task({
  id: "cr2",
  title: "Client reply: Omar — Arabic version",
  status: "review",
  assignee: AHMAD,
  tenant: "zain-hq",
  body: WHATSAPP_BODY,
  latest_summary: "Happy to add Arabic for SAR 3,000.",
});
const mandate = task({ id: "m1", title: "Studio mandate", status: "review", assignee: "zain-studio-vp" });
const specialist = task({ id: "s1", title: "Specialist review", status: "review", assignee: "zain-studio-copy" });

function inbox(extra: Record<string, unknown> = {}, tasks = [emailReply, whatsappReply, mandate, specialist]) {
  const fetch = mockFetch({ [API.board]: board(tasks), [API.roster]: { agents: rosterEntries }, ...extra });
  renderUi(<ApprovalsInbox />);
  return fetch;
}

async function emailItem() {
  return (await screen.findByText("Client reply: Sara (Nakheel) — landing page price")).closest("article") as HTMLElement;
}

describe("parseClientReply", () => {
  it("reads the title, labelled bold lines and markdown headings", () => {
    expect(parseClientReply(emailReply)).toEqual({
      client: "Sara (Nakheel)",
      topic: "landing page price",
      channel: "email",
      message: `Can you do the landing page for 12k by Thursday? ${EVIL}`,
      draft: DRAFT,
      reason: "Price and deadline are commitments.",
    });
    expect(parseClientReply(whatsappReply)).toMatchObject({
      client: "Omar",
      channel: "whatsapp",
      message: "Can we add an Arabic version for free?",
      reason: "Scope change and pricing.",
    });
  });

  it("returns null for whatever is missing on malformed bodies", () => {
    for (const body of [null, "", "just some text\nwith no labels", "Channel:\nWhy approval:", "Price: 12k\nSara: hello"]) {
      const parsed = parseClientReply({ title: "Client reply:", body, latest_summary: null, result: null });
      expect(parsed).toEqual({ client: null, topic: null, channel: null, message: null, draft: null, reason: null });
    }
    expect(parseClientReply({ title: "Client reply: Sara", body: "Channel: carrier pigeon", latest_summary: null, result: "Final text" })).toMatchObject({
      client: "Sara",
      topic: null,
      channel: null,
      draft: "Final text",
    });
    expect(parseClientReplyBody("Proposed reply: from body\nWhy: because")).toEqual({ draft: "from body", reason: "because" });
  });
});

describe("Client replies in the approvals inbox", () => {
  beforeEach(resetStore);

  it("lists client replies above mandates and counts them as HQ decisions", async () => {
    inbox();
    expect(await screen.findByRole("heading", { name: "Approvals (3)" })).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Client replies (2)" });
    const studio = screen.getByRole("heading", { name: "Zain Studio" });
    expect(section.compareDocumentPosition(studio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).queryByText("Specialist review")).not.toBeInTheDocument();
  });

  it("hides the section when there are none", async () => {
    inbox({}, [mandate]);
    expect(await screen.findByRole("heading", { name: "Approvals (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Client replies/ })).not.toBeInTheDocument();
  });

  it("shows client, channel, Ahmad, the quoted message, the reason and the draft, all as plain text", async () => {
    inbox();
    const item = await emailItem();
    expect(within(item).getByText("Sara (Nakheel)")).toBeInTheDocument();
    expect(within(item).getByText("Email")).toBeInTheDocument();
    expect(within(item).getByText("Ahmad Al Zain")).toBeInTheDocument();
    expect(item.querySelector("blockquote")).toHaveTextContent(`Can you do the landing page for 12k by Thursday? ${EVIL}`);
    expect(within(item).getByText("Price and deadline are commitments.")).toBeInTheDocument();
    expect(within(item).getByLabelText(/Reply to send/)).toHaveValue(DRAFT);
    expect(item.querySelector("b, img:not(.zui-portrait__img), img[src=x]")).toBeNull();
    expect((window as unknown as { __pwnedClient?: boolean }).__pwnedClient).toBeUndefined();
    const whatsapp = (await screen.findByText("Client reply: Omar — Arabic version")).closest("article")!;
    expect(within(whatsapp).getByText("WhatsApp")).toBeInTheDocument();
  });

  it("shows — for fields the body doesn't have", async () => {
    inbox({}, [task({ id: "cr3", title: "Client reply: Lina", status: "review", assignee: AHMAD, tenant: "zain-hq", body: "hello?" })]);
    const item = (await screen.findByText("Client reply: Lina")).closest("article")!;
    expect(item.querySelector("blockquote")).toHaveTextContent("—");
    expect(within(item).getByText("—", { selector: ".zui-channel" })).toBeInTheDocument();
    expect(within(item).getByText("—", { selector: ".zui-client-reply__reason" })).toBeInTheDocument();
    expect(within(item).getByLabelText(/Reply to send/)).toHaveValue("");
  });

  it("approves the draft as written after an inline confirm", async () => {
    const fetch = inbox({ [`POST ${API.approve("cr1")}`]: { task: {} } });
    const item = await emailItem();
    await userEvent.click(within(item).getByRole("button", { name: "Approve & send" }));
    const confirm = within(item).getByRole("group", { name: "Confirm send" });
    expect(confirm).toHaveTextContent("Send this to Sara (Nakheel) via Email?");
    await userEvent.click(within(confirm).getByRole("button", { name: "Confirm" }));
    expect(await within(item).findByText("Approved — Ahmad will send it to Sara (Nakheel).")).toBeInTheDocument();
    expect(fetch.calls("POST", API.approve("cr1"))).toEqual([{ body: {} }]);
  });

  it("sends HQ's edit as finalText", async () => {
    const fetch = inbox({ [`POST ${API.approve("cr1")}`]: { task: {} } });
    const item = await emailItem();
    const reply = within(item).getByLabelText(/Reply to send/);
    await userEvent.clear(reply);
    await userEvent.type(reply, "Hi Sara, SAR 13,500 by Thursday.");
    expect(within(item).getByText("(edited)")).toBeInTheDocument();
    await userEvent.click(within(item).getByRole("button", { name: "Approve & send" }));
    await userEvent.click(within(item).getByRole("button", { name: "Confirm" }));
    await within(item).findByText(/Approved/);
    expect(fetch.calls("POST", API.approve("cr1"))).toEqual([{ body: { finalText: "Hi Sara, SAR 13,500 by Thursday." } }]);
  });

  it("refuses to send an empty reply", async () => {
    const fetch = inbox();
    const item = await emailItem();
    await userEvent.clear(within(item).getByLabelText(/Reply to send/));
    await userEvent.click(within(item).getByRole("button", { name: "Approve & send" }));
    expect(within(item).getByText("The reply can't be empty.")).toBeInTheDocument();
    expect(within(item).queryByRole("group", { name: "Confirm send" })).not.toBeInTheDocument();
    expect(fetch.calls("POST", API.approve("cr1"))).toHaveLength(0);
  });

  it("requires notes to send back to Ahmad, then rejects with them", async () => {
    const fetch = inbox({ [`POST ${API.reject("cr1")}`]: { task: {} } });
    const item = await emailItem();
    await userEvent.click(within(item).getByRole("button", { name: "Send back to Ahmad" }));
    expect(within(item).getByText("Write notes for Ahmad to send this back.")).toBeInTheDocument();
    expect(within(item).getByLabelText(/Notes for Ahmad/)).toHaveAttribute("aria-invalid", "true");
    expect(fetch.calls("POST", API.reject("cr1"))).toHaveLength(0);
    await userEvent.type(within(item).getByLabelText(/Notes for Ahmad/), "Quote 13,500, not 12,000");
    await userEvent.click(within(item).getByRole("button", { name: "Send back to Ahmad" }));
    expect(await within(item).findByText("Sent back to Ahmad.")).toBeInTheDocument();
    expect(fetch.calls("POST", API.reject("cr1"))).toEqual([{ body: { reason: "Quote 13,500, not 12,000" } }]);
  });

  it("shows the server's error", async () => {
    inbox({ [`POST ${API.approve("cr1")}`]: () => new Response(JSON.stringify({ error: "client reply has no draft" }), { status: 409 }) });
    const item = await emailItem();
    await userEvent.click(within(item).getByRole("button", { name: "Approve & send" }));
    await userEvent.click(within(item).getByRole("button", { name: "Confirm" }));
    expect(await within(item).findByRole("alert")).toHaveTextContent("client reply has no draft");
  });
});

describe("Client replies elsewhere", () => {
  beforeEach(resetStore);

  it("counts mandates and client replies in the HUD badge", async () => {
    mockFetch({
      [API.board]: board([emailReply, whatsappReply, mandate, specialist]),
      [API.roster]: { agents: rosterEntries },
      [API.health]: { ok: true, hermes: "reachable", telegram: "connected", board: "zain-group" },
    });
    renderUi(<Hud />);
    expect(await screen.findByRole("button", { name: "Approvals, 3 pending" })).toBeInTheDocument();
  });

  it("puts a client reply awaiting HQ in Awaiting HQ, not Blocked, with a channel badge on the card", () => {
    const groups = groupByLane([emailReply, specialist, mandate], rosterEntries);
    expect(groups.awaiting.map((t) => t.id)).toEqual(["cr1", "m1"]);
    expect(groups.blocked.map((t) => t.id)).toEqual(["s1"]);
    const { container } = renderUi(<TaskCard task={emailReply} agents={rosterEntries} now={emailReply.created_at} onOpen={() => undefined} />);
    expect(within(container).getByText("Client reply", { selector: ".zui-badge--client" })).toBeInTheDocument();
    expect(container.querySelector(".zui-badge--client svg")).toHaveClass("zui-channel-icon--email");
    expect(within(container).getByText("Ahmad Al Zain")).toBeInTheDocument();
  });

  it("gives the drawer the client-reply controls instead of the mandate actions", async () => {
    const detail: TaskDetailResponse = { task: whatsappReply, comments: [], parents: [], children: [], subtasks: [], history: [] };
    const fetch = mockFetch({ [API.task("cr2")]: detail, [API.roster]: { agents: rosterEntries }, [`POST ${API.approve("cr2")}`]: { task: {} } });
    renderUi(<TaskDrawer id="cr2" />);
    expect(await screen.findByRole("button", { name: "Approve & send" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve & close" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send back to VP" })).not.toBeInTheDocument();
    expect(screen.getByText("Omar")).toBeInTheDocument();
    expect(screen.getByText("Awaiting HQ")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve & send" }));
    expect(screen.getByRole("group", { name: "Confirm send" })).toHaveTextContent("Send this to Omar via WhatsApp?");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText(/Approved/);
    expect(fetch.calls("POST", API.approve("cr2"))).toEqual([{ body: {} }]);
  });

  it("names Ahmad on his agent card with his client channels", async () => {
    mockFetch({ [API.board]: board([]), [API.roster]: { agents: rosterEntries } });
    renderUi(<AgentCard profile={AHMAD} />);
    expect(await screen.findByRole("heading", { name: "Ahmad Al Zain · Account Management Lead" })).toBeInTheDocument();
    expect(screen.getByText("Ahmad Al Zain", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Client channels")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Handles all client communication. Commitments need HQ approval.")).toBeInTheDocument();
  });

  it("keeps the seat title for agents without a name", async () => {
    mockFetch({ [API.board]: board([]), [API.roster]: { agents: rosterEntries } });
    renderUi(<AgentCard profile="zain-hq-finance" />);
    expect(await screen.findByRole("heading", { name: "Finance Lead" })).toBeInTheDocument();
    expect(screen.queryByText("Client channels")).not.toBeInTheDocument();
  });
});
