export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function shade(color: number, f: number): number {
  return f >= 0 ? mix(color, 0xffffff, f) : mix(color, 0x000000, -f);
}

export function hash3(a: number, b: number, c: number, seed = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Subtle per-voxel brightness noise, stable for a given part-local voxel. */
export function noisy(color: number, a: number, b: number, c: number, seed: number, amount = 0.045): number {
  return shade(color, (hash3(a, b, c, seed) - 0.5) * 2 * amount);
}

/** Brighten by scaling the channels (keeps the hue, unlike mixing with white); bright colours fall back to a white mix. */
export function lighten(color: number, f: number): number {
  const k = 1 + f;
  const r = ((color >> 16) & 0xff) * k;
  const g = ((color >> 8) & 0xff) * k;
  const b = (color & 0xff) * k;
  const over = Math.max(r, g, b) - 255;
  const base = (Math.min(255, Math.round(r)) << 16) | (Math.min(255, Math.round(g)) << 8) | Math.min(255, Math.round(b));
  return over > 0 ? mix(base, 0xffffff, Math.min(1, over / 255) * 0.5) : base;
}
