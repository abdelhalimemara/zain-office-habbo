"""Usage: python3 bakeAtlases.py <rig.json> <sprite dir with people/ and board/> <out dir> [height]

Projects each reference sprite onto the avatar's stand-pose part faces and writes one WebP atlas
plus face metadata per character, and urls.ts importing them."""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

RIG, SRC, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
R = int(sys.argv[4]) if len(sys.argv) > 4 else 520
FIT_SCALE = 8
RIM = 3
NEUTRAL = {"front": 1.0, "side": 0.88 / 0.7, "top": 0.88 / 1.08}
ORIGINALS = {
    **{f"people/male-{i}": f"people/Male {i}.png" for i in range(1, 10)},
    **{f"people/female-{i}": f"people/Female {i}.png" for i in range(1, 6)},
    "board/hormozi": "board/Alex Hormozi.png",
    "board/alwaleed": "board/HRH. Waleed Bin Talal.png",
    "board/bezos": "board/Jeff Bezoz.png",
    "board/buffett": "board/Warren Buffet.png",
    "board/jobs": "board/Steve Jobs.png",
}


def load_ref(key):
    path = os.path.join(SRC, ORIGINALS[key])
    if not os.path.exists(path):
        path = os.path.join(SRC, key + ".webp")
    im = Image.open(path).convert("RGBA")
    im = im.crop(im.getbbox())
    w = round(im.width * R / im.height)
    return np.asarray(im.resize((w, R), Image.LANCZOS)).astype(np.float32)


def silhouette(rig):
    x0, y0, x1, y1 = rig["bounds"]
    w, h = int((x1 - x0) * FIT_SCALE) + 2, int((y1 - y0) * FIT_SCALE) + 2
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    q = rig["quads"]
    for i in range(0, len(q), 8):
        d.polygon([((q[i + k] - x0) * FIT_SCALE, (q[i + k + 1] - y0) * FIT_SCALE) for k in range(0, 8, 2)], fill=255)
    return im


def fit(rig, alpha):
    """Affine X = ax*u + bx, Y = ay*v + by maximising silhouette overlap with the reference."""
    x0, y0, x1, y1 = rig["bounds"]
    sil = silhouette(rig)
    H, W = alpha.shape
    ref = alpha > 128
    ax0, ay0 = W / (x1 - x0), H / (y1 - y0)
    best = (-1, None)
    for kx in np.arange(0.92, 1.081, 0.02):
        for ky in np.arange(0.96, 1.041, 0.02):
            ax, ay = ax0 * kx, ay0 * ky
            for dx in range(-8, 9, 2):
                for dy in range(-6, 7, 2):
                    bx = -x0 * ax + (W - (x1 - x0) * ax) / 2 + dx
                    by = -y0 * ay + (H - (y1 - y0) * ay) + dy
                    # output pixel (X,Y) -> unit u=(X-bx)/ax -> sil px (u-x0)*S
                    m = (FIT_SCALE / ax, 0, (-bx / ax - x0) * FIT_SCALE, 0, FIT_SCALE / ay, (-by / ay - y0) * FIT_SCALE)
                    mine = np.asarray(sil.transform((W, H), Image.AFFINE, m, Image.NEAREST)) > 128
                    iou = (mine & ref).sum() / max(1, (mine | ref).sum())
                    if iou > best[0]:
                        best = (iou, (ax, ay, bx, by))
    return best


def to_img(f, fitp, u, v):
    ax, ay, bx, by = fitp
    x = f["o"][0] + u * f["eu"][0] + v * f["ev"][0]
    y = f["o"][1] + u * f["eu"][1] + v * f["ev"][1]
    return x * ax + bx, y * ay + by


