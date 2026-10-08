import math, random, sys
# Usage: python3 tools/make_logo.py docs/logo.png  (also writes docs/logo_256.png -> copy to BP/RP pack_icon.png)
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
W = H = 1024
random.seed(7)
img = Image.new("RGBA", (W, H))
d = ImageDraw.Draw(img)

# --- sky: vertical gradient night -> sunset ---
top, mid, bot = (18, 20, 48), (88, 44, 96), (255, 140, 60)
horizon = 600
for y in range(H):
    if y < horizon:
        t = y / horizon
        a, b = (top, mid) if t < 0.6 else (mid, bot)
        tt = t / 0.6 if t < 0.6 else (t - 0.6) / 0.4
    else:
        a, b, tt = (58, 92, 40), (30, 52, 22), (y - horizon) / (H - horizon)
    c = tuple(int(a[i] + (b[i] - a[i]) * tt) for i in range(3))
    d.line([(0, y), (W, y)], fill=c + (255,))

# stars
for _ in range(90):
    x, y = random.randrange(W), random.randrange(330)
    s = random.choice([3, 3, 5])
    d.rectangle([x, y, x + s, y + s], fill=(255, 255, 230, random.randrange(120, 255)))

# sun (blocky)
cx, cy, r = 512, horizon, 150
for yy in range(cy - r, cy, 8):
    for xx in range(cx - r, cx + r, 8):
        if (xx + 4 - cx) ** 2 + (yy + 4 - cy) ** 2 < r * r:
            d.rectangle([xx, yy, xx + 7, yy + 7], fill=(255, 205, 90, 255))

# blocky hills silhouette on horizon
x = 0
while x < W:
    w = random.choice([32, 48, 64])
    h = random.choice([24, 40, 56, 72, 88])
    if 380 < x < 640: h = random.choice([8, 16])
    d.rectangle([x, horizon - h, x + w, horizon], fill=(40, 30, 60, 255))
    x += w

# grass ground pixels
for _ in range(1400):
    y = random.randrange(horizon, H)
    x = random.randrange(W)
    s = 4 + int((y - horizon) / 40)
    shade = random.choice([(70, 110, 46), (48, 80, 30), (84, 124, 54)])
    d.rectangle([x, y, x + s, y + s], fill=shade + (255,))

# --- perspective railway ---
vp = (512, horizon)
def lerp(p, q, t): return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
# gravel bed
d.polygon([vp, (512 - 520, H), (512 + 520, H)], fill=(96, 88, 84, 255))
d.polygon([vp, (512 - 430, H), (512 + 430, H)], fill=(120, 110, 104, 255))
# sleepers (ties)
n = 22
for i in range(n):
    t = (i / n) ** 2.2
    t2 = ((i + 0.45) / n) ** 2.2
    if t2 > 1: break
    yl, yh = horizon + (H - horizon) * t, horizon + (H - horizon) * t2
    hw1, hw2 = 400 * t, 400 * t2
    d.polygon([(512 - hw1, yl), (512 + hw1, yl), (512 + hw2, yh), (512 - hw2, yh)], fill=(112, 70, 36, 255))
    d.line([(512 - hw2, yh), (512 + hw2, yh)], fill=(70, 42, 20, 255), width=max(1, int(6 * t2)))
# rails
for side in (-1, 1):
    for off, col in ((22, (60, 64, 76)), (0, (214, 222, 236))):
        bx = 512 + side * 270
        d.polygon([vp, (bx - 18 + off * 0, H), (bx + 18, H)], fill=col + (255,)) if off == 0 else \
            d.polygon([vp, (bx - 22, H), (bx + 26, H)], fill=col + (255,))
    # highlight
    bx = 512 + side * 270
    d.line([vp, (bx - 6, H)], fill=(255, 255, 255, 200), width=4)

