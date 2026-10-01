import { CITY_BACKGROUND } from "./layouts/cityImage";
import { PAL, cssColor } from "./palette";
import type { WorldView } from "./types";

/** Css colour the world paints behind a view; lets surrounding UI blend with the canvas. */
export function worldBackground(view: WorldView): string {
  return cssColor(view.kind === "city" ? CITY_BACKGROUND : PAL.sky);
}
