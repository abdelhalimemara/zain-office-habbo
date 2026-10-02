import { Assets, Container, Matrix, Rectangle, Sprite, Texture } from "pixi.js";
import type { SpriteKey } from "../characters";
import { ATLASES } from "./atlas/urls";
import { lighten } from "./color";
import { faceSource, projectFaces, sourceLight, type ProjectedFace } from "./faces";
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

function lit(sprite: Sprite, ratio: number, out: Sprite[]): void {
  sprite.tint = gray(ratio);
  out.push(sprite);
  if (ratio <= 1.01) return;
  const glow = new Sprite(sprite.texture);
  glow.position.copyFrom(sprite.position);
  glow.scale.copyFrom(sprite.scale);
  glow.skew.copyFrom(sprite.skew);
  glow.rotation = sprite.rotation;
  glow.pivot.copyFrom(sprite.pivot);
  glow.tint = gray(ratio - 1);
  glow.blendMode = "add";
  out.push(glow);
}

function faceSprites(a: Atlas, f: ProjectedFace, sx: number, sy: number, solid: boolean): Sprite[] {
  const out: Sprite[] = [];
  const own = a.meta.faces[f.part.name]?.[f.face];
  const fallback = faceSource(f.face);
  const src = own ? f.face : fallback.src;
  const flipU = own ? false : fallback.flipU;
  const rect = own ?? a.meta.faces[f.part.name]?.[fallback.src];
  const ratio = f.light / sourceLight(src);
  const sprite = new Sprite();
  if (!rect) {
    const vol = volumeOf(f.part);
    let col = 0xaaaaaa;
    for (const v of vol)
      if (v) {
        col = v - 1;
        break;
      }
    sprite.texture = Texture.WHITE;
    sprite.tint = f.face === "top" ? lighten(col, 0.3) : shadeRgb(col, f.light);
    out.push(place(sprite, f, sx, sy, 0, 1, 0, 1, false));
    return out;
  }
  const [x, y, w, h, u0, u1, v0, v1, avg] = rect;
  if (solid || !own) {
    const under = new Sprite(Texture.WHITE);
    under.tint = shadeRgb(avg, Math.min(1, ratio));
    out.push(place(under, f, sx, sy, 0, 1, 0, 1, false));
  }
  if (own) {
    sprite.texture = frameTexture(a, `${f.part.name}/${src}`, x, y, w, h);
    lit(place(sprite, f, sx, sy, u0, u1, v0, v1, false), ratio, out);
    return out;
  }
  const cx0 = x + Math.round(((0 - u0) / (u1 - u0)) * w);
  const cx1 = x + Math.round(((1 - u0) / (u1 - u0)) * w);
  const cy0 = y + Math.round(((0 - v0) / (v1 - v0)) * h);
  const cy1 = y + Math.round(((1 - v0) / (v1 - v0)) * h);
  sprite.texture = frameTexture(a, `${f.part.name}/${src}/core`, cx0, cy0, cx1 - cx0, cy1 - cy0);
  lit(place(sprite, f, sx, sy, 0, 1, 0, 1, flipU), ratio, out);
  return out;
}

export function texturedFigure(spec: AvatarSpec, rig: Rig, facing: Extract<Facing, "SW" | "NW">, sx: number, sy: number, mirrored = false): Container | null {
  const a = atlases.get(spec.key);
  if (!a) return null;
  const root = new Container();
  for (const f of projectFaces(spec, rig, facing, undefined, mirrored)) {
    for (const s of faceSprites(a, f, sx, sy, facing === "NW")) root.addChild(s);
  }
  return root;
}