# --- text helpers: blocky pixel font upscaled ---
def pixel_text(text, px_size, scale, fill, outline, shadow):
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", px_size)
    tmp = Image.new("L", (1, 1))
    bb = ImageDraw.Draw(tmp).textbbox((0, 0), text, font=font)
    w, h = bb[2] - bb[0] + 4, bb[3] - bb[1] + 4
    mask = Image.new("L", (w, h))
    md = ImageDraw.Draw(mask)
    md.fontmode = "1"  # no antialiasing -> crisp pixels
    md.text((2 - bb[0], 2 - bb[1]), text, font=font, fill=255)
    mask = mask.resize((w * scale, h * scale), Image.NEAREST)
    pad = scale * 3
    out = Image.new("RGBA", (mask.width + pad * 2, mask.height + pad * 2), (0, 0, 0, 0))
    # outline: dilate mask by one pixel-block
    big = Image.new("L", out.size)
    big.paste(mask, (pad, pad))
    ol = big.filter(ImageFilter.MaxFilter(scale * 2 + 1))
    sh = Image.new("L", out.size); sh.paste(ol, (scale, scale))
    out.paste(Image.new("RGBA", out.size, shadow), (0, 0), sh)
    out.paste(Image.new("RGBA", out.size, outline), (0, 0), ol)
    # vertical gradient fill
    grad = Image.new("RGBA", out.size)
    gd = ImageDraw.Draw(grad)
    for y in range(out.height):
        t = y / out.height
        c = tuple(int(fill[0][i] + (fill[1][i] - fill[0][i]) * t) for i in range(3))
        gd.line([(0, y), (out.width, y)], fill=c + (255,))
    out.paste(grad, (0, 0), big)
    return out

# dark banner behind title
banner = Image.new("RGBA", (W, H), (0, 0, 0, 0))
bd = ImageDraw.Draw(banner)
for y in range(0, 440):
    a = 120 if y < 340 else int(120 * (440 - y) / 100)
    bd.line([(0, y), (W, y)], fill=(10, 10, 24, a))
img = Image.alpha_composite(img, banner)

t1 = pixel_text("SMART RAIL", 22, 7, ((255, 236, 140), (240, 150, 30)), (40, 22, 8, 255), (0, 0, 0, 160))
t2 = pixel_text("BUILDER", 22, 9, ((230, 245, 255), (120, 170, 220)), (16, 24, 48, 255), (0, 0, 0, 160))
for t in (t1, t2):
    if t.width > W - 40:
        r = (W - 40) / t.width
        t.thumbnail((int(t.width * r), int(t.height * r)), Image.NEAREST)
img.alpha_composite(t1, ((W - t1.width) // 2, 60))
img.alpha_composite(t2, ((W - t2.width) // 2, 60 + t1.height - 10))

# gear badge, bottom-right
g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gdw = ImageDraw.Draw(g)
gx, gy, R = 880, 900, 92
teeth = []
for k in range(10):
    base = k * 2 * math.pi / 10
    for da, rr in ((-0.20, R * 0.74), (-0.12, R), (0.12, R), (0.20, R * 0.74)):
        teeth.append((gx + rr * math.cos(base + da), gy + rr * math.sin(base + da)))
gdw.polygon(teeth, fill=(250, 196, 60, 255), outline=(90, 56, 10, 255), width=8)
gdw.ellipse([gx - 56, gy - 56, gx + 56, gy + 56], fill=(250, 196, 60, 255), outline=(90, 56, 10, 255), width=8)
gdw.ellipse([gx - 24, gy - 24, gx + 24, gy + 24], fill=(40, 26, 10, 255))
img.alpha_composite(g)

# frame
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W - 1, H - 1], outline=(20, 16, 30, 255), width=16)
d.rectangle([16, 16, W - 17, H - 17], outline=(250, 196, 60, 255), width=6)

img.save(OUT)
img.resize((256, 256), Image.LANCZOS).save(OUT.replace(".png", "_256.png"))
