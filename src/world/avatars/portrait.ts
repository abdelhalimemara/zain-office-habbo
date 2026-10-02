import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";
import { avatarRenderer, drawMesh } from "./cache";
import { buildMesh, REST_RIG } from "./model";
import type { AvatarSpec } from "./types";

const BUST = new Set(["head", "neck", "torso", "upperR", "upperL"]);

/** Head-and-shoulders bust (facing SW) baked to a square texture `size` px wide. The caller owns the texture. */
export function portraitTexture(spec: AvatarSpec, size = 96, renderer: Renderer | null = avatarRenderer()): Texture {
  if (!renderer) throw new Error("portraitTexture needs a renderer (setAvatarRenderer)");
  const mesh = buildMesh(spec, REST_RIG, "SW", (p) => BUST.has(p.name));
  const w = mesh.maxX - mesh.minX;
  const h = mesh.maxY - mesh.minY;
  const unit = (size * 0.92) / Math.max(w, h);
  const g = new Graphics();
  drawMesh(g, mesh, unit);
  const cx = ((mesh.minX + mesh.maxX) / 2) * unit;
  const top = mesh.minY * unit - size * 0.04;
  const texture = renderer.generateTexture({ target: g, frame: new Rectangle(cx - size / 2, top, size, size), antialias: true });
  g.destroy();
  return texture;
}