def bake(rig):
    key = rig["key"]
    img = load_ref(key)
    alpha = img[..., 3]
    iou, fitp = fit(rig, alpha)
    ax, ay, bx, by = fitp
    H, W = alpha.shape
    faces = rig["faces"]
    owner = Image.new("I", (W, H), 0)
    d = ImageDraw.Draw(owner)
    for i, f in enumerate(faces):
        corners = [to_img(f, fitp, u, v) for u, v in ((0, 0), (1, 0), (1, 1), (0, 1))]
        d.polygon(corners, fill=i + 1)
    own = np.asarray(owner).astype(np.int32)
    inside = alpha > 8
    _, (iy, ix) = ndimage.distance_transform_edt(own == 0, return_indices=True)
    own = np.where(inside, own[iy, ix], 0)
    textures = []
    for i, f in enumerate(faces):
        E = np.array([[f["eu"][0] * ax, f["ev"][0] * ax], [f["eu"][1] * ay, f["ev"][1] * ay]])
        O = np.array([f["o"][0] * ax + bx, f["o"][1] * ay + by])
        inv = np.linalg.inv(E)
        ys, xs = np.nonzero(own == i + 1)
        u0, u1, v0, v1 = 0.0, 1.0, 0.0, 1.0
        if len(xs):
            uv = inv @ (np.stack([xs + 0.5, ys + 0.5]) - O[:, None])
            u0, u1 = min(0.0, uv[0].min()), max(1.0, uv[0].max())
            v0, v1 = min(0.0, uv[1].min()), max(1.0, uv[1].max())
        lu, lv = np.hypot(*E[:, 0]), np.hypot(*E[:, 1])
        u0, u1, v0, v1 = u0 - RIM / lu, u1 + RIM / lu, v0 - RIM / lv, v1 + RIM / lv
        tw, th = max(2, int(np.ceil((u1 - u0) * lu)) + 1), max(2, int(np.ceil((v1 - v0) * lv)) + 1)
        tu = u0 + (np.arange(tw) + 0.5) / tw * (u1 - u0)
        tv = v0 + (np.arange(th) + 0.5) / th * (v1 - v0)
        U, V = np.meshgrid(tu, tv)
        X = O[0] + U * E[0, 0] + V * E[0, 1]
        Y = O[1] + U * E[1, 0] + V * E[1, 1]
        xi = np.clip(np.floor(X).astype(int), 0, W - 1)
        yi = np.clip(np.floor(Y).astype(int), 0, H - 1)
        valid = (X >= 0) & (X < W) & (Y >= 0) & (Y < H)
        mine = valid & (own[yi, xi] == i + 1)
        tex = np.zeros((th, tw, 4), np.float32)
        tex[mine] = img[yi, xi][mine]
        s = f["surface"]
        surf = np.array(s["data"], np.int64).reshape(s["rows"], s["cols"]) if s["cols"] and s["rows"] else np.full((1, 1), -1)
        core = (U >= 0) & (U < 1) & (V >= 0) & (V < 1)
        su = np.clip((U * surf.shape[1]).astype(int), 0, surf.shape[1] - 1)
        sv = np.clip((V * surf.shape[0]).astype(int), 0, surf.shape[0] - 1)
        solid = core & (surf[sv, su] >= 0)
        hidden = solid & ~mine & valid & inside[yi, xi]
        if hidden.any():
            if mine.any():
                _, (jy, jx) = ndimage.distance_transform_edt(~mine, return_indices=True)
                tex[hidden] = tex[jy, jx][hidden]
            else:
                col = surf[sv, su]
                rgb = np.stack([(col >> 16) & 255, (col >> 8) & 255, col & 255, np.full_like(col, 255)], -1).astype(np.float32)
                tex[hidden] = rgb[hidden]
        opaque = tex[..., 3] > 0
        rim = ndimage.binary_dilation(opaque, iterations=RIM) & ~opaque & valid & inside[yi, xi]
        tex[rim] = img[yi, xi][rim]
        textures.append((f["part"], f["face"], tex, (u0, u1, v0, v1)))
    textures += synthesise(rig, textures, ax)
    return iou, fitp, (W, H), textures


def rgb_of(col):
    col = np.asarray(col, np.int64)
    return np.stack([(col >> 16) & 255, (col >> 8) & 255, col & 255], -1).astype(np.float32)


