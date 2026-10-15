"""Programmatically render the AegisArena shield + neural-grid logo.

Draws at 4x supersampling for crisp edges, then downscales to a 512x512 PNG.
Writes the same asset to frontend/public/logo.png and docs/logo.png.
"""

import math
import pathlib

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
SS = 4
BASE = 512
SIZE = BASE * SS

CYAN = (34, 226, 255)
TEAL = (23, 168, 190)
MAGENTA = (255, 64, 178)
INK = (6, 10, 22)
BG_TOP = (10, 16, 34)
BG_BOTTOM = (4, 6, 14)
WHITE = (236, 250, 255)


def shield_points(scale=1.0):
    # Symmetric emblem: rounded top corners sweeping to a pointed base.
    cx = SIZE / 2
    w = (BASE * 0.62) * SS * scale
    top = (BASE * 0.10) * SS * scale
    shoulder = (BASE * 0.30) * SS * scale
    point = (BASE * 0.90) * SS * scale
    pts = [
        (cx - w / 2, top + shoulder * 0.2),
        (cx, top),
        (cx + w / 2, top + shoulder * 0.2),
        (cx + w / 2, shoulder * 2.1),
        (cx + w * 0.34, point * 0.82),
        (cx, point),
        (cx - w * 0.34, point * 0.82),
        (cx - w / 2, shoulder * 2.1),
    ]
    return pts


def draw_logo():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Rounded-square dark plate background with a subtle vertical gradient.
    plate = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pad = 6 * SS
    for y in range(SIZE):
        t = y / SIZE
        r = int(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t)
        g = int(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t)
        b = int(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t)
        pd.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, SIZE - pad, SIZE - pad], radius=64 * SS, fill=255)
    img.paste(plate, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # Faint circuit grid clipped to the plate.
    step = 30 * SS
    for x in range(pad + step, SIZE - pad, step):
        d.line([(x, pad), (x, SIZE - pad)], fill=(40, 70, 110, 60), width=1 * SS)
    for y in range(pad + step, SIZE - pad, step):
        d.line([(pad, y), (SIZE - pad, y)], fill=(40, 70, 110, 60), width=1 * SS)

    # Glow layer for the shield outline.
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.polygon(shield_points(), outline=CYAN, width=10 * SS)
    glow = glow.filter(ImageFilter.GaussianBlur(6 * SS))
    img.alpha_composite(glow)

    # Shield body (dark translucent) + crisp outline.
    body = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.polygon(shield_points(), fill=(12, 30, 46, 200))
    bd.line(shield_points() + [shield_points()[0]], fill=CYAN, width=5 * SS, joint="curve")
    img.alpha_composite(body)

    # Neural graph inside the shield.
    cx = SIZE / 2
    cy = SIZE * 0.50
    nodes = [
        (cx, cy - 90 * SS),
        (cx - 95 * SS, cy - 20 * SS),
        (cx + 95 * SS, cy - 20 * SS),
        (cx - 55 * SS, cy + 70 * SS),
        (cx + 55 * SS, cy + 70 * SS),
        (cx, cy + 10 * SS),
        (cx, cy + 120 * SS),
    ]
    edges = [(0, 1), (0, 2), (1, 5), (2, 5), (5, 3), (5, 4), (3, 6), (4, 6), (1, 3), (2, 4)]
    for a, b in edges:
        highlight = (a == 5 or b == 5)
        col = MAGENTA if highlight else TEAL
        d.line([nodes[a], nodes[b]], fill=col + (230,), width=(4 if highlight else 3) * SS)
    for i, (x, y) in enumerate(nodes):
        r = (13 if i == 5 else 9) * SS
        col = MAGENTA if i == 5 else CYAN
        d.ellipse([x - r, y - r, x + r, y + r], fill=INK, outline=col, width=4 * SS)
        d.ellipse([x - r * 0.35, y - r * 0.35, x + r * 0.35, y + r * 0.35], fill=col + (255,))

    # Aegis "A" chevron accent under the core to hint at the arena initial.
    d.line([(cx - 30 * SS, cy + 150 * SS), (cx, cy + 118 * SS), (cx + 30 * SS, cy + 150 * SS)],
           fill=WHITE + (235,), width=6 * SS, joint="curve")

    # Corner ticks for an esports targeting frame.
    tl = pad + 18 * SS
    tr = SIZE - pad - 18 * SS
    d.line([(tl, tl - 30 * SS), (tl, tl), (tl + 30 * SS, tl)], fill=CYAN + (200,), width=4 * SS)
    d.line([(tr - 30 * SS, tl), (tr, tl), (tr, tl - 30 * SS)], fill=CYAN + (200,), width=4 * SS)
    bl = SIZE - pad - 18 * SS
    d.line([(tl, bl + 30 * SS), (tl, bl), (tl + 30 * SS, bl)], fill=CYAN + (200,), width=4 * SS)
    d.line([(tr - 30 * SS, bl), (tr, bl), (tr, bl + 30 * SS)], fill=CYAN + (200,), width=4 * SS)

    final = img.resize((BASE, BASE), Image.LANCZOS)
    return final


def main():
    logo = draw_logo()
    targets = [
        ROOT / "frontend" / "public" / "logo.png",
        ROOT / "docs" / "logo.png",
    ]
    for path in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        logo.save(path, format="PNG", optimize=True)
        kb = path.stat().st_size / 1024
        print(f"wrote {path} ({kb:.1f} KB)")
    assert targets[0].stat().st_size < 500 * 1024, "logo must be under 500 KB"


if __name__ == "__main__":
    main()
