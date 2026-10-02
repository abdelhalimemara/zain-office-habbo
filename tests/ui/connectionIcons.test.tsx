import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionGlyph } from "../../src/ui/ConnectionsCluster";
import { connectionIcon } from "../../src/ui/connectionIcons";

const brandOf = (id: string, name: string) => {
  const { icon } = connectionIcon({ id, name });
  return icon.type === "brand" ? icon.brand : icon.type === "mail" ? "mail" : `monogram:${icon.letter}`;
};

describe("connectionIcon", () => {
  it.each([
    ["channel:telegram", "Telegram", "Telegram"],
    ["channel:whatsapp", "WhatsApp · Ahmad", "WhatsApp"],
    ["channel:zain-hq-accounts:whatsapp_cloud", "WhatsApp Cloud", "WhatsApp"],
    ["channel:gmail-ahmad", "Gmail · Ahmad", "Gmail"],
    ["channel:email", "Email", "mail"],
    ["channel:discord", "Discord", "Discord"],
    ["channel:signal", "Signal", "Signal"],
    ["channel:google_chat", "Google Chat", "Google Chat"],
    ["cli:ntn", "Notion CLI", "Notion"],
    ["mcp:notion", "notion", "Notion"],
    ["cli:gh", "GitHub CLI", "GitHub"],
    ["cli:google-workspace", "Google Workspace (CEO)", "Google"],
    ["mcp:webflow", "webflow", "Webflow"],
    ["channel:gateway", "Hermes gateway", "monogram:H"],
    ["cli:hermes", "Hermes CLI", "monogram:H"],
    ["mcp:adspirer", "adspirer", "monogram:A"],
    ["mcp:higgsfield", "higgsfield", "monogram:H"],
    ["channel:slack", "Slack", "monogram:S"],
    ["mcp:canva", "Canva", "monogram:C"],
    ["mcp:9tools", "9tools", "monogram:9"],
  ])("%s (%s) → %s", (id, name, expected) => {
    expect(brandOf(id, name)).toBe(expected);
  });

  it("marks Hermes tiles apart from unknown monograms", () => {
    expect(connectionIcon({ id: "cli:hermes", name: "Hermes CLI" }).icon).toEqual({ type: "monogram", letter: "H", hermes: true });
    expect(connectionIcon({ id: "mcp:higgsfield", name: "higgsfield" }).icon).toEqual({ type: "monogram", letter: "H" });
  });

  it("tells Telegram approvals apart from Telegram with a badge", () => {
    expect(connectionIcon({ id: "channel:telegram", name: "Telegram" }).badge).toBeUndefined();
    const approvals = connectionIcon({ id: "channel:telegram-approvals", name: "Telegram approvals" });
    expect(approvals.icon).toMatchObject({ type: "brand", brand: "Telegram" });
    expect(approvals.badge).toBe("approvals");
  });
});

describe("ConnectionGlyph", () => {
  it("draws the brand logo in its colour with a shaped status dot and no text", () => {
    const { container } = render(<ConnectionGlyph c={{ id: "channel:telegram-approvals", name: "Telegram approvals", status: "warn" }} />);
    const glyph = container.querySelector(".zui-conn-glyph")!;
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph.querySelector(".zui-conn-glyph__logo")).toHaveAttribute("fill", "#26A5E4");
    expect(glyph.querySelector(".zui-conn-glyph__badge")).not.toBeNull();
    expect(glyph.querySelector(".zui-conn-dot")).toHaveClass("zui-conn-dot--warn");
    expect(glyph.textContent).toBe("");
  });

  it("falls back to a lettered tile", () => {
    const { container } = render(<ConnectionGlyph c={{ id: "mcp:adspirer", name: "adspirer", status: "error" }} />);
    expect(container.querySelector(".zui-conn-glyph__mono")).toHaveTextContent("A");
    expect(container.querySelector("svg")).toBeNull();
  });
});
