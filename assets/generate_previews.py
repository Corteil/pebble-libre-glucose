#!/usr/bin/env python3
"""Render preview/store images of the Libre Glucose watchface.

Mirrors the layout constants in src/c/main.c. Store screenshots must be
native size (144x168 rect, 180x180 chalk); the README/settings preview is
rendered at 2x for crispness. These are mock-ups — for the store listing,
real captures via `pebble screenshot --emulator <platform>` are preferred.

Requires Pillow and DejaVu fonts:  pip install pillow
"""
import os

from PIL import Image, ImageDraw, ImageFont

DEJAVU = "/usr/share/fonts/truetype/dejavu/"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

GREEN = (0, 255, 0)
WHITE = (255, 255, 255)
DARKGRAY = (85, 85, 85)

GRAPH_VALUES = [
    112, 108, 104, 100, 98, 96, 96, 98, 102, 110, 124, 142,
    158, 168, 172, 168, 158, 146, 134, 124, 116, 110, 106, 102,
    100, 98, 96, 96, 94, 94, 96, 100, 108, 120, 134, 146,
    152, 150, 144, 136, 128, 120, 114, 110, 106, 104, 102, 100,
]


def render(platform, scale):
    round_ = platform == "chalk"
    color = platform in ("basalt", "chalk")
    w1, h1 = (180, 180) if round_ else (144, 168)
    S = scale
    W, H = w1 * S, h1 * S

    fg = GREEN if color else WHITE
    guide = DARKGRAY if color else WHITE

    font_time = ImageFont.truetype(DEJAVU + "DejaVuSans-Bold.ttf", 40 * S)
    font_date = ImageFont.truetype(DEJAVU + "DejaVuSans.ttf", 15 * S)
    font_gluc = ImageFont.truetype(DEJAVU + "DejaVuSans-Bold.ttf", 32 * S)
    font_info = ImageFont.truetype(DEJAVU + "DejaVuSans.ttf", 14 * S)

    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)

    def center_text(y, text, font, fill):
        bbox = d.textbbox((0, 0), text, font=font)
        d.text(((W - (bbox[2] - bbox[0])) // 2 - bbox[0], y), text,
               font=font, fill=fill)

    # Layout constants from main.c (PBL_IF_ROUND_ELSE)
    y_time = 4 if round_ else 0
    y_date = 52 if round_ else 40
    y_gluc = 70 if round_ else 58
    y_info = 109 if round_ else 97
    y_graph = 130 if round_ else 118
    graph_inset = 26 if round_ else 2

    center_text(y_time * S, "21:47", font_time, WHITE)
    center_text(y_date * S, "Sun 2 Aug", font_date, WHITE)

    gluc = "5.6"
    bbox = d.textbbox((0, 0), gluc, font=font_gluc)
    gx = (w1 // 2 + 30) * S - (bbox[2] - bbox[0]) - 4 * S
    d.text((gx - bbox[0], y_gluc * S), gluc, font=font_gluc, fill=fg)

    # Steady (horizontal) trend arrow, centre of 30x30 box at (w/2+34, y_gluc+6)
    cx, cy = (w1 // 2 + 49) * S, (y_gluc + 19) * S
    ln, hd, lw = 9 * S, 5 * S, 3 * S
    d.line([(cx - ln, cy), (cx + ln, cy)], fill=fg, width=lw)
    d.line([(cx + ln, cy), (cx + ln - hd, cy - hd)], fill=fg, width=lw)
    d.line([(cx + ln, cy), (cx + ln - hd, cy + hd)], fill=fg, width=lw)

    center_text(y_info * S, "+0.1  3m ago", font_info, WHITE)

    gx0, gy0 = graph_inset * S, y_graph * S
    gw, gh = (w1 - graph_inset * 2) * S, (h1 - y_graph - 2) * S
    display_min, display_max = 40, 220

    def mgdl_to_y(mgdl):
        mgdl = max(display_min, min(display_max, mgdl))
        return gy0 + gh - 1 - (mgdl - display_min) * (gh - 1) // (
            display_max - display_min)

    for thr in (72, 180):
        y = mgdl_to_y(thr)
        x = gx0
        while x < gx0 + gw:
            d.line([(x, y), (x + 2 * S, y)], fill=guide, width=S)
            x += 5 * S

    pts = []
    for i, v in enumerate(GRAPH_VALUES):
        x = gx0 + (gw - 1) * i // (len(GRAPH_VALUES) - 1)
        pts.append((x, mgdl_to_y(v)))
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=fg, width=S)
    for p in pts:
        d.rectangle([p[0] - S, p[1] - S, p[0] + S - 1, p[1] + S - 1], fill=fg)

    if round_:
        # Mask to the circular display
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, W - 1, H - 1], fill=255)
        black = Image.new("RGB", (W, H), (0, 0, 0))
        img = Image.composite(img, black, mask)

    return img


def save(img, *path):
    out = os.path.join(OUT_DIR, *path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    print(out, img.size)


if __name__ == "__main__":
    # 2x preview for README + settings page
    save(render("basalt", 2), "preview-basalt.png")
    # Native-size store screenshots (one per platform; aplite/diorite are B&W)
    save(render("basalt", 1), "store", "basalt.png")
    save(render("aplite", 1), "store", "aplite.png")
    save(render("diorite", 1), "store", "diorite.png")
    save(render("chalk", 1), "store", "chalk.png")
