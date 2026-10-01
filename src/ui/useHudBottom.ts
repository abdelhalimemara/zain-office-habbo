import { useEffect, useState, type RefObject } from "react";

export const HUD_BOTTOM_VAR = "--zui-hud-bottom";
const FALLBACK = 56;

/** Publishes the HUD's bottom edge as a CSS variable so panels never cover it as it grows (e.g. warnings). */
export function usePublishHudBottom(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      const bottom = Math.round(el.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty(HUD_BOTTOM_VAR, `${bottom}px`);
      window.dispatchEvent(new CustomEvent("zui-hud-resize", { detail: bottom }));
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [ref]);
}

export function useHudBottom(): number {
  const [bottom, setBottom] = useState(FALLBACK);
  useEffect(() => {
    const onResize = (e: Event) => setBottom((e as CustomEvent<number>).detail);
    window.addEventListener("zui-hud-resize", onResize);
    const published = parseInt(document.documentElement.style.getPropertyValue(HUD_BOTTOM_VAR), 10);
    if (Number.isFinite(published)) setBottom(published);
    return () => window.removeEventListener("zui-hud-resize", onResize);
  }, []);
  return bottom;
}