def synthesise(rig, captured, tpu_f):
    """Back and right-side textures for faces the reference never shows: the voxel surface colours,
    re-toned per material to the reference's own colours, with soft per-voxel bevels."""
    pairs = {}
    for f, (part, face, tex, (u0, u1, v0, v1)) in zip(rig["faces"], captured):
        s = f["surface"]
        if not s["cols"] or not s["rows"]:
            continue
        cols, rows = s["cols"], s["rows"]
        surf = np.array(s["data"]).reshape(rows, cols)
        th, tw = tex.shape[:2]
        for r in range(rows):
            for q in range(cols):
                if surf[r, q] < 0:
                    continue
                tx = int(((q + 0.5) / cols - u0) / (u1 - u0) * tw)
                ty = int(((r + 0.5) / rows - v0) / (v1 - v0) * th)
                if 0 <= tx < tw and 0 <= ty < th and tex[ty, tx, 3] > 200:
                    pairs.setdefault(part, []).append((rgb_of(surf[r, q]), tex[ty, tx, :3] * NEUTRAL[face]))
    every = [p for v in pairs.values() for p in v]
    tpu = max(3, int(round(tpu_f * 0.6)))
    out = []
    for p in rig["parts"]:
        pool = pairs.get(p["part"], [])
        pool = pool if len(pool) >= 12 else every
        if not pool:
            continue
        bins = {}
        for a, b in pool:
            bins.setdefault(tuple((a // 48).astype(int)), []).append((a, b))
        lum = lambda c: c @ np.array([0.3, 0.55, 0.15])
        gains = {k: lum(np.median(np.stack([b for _, b in v]), 0)) / max(1, lum(np.median(np.stack([a for a, _ in v]), 0))) for k, v in bins.items()}
        keys = np.array(list(gains.keys()))
        for face in ("back", "rside"):
            s = p[face]
            cols, rows = s["cols"], s["rows"]
            if not cols or not rows:
                continue
            surf = np.array(s["data"]).reshape(rows, cols)
            tex = np.zeros((rows * tpu, cols * tpu, 4), np.float32)
            fu = (np.arange(tpu) + 0.5) / tpu
            bevel = 1 + 0.04 * (fu[:, None] < 0.2) + 0.02 * (fu[None, :] < 0.2) - 0.05 * (fu[:, None] > 0.8) - 0.03 * (fu[None, :] > 0.8)
            for r in range(rows):
                for q in range(cols):
                    if surf[r, q] < 0:
                        continue
                    v = rgb_of(surf[r, q])
                    k = tuple((v // 48).astype(int))
                    if k not in gains:
                        k = tuple(keys[np.abs(keys - np.array(k)).sum(1).argmin()])
                    c = np.clip(v * np.clip(gains[k], 0.8, 1.25), 0, 255)
                    cell = c[None, None, :] * bevel[..., None] 
                    tex[r * tpu : (r + 1) * tpu, q * tpu : (q + 1) * tpu, :3] = np.clip(cell, 0, 255)
                    tex[r * tpu : (r + 1) * tpu, q * tpu : (q + 1) * tpu, 3] = 255
            out.append((p["part"], face, tex, (0.0, 1.0, 0.0, 1.0)))
    return out


def pack(textures, width=512):
    x = y = row = 0
    places = []
    for _, _, tex, _ in textures:
        th, tw = tex.shape[:2]
        if x + tw + 2 > width:
            x, y, row = 0, y + row + 2, 0
        places.append((x, y))
        x += tw + 2
        row = max(row, th)
    atlas = np.zeros((y + row + 1, width, 4), np.float32)
    for (px, py), (_, _, tex, _) in zip(places, textures):
        atlas[py : py + tex.shape[0], px : px + tex.shape[1]] = tex
    return atlas, places


def main():
    rigs = json.load(open(RIG))
    os.makedirs(OUT, exist_ok=True)
    imports = []
    for rig in rigs:
        key = rig["key"]
        iou, (ax, ay, bx, by), (W, H), textures = bake(rig)
        atlas, places = pack(textures)
        name = key.replace("/", "-")
        Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, name + ".webp"), "WEBP", quality=80, method=6, exact=False)
        faces = {}
        for (part, face, tex, (u0, u1, v0, v1)), (px, py) in zip(textures, places):
            solid = tex[..., 3] > 128
            avg = tex[solid][:, :3].mean(0) if solid.any() else np.array([128, 128, 128])
            rgb = (int(avg[0]) << 16) | (int(avg[1]) << 8) | int(avg[2])
            faces.setdefault(part, {})[face] = [px, py, tex.shape[1], tex.shape[0], round(u0, 4), round(u1, 4), round(v0, 4), round(v1, 4), rgb]
        meta = {"fit": [round(ax, 4), round(ay, 4), round(bx, 3), round(by, 3)], "size": [W, H], "faces": faces}
        json.dump(meta, open(os.path.join(OUT, name + ".json"), "w"), separators=(",", ":"))
        size = os.path.getsize(os.path.join(OUT, name + ".webp"))
        print(f"{key} iou={iou:.3f} atlas={atlas.shape[1]}x{atlas.shape[0]} {size // 1024}KB")
        imports.append(name)
    ident = lambda n: n.replace("-", "_").replace("people_", "").replace("board_", "")
    lines = ['import type { SpriteKey } from "../../characters";']
    for n in imports:
        lines.append(f'import {ident(n)}Url from "./{n}.webp";')
        lines.append(f'import {ident(n)}Meta from "./{n}.json";')
    lines.append("")
    lines.append("export const ATLASES: Readonly<Record<SpriteKey, { url: string; meta: unknown }>> = {")
    for rig, n in zip(rigs, imports):
        lines.append(f'  "{rig["key"]}": {{ url: {ident(n)}Url, meta: {ident(n)}Meta }},')
    lines.append("};")
    open(os.path.join(OUT, "urls.ts"), "w").write("\n".join(lines) + "\n")


main()
