// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { WORLD_UNAVAILABLE_MESSAGE, WorldCanvas } from "../../src/world/WorldCanvas";
import { cursorFor } from "../../src/world/scenes/Scene";

let createImpl: (...args: unknown[]) => Promise<unknown> = () => new Promise(() => {});

vi.mock("../../src/world/World", () => ({
  World: { create: (...args: unknown[]) => createImpl(...args) },
}));

const baseProps = {
  view: { kind: "city" } as const,
  agents: [],
  stats: null,
  selectedAgent: null,
  onSelectBuilding: () => {},
  onSelectAgent: () => {},
};

describe("WorldCanvas", () => {
  beforeEach(() => {
    createImpl = () => new Promise(() => {});
  });

  it("shows a readable fallback and reports the error when the renderer cannot start", async () => {
    const error = new Error("WebGL unsupported");
    createImpl = () => Promise.reject(error);
    const onError = vi.fn();
    render(<WorldCanvas {...baseProps} onError={onError} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(WORLD_UNAVAILABLE_MESSAGE);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("pushes props into the world once it is ready and destroys it on unmount", async () => {
    const world = {
      setView: vi.fn(),
      setAgents: vi.fn(),
      setDivisionStats: vi.fn(),
      setSelectedAgent: vi.fn(),
      setInsets: vi.fn(),
      destroy: vi.fn(),
    };
    createImpl = () => Promise.resolve(world);
    const { unmount } = render(<WorldCanvas {...baseProps} insets={{ top: 64 }} />);
    await waitFor(() => expect(world.setView).toHaveBeenCalledWith({ kind: "city" }));
    expect(world.setInsets).toHaveBeenCalledWith({ top: 64 });
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    expect(world.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a world that finishes starting after unmount", async () => {
    let resolve: (w: unknown) => void = () => {};
    createImpl = () => new Promise((r) => (resolve = r));
    const world = { destroy: vi.fn() };
    const { unmount } = render(<WorldCanvas {...baseProps} />);
    unmount();
    resolve(world);
    await waitFor(() => expect(world.destroy).toHaveBeenCalledTimes(1));
  });
});

describe("cursor", () => {
  it("returns to the idle grab cursor when nothing is hovered", () => {
    expect(cursorFor(null)).toBe("grab");
    expect(cursorFor({ kind: "building", division: "studio" })).toBe("pointer");
    expect(cursorFor({ kind: "agent", profile: "x" }, true)).toBe("grabbing");
  });
});
