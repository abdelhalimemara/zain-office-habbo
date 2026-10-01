import { render, renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { HUD_BOTTOM_VAR, useHudBottom, usePublishHudBottom } from "../../src/ui/useHudBottom";

function Header({ bottom }: { bottom: number }) {
  const ref = useRef<HTMLElement>(null);
  usePublishHudBottom(ref);
  return <header ref={(el) => {
    if (el) el.getBoundingClientRect = () => ({ bottom } as DOMRect);
    (ref as { current: HTMLElement | null }).current = el;
  }} />;
}

describe("HUD bottom edge", () => {
  afterEach(() => document.documentElement.style.removeProperty(HUD_BOTTOM_VAR));

  it("publishes the HUD's bottom edge as a CSS variable", () => {
    render(<Header bottom={88} />);
    expect(document.documentElement.style.getPropertyValue(HUD_BOTTOM_VAR)).toBe("88px");
  });

  it("lets a subscriber that mounts after publishing read the current value", () => {
    document.documentElement.style.setProperty(HUD_BOTTOM_VAR, "88px");
    const { result } = renderHook(() => useHudBottom());
    expect(result.current).toBe(88);
  });

  it("follows later changes", () => {
    const { result } = renderHook(() => useHudBottom());
    act(() => {
      window.dispatchEvent(new CustomEvent("zui-hud-resize", { detail: 120 }));
    });
    expect(result.current).toBe(120);
  });
});
