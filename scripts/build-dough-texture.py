"""Builds theme/assets/cookie-dough.webp — the dough texture of the 3D hero cookie — from the real
KUKI photo (source-assets/hero-cookie-photo.jpg), so the cookie has that colour and crust texture.

1. Unwarp the oblique shot of the centre cookie into a top-down view (its top face is a rotated
   ellipse in the photo; an affine transform maps it back to a circle) — this keeps the photo's
   real scale: 1024 px = the cookie's diameter.
2. Take a clean, sharp patch of sugar-crusted dough (no chocolate) and synthesise the full texture
   from it: hundreds of randomly rotated / flipped pieces with soft round edges, splatted on a
   jittered grid. Granular surfaces like dough hide the joins completely.
3. Add gentle low-frequency tone variation (so nothing repeats visibly) and a darker, toasted
   outer ring, like the edge of a baked cookie.
Prints the texture's mean linear colour for DOUGH_M in src/modules/hero3d.ts.
Run: python3 scripts/build-dough-texture.py
"""
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'source-assets' / 'hero-cookie-photo.jpg'
OUT = ROOT / 'theme' / 'assets' / 'cookie-dough.webp'

CX, CY, A, B, ANG = 838, 882, 452, 306, -6.0  # top-face ellipse in the original photo
S = 1024
DOUGH_PATCH = (560, 262, 860, 362)            # clean sugar-crusted dough in the top view (px)
PIECE = 88                                     # splat size (px)
STEP = 44                                      # grid spacing (px)
random.seed(7)

photo = Image.open(SRC).convert('RGB')
r = math.radians(ANG)
ca, sa = math.cos(r), math.sin(r)
half = S / 2
a, b = A / half * ca, -B / half * sa
d, e = A / half * sa, B / half * ca
c, f = CX - a * half - b * half, CY - d * half - e * half
top = photo.transform((S, S), Image.AFFINE, (a, b, c, d, e, f), resample=Image.BICUBIC)
src = top.crop(DOUGH_PATCH)
sw, sh = src.size

# Soft round alpha for each splat.
yy, xx = np.mgrid[0:PIECE, 0:PIECE]
dist = np.hypot(xx - (PIECE - 1) / 2, yy - (PIECE - 1) / 2) / (PIECE / 2)
alpha = np.clip((1 - dist) / 0.45, 0, 1) ** 1.5

PAD = PIECE  # generate on a padded canvas so every border pixel is fully covered
acc = np.zeros((S + 2 * PAD, S + 2 * PAD, 3), np.float64)
wsum = np.zeros((S + 2 * PAD, S + 2 * PAD), np.float64)
for gy in range(-PAD, S + PAD, STEP):
    for gx in range(-PAD, S + PAD, STEP):
        ox = random.randint(0, sw - PIECE)
        oy = random.randint(0, sh - PIECE)
        piece = src.crop((ox, oy, ox + PIECE, oy + PIECE))
        piece = piece.rotate(random.choice([0, 90, 180, 270]) + random.uniform(-25, 25), resample=Image.BICUBIC, expand=False)
        if random.random() < 0.5:
            piece = piece.transpose(Image.FLIP_LEFT_RIGHT)
        p = np.asarray(piece).astype(np.float64)
        jx = min(max(gx + random.randint(-STEP // 3, STEP // 3) + PAD // 2, 0), S + PAD)
        jy = min(max(gy + random.randint(-STEP // 3, STEP // 3) + PAD // 2, 0), S + PAD)
        w = alpha * random.uniform(0.7, 1.0)
        acc[jy:jy + PIECE, jx:jx + PIECE] += p * w[..., None]
        wsum[jy:jy + PIECE, jx:jx + PIECE] += w
tex = acc[PAD:PAD + S, PAD:PAD + S] / np.maximum(wsum[PAD:PAD + S, PAD:PAD + S, None], 1e-6)

# Low-frequency tone variation + a darker toasted outer ring.
noise = np.asarray(Image.fromarray(np.uint8(np.random.default_rng(3).random((16, 16)) * 255)).resize((S, S), Image.BICUBIC)).astype(np.float64) / 255
gy, gx = np.mgrid[0:S, 0:S]
rad = np.hypot(gx - (S - 1) / 2, gy - (S - 1) / 2) / (S / 2)
toast = 1 - 0.28 * np.clip((rad - 0.72) / 0.26, 0, 1) ** 1.6
tex *= (0.88 + 0.24 * noise)[..., None] * toast[..., None]

out = Image.fromarray(np.uint8(np.clip(tex, 0, 255)), 'RGB')
out.save(OUT, quality=80, method=6)

inside = rad <= 0.98
lin = (np.asarray(out).astype(np.float64) / 255) ** 2.2
mean = lin[inside].mean(axis=0)
print('cookie-dough.webp', out.size, '| DOUGH_M (linear mean):', [round(float(v), 4) for v in mean])
