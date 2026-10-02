import { Assets, Container, Matrix, Rectangle, Sprite, Texture } from "pixi.js";
import type { SpriteKey } from "../characters";
import { ATLASES } from "./atlas/urls";
import { faceSource, projectFaces, type ProjectedFace } from "./faces";
import { volumeOf } from "./raster";
import type { AvatarSpec, Facing, Rig } from "./types";

/** [x, y, w, h, u0, u1, v0, v1, average rgb]: atlas rect, the face uv range it covers and its mean colour. */
type FaceRect = readonly [number, number, number, number, number, number, number, number, number];

export interface AtlasMeta {
  /** Reference fit: image px = (ax * u + bx, ay * v + by) for model screen units (u, v). */
  fit: readonly [number, number, number, number];
  size: readonly [number, number];
  faces: Readonly<Record<string, Readonly<Record<string, FaceRect>>>>;
}

interface Atlas {
  meta: AtlasMeta;
  source: Texture;
  frames: Map<string, Texture>;
}

const atlases = new Map<SpriteKey, Atlas>();
let loading: Promise<void> | null = null;

/** Load every reference-texture atlas; avatars built before this resolves use the voxel look. */
export function loadAvatarAtlases(): Promise<void> {
  loading ??= Promise.all(
    (Object.keys(ATLASES) as SpriteKey[]).map(async (key) => {
      const { url, meta } = ATLASES[key];
      const source = await Assets.load<Texture>(url);
      atlases.set(key, { meta: meta as AtlasMeta, source, frames: new Map() });
    }),
  ).then(() => undefined);
  return loading;
}

export function hasAtlas(spec: AvatarSpec): boolean {
  return atlases.has(spec.key);
}

/** Screen px per model unit (x, y) that reproduce the reference at `height`, and the reference's top above the feet. */
export function texturedScale(spec: AvatarSpec, height: number): { sx: number; sy: number; top: number } | null {
  const a = atlases.get(spec.key);
  if (!a) return null;
  const [ax, ay, , by] = a.meta.fit;
  const f = height / a.meta.size[1];
  return { sx: ax * f, sy: ay * f, top: -by * f };
}

function frameTexture(a: Atlas, key: string, x: number, y: number, w: number, h: number): Texture {
  let t = a.frames.get(key);
  if (!t) {
    t = new Texture({ source: a.source.source, frame: new Rectangle(a.source.frame.x + x, a.source.frame.y + y, Math.max(1, w), Math.max(1, h)) });
    a.frames.set(key, t);
  }
  return t;
}

const gray = (t: number) => {
  const v = Math.round(Math.max(0, Math.min(1, t)) * 255);
  return (v << 16) | (v << 8) | v;
};

function shadeRgb(col: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return (Math.round(((col >> 16) & 255) * k) << 16) | (Math.round(((col >> 8) & 255) * k) << 8) | Math.round((col & 255) * k);
}

function place(sprite: Sprite, f: ProjectedFace, sx: number, sy: number, U0: number, U1: number, V0: number, V1: number, flipU: boolean): Sprite {
  const tw = sprite.texture.frame.width;
  const th = sprite.texture.frame.height;
  const eu = [f.eu[0] * sx, f.eu[1] * sy] as const;
  const ev = [f.ev[0] * sx, f.ev[1] * sy] as const;
  const du = flipU ? -(U1 - U0) : U1 - U0;
  const ou = flipU ? U1 : U0;
  const ox = f.o[0] * sx + ou * eu[0] + V0 * ev[0];
  const oy = f.o[1] * sy + ou * eu[1] + V0 * ev[1];
  sprite.setFromMatrix(new Matrix((eu[0] * du) / tw, (eu[1] * du) / tw, (ev[0] * (V1 - V0)) / th, (ev[1] * (V1 - V0)) / th, ox, oy));
  return sprite;
}

function faceSprites(a: Atlas, f: ProjectedFace, sx: number, sy: number, solid: boolean): Sprite[] {
  const { src, flipU } = faceSource(f.face);
  const rect = a.meta.faces[f.part.name]?.[src];
  const sprite = new Sprite();
  const out: Sprite[] = [];
  let U0 = 0;
  let U1 = 1;
  let V0 = 0;
  let V1 = 1;
  if (rect) {
    const [x, y, w, h, u0, u1, v0, v1] = rect;
    if (src === f.face) {
      if (solid) {
        const under = new Sprite(Texture.WHITE);
        under.tint = shadeRgb(rect[8], f.tint);
        out.push(place(under, f, sx, sy, 0, 1, 0, 1, false));
      }
      sprite.texture = frameTexture(a, `${f.part.name}/${src}`, x, y, w, h);
      [U0, U1, V0, V1] = [u0, u1, v0, v1];
    } else {
      const under = new Sprite(Texture.WHITE);
      under.tint = shadeRgb(rect[8], f.tint);
      out.push(place(under, f, sx, sy, 0, 1, 0, 1, false));
      const from = f.face === "back" && f.part.name === "head" ? 0.5 : 0;
      const cx0 = x + Math.round(((from - u0) / (u1 - u0)) * w);
      const cx1 = x + Math.round(((1 - u0) / (u1 - u0)) * w);
      const cy0 = y + Math.round(((0 - v0) / (v1 - v0)) * h);
      const cy1 = y + Math.round(((1 - v0) / (v1 - v0)) * h);
      sprite.texture = frameTexture(a, `${f.part.name}/${src}/core${from}`, cx0, cy0, cx1 - cx0, cy1 - cy0);
    }
    sprite.tint = gray(f.tint);
  } else {
    const vol = volumeOf(f.part);
    let col = 0xaaaaaa;
    for (const v of vol) if (v) {
      col = v - 1;
      break;
    }
    sprite.texture = Texture.WHITE;
    sprite.tint = shadeRgb(col, f.tint * (f.face === "top" ? 1.08 : f.face === "side" ? 0.7 : 0.88));
  }
  out.push(place(sprite, f, sx, sy, U0, U1, V0, V1, flipU));
  return out;
}

export function texturedFigure(spec: AvatarSpec, rig: Rig, facing: Extract<Facing, "SW" | "NW">, sx: number, sy: number): Container | null {
  const a = atlases.get(spec.key);
  if (!a) return null;
  const root = new Container();
  for (const f of projectFaces(spec, rig, facing)) {
    for (const s of faceSprites(a, f, sx, sy, facing === "NW")) root.addChild(s);
  }
  return root;
}
