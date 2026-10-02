import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { SPRITE_URLS } from "../../assets/floorAssets";
import type { SpriteKey } from "../../characters";
import { AVATAR_KEYS, avatarCacheSize, EMOTES, FACINGS, POSES, portraitTexture, setAvatarRenderer, specFor, VoxelAvatar } from "../index";
import type { Emote, Facing, Pose } from "../types";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "compare";
const H = Number(params.get("h") ?? (mode === "compare" ? 300 : 150));
const live = params.get("live") === "1";
const reduced = params.get("reduced") === "1";
const filter = params.get("keys");
const keys = AVATAR_KEYS.filter((k) => !filter || filter.split(",").some((f) => k.startsWith(`${f}/`) || k.endsWith(`/${f}`)));

const bar = document.getElementById("bar")!;
if (mode === "solo") bar.style.display = "none";
for (const m of ["compare", "facings", "poses", "emotes", "portraits", "crowd"]) {
  const a = document.createElement("a");
  a.href = `?mode=${m}${filter ? `&keys=${filter}` : ""}`;
  a.textContent = m;
  bar.appendChild(a);
}

const app = new Application();
const avatars: VoxelAvatar[] = [];

function label(text: string, x: number, y: number, parent: Container): void {
  const t = new Text({ text, style: { fontSize: 12, fill: 0x222222, fontFamily: "system-ui" } });
  t.anchor.set(0.5, 0);
  t.position.set(x, y);
  parent.addChild(t);
}

function avatar(key: SpriteKey, h: number, facing: Facing, pose: Pose, emote: Emote, warm: number): VoxelAvatar {
  const a = new VoxelAvatar(specFor(key), { height: h, facing, pose, reducedMotion: reduced });
  if (emote !== "none") a.setEmote(emote);
  if (warm) a.update(warm);
  avatars.push(a);
  return a;
}

async function compare(root: Container): Promise<[number, number]> {
  const perRow = Number(params.get("cols") ?? 5);
  const cellW = H * 0.95;
  const cellH = H + 50;
  const textures = await Promise.all(keys.map((k) => Assets.load<Texture>(SPRITE_URLS[k])));
  keys.forEach((k, i) => {
    const cx = (i % perRow) * cellW + cellW / 2;
    const top = Math.floor(i / perRow) * cellH + 40;
    const ref = new Sprite(textures[i]!);
    ref.scale.set(H / ref.texture.height);
    ref.anchor.set(1, 1);
    ref.position.set(cx - 4, top + H);
    root.addChild(ref);
    const a = avatar(k, H, "SW", "stand", "none", 0);
    a.position.set(cx + H * 0.17, top + H - a.getLocalBounds().maxY);
    root.addChild(a);
    label(k, cx, top + H + 6, root);
  });
  return [perRow * cellW, Math.ceil(keys.length / perRow) * cellH + 40];
}

function grid(root: Container, columns: { title: string; facing: Facing; pose: Pose; emote: Emote; warm: number }[]): [number, number] {
  const cellW = H * 0.62;
  const cellH = H + 34;
  columns.forEach((c, j) => label(c.title, j * cellW + cellW / 2 + 110, 36, root));
  keys.forEach((k, i) => {
    const y = 60 + i * cellH + H;
    label(k, 55, y - H / 2, root);
    columns.forEach((c, j) => {
      const a = avatar(k, H, c.facing, c.pose, c.emote, c.warm);
      a.position.set(j * cellW + cellW / 2 + 110, y);
      const floor = new Graphics().ellipse(0, 0, H * 0.16, H * 0.07).fill({ color: 0x000000, alpha: 0.12 });
      floor.position.copyFrom(a.position);
      root.addChild(floor, a);
    });
  });
  return [columns.length * cellW + 120, keys.length * cellH + 80];
}

function columnsFor(m: string) {
  if (m === "facings") return FACINGS.flatMap((f) => POSES.map((p) => ({ title: `${f} ${p}`, facing: f, pose: p, emote: "none" as Emote, warm: p === "walk" ? 220 : 130 })));
  if (m === "poses") {
    return [0, 1, 2, 3, 4, 5]
      .map((f) => ({ title: `walk ${f}`, facing: "SW" as Facing, pose: "walk" as Pose, emote: "none" as Emote, warm: f * 110 + 1 }))
      .concat([
        { title: "sit", facing: "SW", pose: "sit", emote: "none", warm: 0 },
        { title: "type", facing: "SW", pose: "type", emote: "none", warm: 0 },
        { title: "type NW", facing: "NW", pose: "type", emote: "none", warm: 260 },
        { title: "walk NE", facing: "NE", pose: "walk", emote: "none", warm: 160 },
      ]);
  }
  return EMOTES.filter((e) => e !== "none").flatMap((e) => [
    { title: e, facing: "SW" as Facing, pose: "stand" as Pose, emote: e, warm: 160 },
    { title: `${e} sit`, facing: "SE" as Facing, pose: "sit" as Pose, emote: e, warm: 320 },
  ]);
}

function solo(root: Container): [number, number] {
  keys.forEach((k, i) => {
    const a = avatar(k, H, (params.get("facing") as Facing | null) ?? "SW", (params.get("pose") as Pose | null) ?? "stand", "none", 0);
    a.position.set(i * H * 0.6 + H * 0.3, H + 20 - a.getLocalBounds().maxY);
    root.addChild(a);
  });
  return [keys.length * H * 0.6, H + 40];
}

function portraits(root: Container): [number, number] {
  keys.forEach((k, i) => {
    const s = new Sprite(portraitTexture(specFor(k), 96));
    s.position.set(20 + (i % 10) * 110, 40 + Math.floor(i / 10) * 130);
    root.addChild(s);
    label(k.split("/")[1]!, s.x + 48, s.y + 100, root);
  });
  return [1120, 320];
}

function crowd(root: Container): [number, number] {
  const n = Number(params.get("n") ?? 60);
  for (let i = 0; i < n; i++) {
    const k = AVATAR_KEYS[i % AVATAR_KEYS.length]!;
    const a = avatar(k, 70, FACINGS[i % 4]!, i % 3 === 0 ? "walk" : i % 3 === 1 ? "type" : "stand", "none", i * 37);
    a.position.set(40 + (i % 15) * 70, 120 + Math.floor(i / 15) * 100);
    root.addChild(a);
  }
  return [1100, 140 + Math.ceil(n / 15) * 100];
}

async function main(): Promise<void> {
  await app.init({ background: 0xc8c8cd, width: 400, height: 300, antialias: true, resolution: 1 });
  setAvatarRenderer(app.renderer);
  document.getElementById("stage")!.appendChild(app.canvas);
  const root = new Container();
  app.stage.addChild(root);
  const t0 = performance.now();
  const [w, h] =
    mode === "compare" ? await compare(root) : mode === "solo" ? solo(root) : mode === "portraits" ? portraits(root) : mode === "crowd" ? crowd(root) : grid(root, columnsFor(mode));
  app.renderer.resize(Math.ceil(w), Math.ceil(h));
  (window as unknown as { buildMs: number }).buildMs = performance.now() - t0;
  if (live || mode === "crowd") app.ticker.add((t) => avatars.forEach((a) => a.update(t.deltaMS)));
  Object.assign(window as object, { ready: true, app, avatarCacheSize });
}

void main();
