import { VoxelAvatar, loadAvatarAtlases, specFor } from "./avatars";
import type { SpriteKey } from "./characters";

let ready: Promise<void> | null = null;

/** Loads the avatar texture atlases once; avatars built before this resolves fall back to plain voxel shading. */
export function avatarsReady(): Promise<void> {
  ready ??= loadAvatarAtlases().catch(() => undefined);
  return ready;
}

const heights = new Map<string, number>();

/**
 * The `height` option that makes a character's drawn figure (feet to head top) exactly `target` px tall. The voxel
 * figures are stretched vertically relative to their nominal height, so this is measured once per character.
 */
export function avatarHeight(key: SpriteKey, target: number): number {
  const cacheKey = `${key}@${target}`;
  const hit = heights.get(cacheKey);
  if (hit) return hit;
  const probe = new VoxelAvatar(specFor(key), { height: target, reducedMotion: true });
  const drawn = -probe.headTop.y;
  probe.destroy();
  const h = drawn > 1 ? (target * target) / drawn : target;
  heights.set(cacheKey, h);
  return h;
}
