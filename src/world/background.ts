import { PAGE_BACKGROUND, cssColor } from "./palette";
import type { WorldView } from "./types";

/** Css colour the world paints behind a view; lets surrounding UI blend with the canvas. */
export function worldBackground(_view: WorldView): string {
  return cssColor(PAGE_BACKGROUND);
}
