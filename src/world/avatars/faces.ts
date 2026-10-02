import { Z_SCALE } from "./mesh";
import { buildParts, facingMatrix, REST_RIG, type NamedPart, type PartName } from "./model";
import { mul, volumeOf, type Mat } from "./raster";
import type { AvatarSpec, Facing, Rig } from "./types";

export type FaceName = "front" | "side" | "top" | "back" | "rside" | "bottom";
export type SourceFace = "front" | "side" | "top";

export const SOURCE_FACES: readonly SourceFace[] = ["front", "side", "top"];
export const ALL_FACES: readonly FaceName[] = ["front", "side", "top", "back", "rside", "bottom"];

/** Tight bounds of a part's painted voxels in its local box. */
export interface Box3 {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  c0: number;
  c1: number;
}

const boxes = new WeakMap<Int32Array, Box3>();

export function texBox(p: NamedPart): Box3 {
  const vol = volumeOf(p);
  let box = boxes.get(vol);
  if (box) return box;
  box = { a0: p.w, a1: 0, b0: p.d, b1: 0, c0: p.h, c1: 0 };
  for (let c = 0; c < p.h; c++)
    for (let b = 0; b < p.d; b++)
      for (let a = 0; a < p.w; a++) {
        if (!vol[(c * p.d + b) * p.w + a]) continue;
        box.a0 = Math.min(box.a0, a);
        box.a1 = Math.max(box.a1, a + 1);
        box.b0 = Math.min(box.b0, b);
        box.b1 = Math.max(box.b1, b + 1);
        box.c0 = Math.min(box.c0, c);
        box.c1 = Math.max(box.c1, c + 1);
      }
  if (box.a1 <= box.a0) box = { a0: 0, a1: p.w, b0: 0, b1: p.d, c0: 0, c1: p.h };
  boxes.set(vol, box);
  return box;
}

/** Local point of a face at texture coordinates (u right, v down). */
export function facePoint(k: Box3, face: FaceName, u: number, v: number): [number, number, number] {
  const W = k.a1 - k.a0;
  const D = k.b1 - k.b0;
  const H = k.c1 - k.c0;
  switch (face) {
    case "front":
      return [k.a0 + u * W, k.b1, k.c1 - v * H];
    case "side":
      return [k.a1, k.b1 - u * D, k.c1 - v * H];
    case "top":
      return [k.a0 + u * W, k.b0 + v * D, k.c1];
    case "back":
      return [k.a1 - u * W, k.b0, k.c1 - v * H];
    case "rside":
      return [k.a0, k.b0 + u * D, k.c1 - v * H];
    case "bottom":
      return [k.a0 + u * W, k.b1 - v * D, k.c0];
  }
}

const NORMAL: Readonly<Record<FaceName, readonly [number, number, number]>> = {
  front: [0, 1, 0],
  side: [1, 0, 0],
  top: [0, 0, 1],
  back: [0, -1, 0],
  rside: [-1, 0, 0],
  bottom: [0, 0, -1],
};

/** Fallback source when an atlas has no baked texture for a face, and whether it is mirrored horizontally. */
export function faceSource(face: FaceName): { src: SourceFace; flipU: boolean } {
  switch (face) {
    case "back":
      return { src: "side", flipU: false };
    case "rside":
      return { src: "side", flipU: true };
    case "bottom":
      return { src: "top", flipU: false };
    default:
      return { src: face, flipU: false };
  }
}

/** Brightness of each lit orientation, from the floors' box shading (top +0.08, left -0.12, right -0.3). */
export const FACE_LIGHT = { top: 1.08, left: 0.88, right: 0.7 } as const;

/** Lighting already baked into a face texture: captured faces carry the reference light, synthesised ones are front-lit. */
export function sourceLight(face: FaceName): number {
  return face === "side" ? FACE_LIGHT.right : face === "top" ? FACE_LIGHT.top : FACE_LIGHT.left;
}

const ARMS = new Set<PartName>(["upperR", "upperL", "foreR", "foreL", "thumb"]);

