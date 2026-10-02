import { Graphics, GraphicsContext, Rectangle, type Renderer, type Texture } from "pixi.js";
import { buildMesh, legLength, type NamedPart } from "./model";
import { bodyOf } from "./body";
import type { Mesh } from "./mesh";
import { rigFor } from "./rig";
import { REST_RIG } from "./model";
import { texturedFigure } from "./textured";
import type { AvatarSpec, Emote, Facing, Pose, Rig } from "./types";

/** One cached pose frame: either a baked texture or (without a renderer) a shared GraphicsContext. */
export interface FrameArt {
  texture: Texture | null;
  context: GraphicsContext | null;
  /** Top-left of the art relative to the feet, in px. */
  x: number;
  y: number;
  /** How far the body is lowered in this frame (sitting, stride), in voxels. */
  drop: number;
  /** Draw mirrored (SE and NE reuse the SW and NW geometry, relit for their side). */
  mirror: boolean;
}

/** Screen px per model unit; textured figures may stretch vertically to match their reference. */
export interface AvatarScale {
  sx: number;
  sy: number;
  textured: boolean;
}

let renderer: Renderer | null = null;
const frames = new Map<string, FrameArt>();
const metrics = new Map<string, number>();

/** Bake avatar frames into textures with this renderer (otherwise frames draw as shared vector contexts). */
export function setAvatarRenderer(r: Renderer | null): void {
  renderer = r;
}

export function avatarRenderer(): Renderer | null {
  return renderer;
}

/** Projected standing height of a spec in voxel units (SW, rest rig). */
export function standHeightUnits(spec: AvatarSpec): number {
  let h = metrics.get(spec.key);
  if (h === undefined) {
    const m = buildMesh(spec, REST_RIG, "SW");
    h = m.maxY - m.minY;
    metrics.set(spec.key, h);
  }
  return h;
}

export function rigForFrame(spec: AvatarSpec, pose: Pose, poseFrame: number, emote: Emote, emoteFrame: number) {
  const d = bodyOf(spec);
  return rigFor(pose, poseFrame, emote, emoteFrame, legLength(d), d.thighLen);
}

/** Screen px per voxel step that makes the standing figure exactly `height` px tall. */
export function unitFor(spec: AvatarSpec, height: number): number {
  return height / standHeightUnits(spec);
}

export function meshForFrame(spec: AvatarSpec, facing: Facing, pose: Pose, poseFrame: number, emote: Emote, emoteFrame: number, filter?: (p: NamedPart) => boolean): Mesh {
  return buildMesh(spec, rigForFrame(spec, pose, poseFrame, emote, emoteFrame), facing, filter);
}

export function drawMesh(g: Graphics | GraphicsContext, mesh: Mesh, unit: number): void {
  const p = mesh.pts;
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 8;
    g.poly([p[o]! * unit, p[o + 1]! * unit, p[o + 2]! * unit, p[o + 3]! * unit, p[o + 4]! * unit, p[o + 5]! * unit, p[o + 6]! * unit, p[o + 7]! * unit]).fill(mesh.colors[i]!);
  }
}

export function bake(mesh: Mesh, unit: number, resolution: number): FrameArt {
  const x = Math.floor(mesh.minX * unit) - 1;
  const y = Math.floor(mesh.minY * unit) - 1;
  const w = Math.ceil(mesh.maxX * unit) + 1 - x;
  const h = Math.ceil(mesh.maxY * unit) + 1 - y;
  if (!renderer) {
    const context = new GraphicsContext();
    drawMesh(context, mesh, unit);
    return { texture: null, context, x: 0, y: 0, drop: 0, mirror: false };
  }
  const g = new Graphics();
  drawMesh(g, mesh, unit);
  const texture = renderer.generateTexture({ target: g, frame: new Rectangle(x, y, w, h), resolution, antialias: false });
  g.destroy();
  return { texture, context: null, x, y, drop: 0, mirror: false };
}

const MIRROR: Readonly<Record<Facing, Extract<Facing, "SW" | "NW">>> = { SW: "SW", SE: "SW", NW: "NW", NE: "NW" };

function bakeTextured(spec: AvatarSpec, rig: Rig, facing: Facing, scale: AvatarScale, resolution: number): FrameArt | null {
  if (!renderer) return null;
  const fig = texturedFigure(spec, rig, MIRROR[facing], scale.sx, scale.sy, facing !== MIRROR[facing]);
  if (!fig) return null;
  const b = fig.getLocalBounds();
  const x = Math.floor(b.minX) - 1;
  const y = Math.floor(b.minY) - 1;
  const texture = renderer.generateTexture({ target: fig, frame: new Rectangle(x, y, Math.ceil(b.maxX) + 1 - x, Math.ceil(b.maxY) + 1 - y), resolution, antialias: true });
  fig.destroy({ children: true });
  return { texture, context: null, x, y, drop: rig.drop, mirror: facing !== MIRROR[facing] };
}

export function frameArt(
  spec: AvatarSpec,
  facing: Facing,
  pose: Pose,
  poseFrame: number,
  emote: Emote,
  emoteFrame: number,
  scale: AvatarScale,
  resolution: number,
): FrameArt {
  const look = scale.textured ? facing + "x" : facing;
  const key = `${spec.key}|${scale.sx.toFixed(3)}x${scale.sy.toFixed(3)}|${resolution}|${look}|${pose}${poseFrame}|${emote}${emoteFrame}|${renderer ? "t" : "g"}`;
  let art = frames.get(key);
  if (!art) {
    const rig = rigForFrame(spec, pose, poseFrame, emote, emoteFrame);
    art = (scale.textured && bakeTextured(spec, rig, facing, scale, resolution)) || { ...bake(buildMesh(spec, rig, facing), scale.sx, resolution), drop: rig.drop };
    frames.set(key, art);
  }
  return art;
}

export function avatarCacheSize(): number {
  return frames.size;
}

/** Free every baked frame (avatars using them must be rebuilt). */
export function clearAvatarCache(): void {
  for (const a of frames.values()) {
    a.texture?.destroy(true);
    a.context?.destroy();
  }
  frames.clear();
  metrics.clear();
}
