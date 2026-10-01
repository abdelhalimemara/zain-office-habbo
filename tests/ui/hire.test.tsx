import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { API, type HireResponse } from "@shared/api";
import { HireDialog } from "../../src/ui/HireDialog";
import { PROFILE_PATTERN } from "@shared/hireRules";
import { deriveProfile } from "../../src/ui/hireForm";
import { mockFetch, renderUi, resetStore, rosterEntries } from "./helpers";

const catalog = {
  departments: [
    { id: "marketing", skills: ["brand-voice", "visual-content", "video-content"] },
    { id: "technology", skills: Array.from({ length: 16 }, (_, i) => `skill-${i}`) },
  ],
};

const hireResult: HireResponse = {
  ok: false,
  profile: "zain-studio-motion-designer",
  steps: [
    { step: "create-profile", target: "zain-studio-motion-designer", ok: true },
    { step: "install-skill", target: "marketing:brand-voice", ok: false, error: "skill not found" },
  ],
};

function setup(props: Parameters<typeof HireDialog>[0] = { division: "studio" }) {
  const fetch = mockFetch({
    [API.roster]: { agents: rosterEntries },
    [API.headcountCatalog]: catalog,
    [`POST ${API.hire}`]: hireResult,
  });
  renderUi(<HireDialog {...props} />);
  return fetch;
}

describe("hire form helpers", () => {
  it("derives a valid slug", () => {
    expect(deriveProfile("studio", "Motion Designer!")).toBe("zain-studio-motion-designer");
    expect(deriveProfile("tech", "Ünïcode  & Stuff")).toBe("zain-tech-unicode-stuff");
    const long = deriveProfile("growth", "a very long title ".repeat(10));
    expect(long.length).toBeLessThanOrEqual(45);
    expect(long).toMatch(PROFILE_PATTERN);
  });
});

describe("HireDialog", () => {
  beforeEach(resetStore);

  it("derives the profile from the title until edited and validates it", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Title"), "Motion Designer");
    const profile = screen.getByLabelText("Profile slug");
    expect(profile).toHaveValue("zain-studio-motion-designer");
    await userEvent.clear(profile);
    await userEvent.type(profile, "Bad Slug");
    await userEvent.click(screen.getByRole("button", { name: "Hire" }));
    expect(screen.getByText(/Use zain- followed by/)).toBeInTheDocument();
    expect(screen.getByText("Pick at least one skill.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Title"), " Lead");
    expect(profile).toHaveValue("Bad Slug");
  });

  it("defaults reports-to to the division manager", async () => {
    setup({ division: "growth" });
    expect(await screen.findByLabelText("Reports to")).toHaveValue("zain-growth-vp");
    await userEvent.selectOptions(screen.getByLabelText("Division"), "tech");
    expect(screen.getByLabelText("Reports to")).toHaveValue("zain-tech-vp");
  });

  it("caps skill selection at 15 and supports search", async () => {
    setup();
    const tech = await screen.findByRole("group", { name: "technology" });
    const boxes = within(tech).getAllByRole("checkbox");
    for (const box of boxes.slice(0, 15)) await userEvent.click(box);
    expect(screen.getByText("(15/15)")).toBeInTheDocument();
    expect(boxes[15]).toBeDisabled();
    expect(within(screen.getByRole("group", { name: "marketing" })).getByLabelText("brand-voice")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove technology:skill-0" }));
    expect(boxes[15]).toBeEnabled();

    await userEvent.type(screen.getByLabelText("Search headcount catalog"), "video");
    expect(screen.queryByRole("group", { name: "technology" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("video-content")).toBeInTheDocument();
  });

  it("submits the hire and renders each step", async () => {
    const fetch = setup();
    await userEvent.type(screen.getByLabelText("Title"), "Motion Designer");
    await userEvent.click(await screen.findByLabelText("brand-voice"));
    await userEvent.click(screen.getByRole("button", { name: "Hire" }));

    const steps = await screen.findByRole("list", { name: "Hire steps" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(2);
    expect(within(steps).getByText(/skill not found/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hire incomplete" })).toBeInTheDocument();
    expect(fetch.calls("POST", API.hire)).toEqual([
      {
        body: {
          profile: "zain-studio-motion-designer",
          title: "Motion Designer",
          division: "studio",
          rank: "specialist",
          reportsTo: "zain-studio-vp",
          skills: ["marketing:brand-voice"],
        },
      },
    ]);
  });

  it("prefills from a vacant roster entry", async () => {
    setup({
      division: "studio",
      prefill: { profile: "zain-studio-ux", title: "UX / Web Designer", rank: "specialist", reportsTo: "zain-studio-vp", skills: ["product:interface-craft"] },
    });
    expect(screen.getByLabelText("Title")).toHaveValue("UX / Web Designer");
    expect(screen.getByLabelText("Profile slug")).toHaveValue("zain-studio-ux");
    expect(screen.getByRole("button", { name: "Remove product:interface-craft" })).toBeInTheDocument();
  });
});
