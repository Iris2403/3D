"""Stage 1 of the KUKI 3D cookie model: texture + relief maps from the product render
(source-assets/kuki-cookie-render.webp, a 3/4 shot on a transparent background).

Outputs (source-assets/model/):
  albedo.png   1024×1280 atlas — rows 0–1023: top-down view of the cookie (the oblique shot
               unwarped); rows 1024–1279: the real side wall, unwrapped from the front edge
  normal.png   tangent-space normal map in the same atlas layout (fine crust / crumble detail)
  height.png   1024×1024 relief of the top (chocolate highest, then crumble, salt, crust grain)
  edge.json    the cookie's real outline: radius (0..1) per degree, from the top-view silhouette
Stage 2 (scripts/build-cookie-glb.mjs) turns these into theme/assets/kuki-cookie.glb.
Run: python3 scripts/build-cookie-maps.py
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'source-assets' / 'kuki-cookie-render.webp'
OUT = ROOT / 'source-assets' / 'model'
OUT.mkdir(exist_ok=True)

# Top face of the cookie in the render: ellipse centre + semi-axes (px), measured on a grid.
CX, CY, A, B = 782, 455, 631, 376
WALL = 150          # projected height of the side wall below the front edge (px)
S = 1024            # top-view resolution
STRIP_H = 256       # side-wall strip height in the atlas

src = Image.open(SRC).convert('RGBA')
W, H = src.size
rgba = np.asarray(src).astype(np.float32)
alpha = rgba[..., 3] / 255


def bilinear(img, x, y):
    x0 = np.clip(np.floor(x).astype(int), 0, img.shape[1] - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, img.shape[0] - 2)
    fx = np.clip(x - x0, 0, 1)[..., None] if img.ndim == 3 else np.clip(x - x0, 0, 1)
    fy = np.clip(y - y0, 0, 1)[..., None] if img.ndim == 3 else np.clip(y - y0, 0, 1)
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


# ---------------------------------------------------------------- 1. top view (unwarp)
gy, gx = np.mgrid[0:S, 0:S].astype(np.float32)
u = (gx + 0.5) / S * 2 - 1      # −1..1, right
v = (gy + 0.5) / S * 2 - 1      # −1..1, toward the viewer (front)
top = bilinear(rgba, CX + A * u, CY + B * v)
top_rgb, top_a = top[..., :3], top[..., 3] / 255
inside = (u ** 2 + v ** 2) <= 1.0
known = inside & (top_a > 0.9)

# Real outline: for each degree, how far the cookie extends (0..1 of the radius).
edge = []
for deg in range(360):
    t = math.radians(deg)
    r_edge = 1.0
    for rr in np.linspace(0.7, 1.0, 120):
        x = int(np.clip((rr * math.cos(t) + 1) / 2 * S, 0, S - 1))
        y = int(np.clip((rr * math.sin(t) + 1) / 2 * S, 0, S - 1))
        if top_a[y, x] < 0.5:
            r_edge = rr
            break
    edge.append(round(float(r_edge), 4))
# The front half's top edge is hidden by the wall in the photo: mirror the back half's shape.
for deg in range(1, 180):
    edge[deg] = edge[360 - deg]
(OUT / 'edge.json').write_text(json.dumps(edge))

# Fill everything outside the cookie by dilating its own edge colours outward.
rgb = top_rgb * known[..., None]
wgt = known.astype(np.float32)
for _ in range(60):
    blur = np.asarray(Image.fromarray(np.uint8(np.clip(rgb, 0, 255))).filter(ImageFilter.BoxBlur(3))).astype(np.float32)
    wb = np.asarray(Image.fromarray(np.uint8(wgt * 255)).filter(ImageFilter.BoxBlur(3))).astype(np.float32) / 255
    fill = (~known) & (wb > 0.05)
    rgb[fill] = np.clip(blur[fill] / np.maximum(wb[fill, None], 1e-3), 0, 255)
    wgt[fill] = 1
    known |= fill
top_rgb = rgb

# ---------------------------------------------------------------- 2. side wall strip
# Along the front arc of the top ellipse, the wall hangs WALL px below the edge. Sample that band
# (u = angle, v = down the wall), then mirror it so it wraps the whole cookie seamlessly.
ts = np.linspace(math.radians(28), math.radians(152), 900)
vs = np.linspace(0.04, 0.9, STRIP_H)
ex = CX + A * np.cos(ts)[None, :]
ey = CY + B * np.sin(ts)[None, :] + vs[:, None] * WALL
band = bilinear(rgba, np.repeat(ex, STRIP_H, 0), ey)
band_rgb = band[..., :3]
half = Image.fromarray(np.uint8(np.clip(band_rgb, 0, 255))).resize((S // 2, STRIP_H), Image.LANCZOS)
strip = np.concatenate([np.asarray(half), np.asarray(half)[:, ::-1]], axis=1).astype(np.float32)

albedo = np.concatenate([top_rgb, strip], axis=0)
Image.fromarray(np.uint8(np.clip(albedo, 0, 255))).save(OUT / 'albedo.png')

# ---------------------------------------------------------------- 3. relief (height map)
r_, g_, b_ = top_rgb[..., 0] / 255, top_rgb[..., 1] / 255, top_rgb[..., 2] / 255
lum = 0.2126 * r_ + 0.7152 * g_ + 0.0722 * b_
sat = (np.max(top_rgb, axis=2) - np.min(top_rgb, axis=2)) / 255
chocolate = np.clip((0.36 - lum) / 0.14, 0, 1) * np.clip((r_ - b_ * 0.9) / 0.15, 0, 1)
salt = np.clip((lum - 0.72) / 0.15, 0, 1) * np.clip((0.25 - sat) / 0.15, 0, 1)
crumble = np.clip((lum - 0.5) / 0.15, 0, 1) * (1 - salt)


def blur(a, r):
    return np.asarray(Image.fromarray(np.uint8(np.clip(a * 255, 0, 255))).filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255


choc_h = blur(chocolate, 6) ** 0.8                              # melted chunks: soft, raised
fine = lum - blur(lum, 4)                                       # crust grain (high-pass)
height = 0.55 * choc_h + 0.18 * blur(crumble, 2) + 0.15 * blur(salt, 1.5) + 0.9 * fine
height = np.clip(height * 0.85 + 0.3, 0, 1) * inside
Image.fromarray(np.uint8(height * 255)).save(OUT / 'height.png')

# ---------------------------------------------------------------- 4. normal map (atlas)
def normals(h, strength):
    dx = np.zeros_like(h); dy = np.zeros_like(h)
    dx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    dy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    n = np.dstack([-dx * strength, dy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.uint8((n * 0.5 + 0.5) * 255)


detail_top = 0.6 * fine + 0.25 * blur(crumble, 1) + 0.2 * blur(salt, 1)
strip_l = (0.2126 * strip[..., 0] + 0.7152 * strip[..., 1] + 0.0722 * strip[..., 2]) / 255
detail_strip = strip_l - blur(strip_l, 3)
nm = np.concatenate([normals(detail_top, 14), normals(detail_strip, 10)], axis=0)
Image.fromarray(nm).save(OUT / 'normal.png')
print('maps written to', OUT, '| edge radius range', min(edge), '–', max(edge))