export interface ProjectedFace {
  part: NamedPart;
  box: Box3;
  face: FaceName;
  /** Screen points (model units) at uv (0,0), (1,0) and (0,1). */
  o: [number, number];
  eu: [number, number];
  ev: [number, number];
  depth: number;
  /** Brightness this face should have for its current orientation (see FACE_LIGHT). */
  light: number;
}

const VIEW: readonly [number, number, number] = [1, 1, 1 / Z_SCALE];

function apply(m: Mat, p: readonly number[]): [number, number, number] {
  return [
    m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * p[2]! + m[9]!,
    m[3]! * p[0]! + m[4]! * p[1]! + m[5]! * p[2]! + m[10]!,
    m[6]! * p[0]! + m[7]! * p[1]! + m[8]! * p[2]! + m[11]!,
  ];
}

function rotate(m: Mat, n: readonly number[]): [number, number, number] {
  return [
    m[0]! * n[0]! + m[1]! * n[1]! + m[2]! * n[2]!,
    m[3]! * n[0]! + m[4]! * n[1]! + m[5]! * n[2]!,
    m[6]! * n[0]! + m[7]! * n[1]! + m[8]! * n[2]!,
  ];
}

export function screen(p: readonly number[]): [number, number] {
  return [p[0]! - p[1]!, (p[0]! + p[1]!) / 2 - p[2]! * Z_SCALE];
}

/** Brightness a face should have for a world normal (weighted by how much it faces each lit direction). */
export function lightFor(n: readonly number[]): number {
  const wx = Math.max(0, n[0]!);
  const wy = Math.max(0, n[1]!);
  const wz = Math.max(0, n[2]!);
  const sum = wx + wy + wz;
  return sum > 0 ? (wx * FACE_LIGHT.right + wy * FACE_LIGHT.left + wz * FACE_LIGHT.top) / sum : FACE_LIGHT.right;
}

/** Stand-pose boxes per part name (texture boxes never change with the pose). */
const standBoxes = new WeakMap<AvatarSpec, Map<string, Box3>>();

export function standBox(spec: AvatarSpec, name: PartName): Box3 | undefined {
  let map = standBoxes.get(spec);
  if (!map) {
    map = new Map(buildParts(spec, REST_RIG).map((p) => [p.name, texBox(p)]));
    standBoxes.set(spec, map);
  }
  return map.get(name);
}

/** Every box face the viewer can see, back to front, for a rig and facing. */
export function projectFaces(spec: AvatarSpec, rig: Rig, facing: Facing, filter?: (p: NamedPart) => boolean, mirrored = false): ProjectedFace[] {
  const fm = facingMatrix(facing);
  const out: ProjectedFace[] = [];
  const parts = buildParts(spec, rig);
  const torso = parts.find((p) => p.name === "torso")!;
  const shoulder = apply(mul(fm, torso.m), [0, 0, torso.h])[2];
  for (const part of parts) {
    if (filter && !filter(part)) continue;
    const m = mul(fm, part.m);
    const raised = ARMS.has(part.name) && apply(m, [part.w / 2, part.d / 2, part.h / 2])[2] > shoulder + 2 ? 1000 : 0;
    const box = standBox(spec, part.name) ?? texBox(part);
    for (const face of ALL_FACES) {
      const n = rotate(m, NORMAL[face]);
      if (n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2] <= 1e-6) continue;
      const p00 = apply(m, facePoint(box, face, 0, 0));
      const s00 = screen(p00);
      const s10 = screen(apply(m, facePoint(box, face, 1, 0)));
      const s01 = screen(apply(m, facePoint(box, face, 0, 1)));
      const c = apply(m, facePoint(box, face, 0.5, 0.5));
      out.push({
        part,
        box,
        face,
        o: s00,
        eu: [s10[0] - s00[0], s10[1] - s00[1]],
        ev: [s01[0] - s00[0], s01[1] - s00[1]],
        depth: c[0] * VIEW[0] + c[1] * VIEW[1] + c[2] * VIEW[2] + raised,
        light: lightFor(mirrored ? [n[1], n[0], n[2]] : n),
      });
    }
  }
  return out.sort((a, b) => a.depth - b.depth);
}
