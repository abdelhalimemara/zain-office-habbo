import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { API } from "@shared/api";
import { CEO_PROFILE } from "@shared/roster";
import { spriteFor } from "../../src/world/characters";
import { AgentChip } from "../../src/ui/common";
import { Portrait } from "../../src/ui/Portrait";
import { mockFetch, renderUi, resetStore, rosterEntries } from "./helpers";

function sprite(container: HTMLElement): string | null {
  return container.querySelector(".zui-portrait")?.getAttribute("data-sprite") ?? null;
}

describe("Portrait", () => {
  it("shows each board member's own character", () => {
    for (const name of ["hormozi", "alwaleed", "bezos", "buffett", "jobs"]) {
      const { container, unmount } = render(<Portrait agent={{ profile: `zain-board-${name}`, rank: "board" }} name={name} />);
      expect(sprite(container)).toBe(`board/${name}`);
      expect(container.querySelector("img")!.getAttribute("src")).toContain(`${name}.webp`);
      unmount();
    }
  });

  it("dresses Susu in the dark skirt suit and gives workers their floor character", () => {
    const ceo = render(<Portrait agent={{ profile: CEO_PROFILE, rank: "ceo" }} name="Susu" />);
    expect(sprite(ceo.container)).toBe("people/female-2");
    ceo.unmount();
    for (const profile of ["zain-studio-art", "zain-tech-vp", "zain-growth-seo"]) {
      const { container, unmount } = render(<Portrait agent={{ profile, rank: "specialist" }} name={profile} />);
      expect(sprite(container)).toBe(spriteFor(profile, "specialist"));
      unmount();
    }
  });

  it("falls back to the initials circle without a roster agent or when the image fails", () => {
    const { container, rerender } = render(<Portrait agent={null} name="HQ Desk" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".zui-avatar")).toHaveTextContent("HD");

    rerender(<Portrait agent={{ profile: "zain-studio-art", rank: "specialist" }} name="Art Director" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".zui-avatar")).toHaveTextContent("AD");
  });

  it("is decorative next to a visible name and named when it stands alone", () => {
    const { container, rerender } = render(<Portrait agent={{ profile: "zain-tech-vp", rank: "vp" }} name="VP Tech" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    rerender(<Portrait agent={{ profile: "zain-tech-vp", rank: "vp" }} name="VP Tech" labelled={false} />);
    expect(screen.getByRole("img", { name: "VP Tech" })).toBeInTheDocument();
  });

  it("renders sm, md and lg sizes and desaturates vacant seats", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { container, unmount } = render(<Portrait agent={{ profile: "zain-tech-vp", rank: "vp" }} name="VP Tech" size={size} />);
      expect(container.querySelector(".zui-portrait")).toHaveClass(`zui-avatar--${size}`);
      expect(container.querySelector(".zui-portrait")).not.toHaveClass("zui-portrait--vacant");
      unmount();
    }
    const vacant = render(<Portrait agent={{ profile: "zain-tech-vp", rank: "vp" }} name="VP Tech" vacant />);
    expect(vacant.container.querySelector(".zui-portrait")).toHaveClass("zui-portrait--vacant");
    vacant.unmount();
    const initialsVacant = render(<Portrait name="Nobody" vacant />);
    expect(initialsVacant.container.querySelector(".zui-avatar")).toHaveClass("zui-portrait--vacant");
  });
});

describe("AgentChip portraits", () => {
  beforeEach(resetStore);

  it("shows the assignee's character beside the name and greys it out once the roster says vacant", async () => {
    const agents = rosterEntries.map((a) => (a.profile === "zain-studio-ux" ? { ...a, hired: false } : a));
    mockFetch({ [API.roster]: { agents } });
    const { container } = renderUi(
      <>
        <AgentChip profile="zain-studio-vp" agents={agents} />
        <AgentChip profile="zain-studio-ux" agents={agents} size="md" />
        <AgentChip profile="zain-hq-ui" agents={agents} />
      </>,
    );
    expect(screen.getByText("Lina Haddad")).toBeInTheDocument();
    const portraits = container.querySelectorAll(".zui-portrait");
    expect(portraits).toHaveLength(2);
    expect(portraits[0]).toHaveAttribute("data-sprite", spriteFor("zain-studio-vp", "vp"));
    expect(portraits[1]).toHaveClass("zui-avatar--md");
    await waitFor(() => expect(portraits[1]).toHaveClass("zui-portrait--vacant"));
    expect(portraits[0]).not.toHaveClass("zui-portrait--vacant");
    expect(container.querySelectorAll("img[alt='']")).toHaveLength(2);
    expect(container.querySelector(".zui-avatar:not(.zui-portrait)")).toHaveTextContent("ZH");
  });
});
