import type { DivisionId } from "../../../shared/divisions";
import type { Pt } from "../iso";
import { hotspotFor } from "../layouts/cityImage";

/**
 * Buildings that stand in front of a route somewhere: a copy of the city image clipped to these silhouettes
 * is drawn over the cars. Growth hides the inner-1 spawn, Studio the inner-1 road behind its roof, Tech the
 * crossing behind it, Labs the inner-2 spawn.
 */
const IN_FRONT: readonly DivisionId[] = ["growth", "studio", "tech", "labs"];

export const OCCLUDERS: readonly (readonly Pt[])[] = IN_FRONT.map((d) => hotspotFor(d).polygon);
