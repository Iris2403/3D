"""Builds theme/assets/cookie-atlas.webp (512×576): a top-down texture of the real Classic Kuki, made by
rectifying the oblique product photo (the same one the hero shows before 3D loads).
The visible top face is an ellipse; stretching it back to a circle gives a top-down view.
Pixels outside the circle are filled by repeatedly dilating the edge colours, so the 3D rim
samples real crust colour. Below the top view (rows 512–575) sits a strip made by unwrapping the
cookie's real side wall (taken from the front edge of the original photo), used for the rim.
Run: python3 scripts/build-cookie-texture.py
"""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
src = Image.open(ROOT / 'source-assets' / 'Q84IqwlizS458fY1jVkYtX9wLso.webp').convert('RGBA')
alpha = np.array(src)[:, :, 3]
rows = [(y, np.where(alpha[y] > 128)[0]) for y in range(alpha.shape[0])]
widths = [(y, r.max() - r.min(), r.min(), r.max()) for y, r in rows if len(r)]
cy, w, x0, x1 = max(widths, key=lambda t: t[1])  # widest row = centre of the top ellipse
a = w / 2
b = a * 0.635                                     # minor/major ratio measured from the silhouette
box = (int(x0), int(cy - b), int(x1), int(cy + b))
top = src.crop(box).resize((512, 512), Image.LANCZOS)  # ellipse → circle, upscaled

# Circular mask, then fill everything outside it by edge dilation.
yy, xx = np.mgrid[0:512, 0:512]
inside = ((xx - 255.5) ** 2 + (yy - 255.5) ** 2) <= (250 ** 2)
arr = np.array(top).astype(np.float32)
known = inside & (arr[:, :, 3] > 200)
rgb = arr[:, :, :3] * known[..., None]
weight = known.astype(np.float32)
for _ in range(80):
    img = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)))
    blurred = np.array(img.filter(ImageFilter.BoxBlur(2))).astype(np.float32)
    wblur = np.array(Image.fromarray(np.uint8(weight * 255)).filter(ImageFilter.BoxBlur(2))).astype(np.float32) / 255
    fill = (~known) & (wblur > 0.05)
    rgb[fill] = blurred[fill] / np.maximum(wblur[fill, None], 1e-3) * 1.0
    rgb[fill] = np.clip(rgb[fill], 0, 255)
    weight = np.maximum(weight, (wblur > 0.05).astype(np.float32))
    known = known | fill
out = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)), 'RGB')

# Side strip: the original photo shows the cookie's real side wall along its front edge. For each
# column we follow the curved bottom silhouette and take the band just above it, then mirror the
# result so it tiles seamlessly around the cookie.
orig = np.array(src.convert('RGB')).astype(np.float32)
cols = range(int(x0) + 45, int(x1) - 45)
band = 30
strip_cols = []
for x in cols:
    ys = np.where(alpha[:, x] > 128)[0]
    yb = ys.max() - 2
    strip_cols.append(orig[yb - band:yb, x])
strip = np.stack(strip_cols, axis=1)  # (band, width)
strip = np.concatenate([strip, strip[:, ::-1]], axis=1)  # mirror → seamless wrap
strip_img = Image.fromarray(np.uint8(np.clip(strip, 0, 255)), 'RGB').resize((512, 64), Image.LANCZOS)

atlas = Image.new('RGB', (512, 576))
atlas.paste(out, (0, 0))
atlas.paste(strip_img, (0, 512))
atlas.save(ROOT / 'theme' / 'assets' / 'cookie-atlas.webp', quality=88, method=6)
print('cookie-atlas.webp', atlas.size, 'from crop', box)
