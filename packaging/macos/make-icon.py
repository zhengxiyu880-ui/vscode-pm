#!/usr/bin/env python3
"""生成 app 图标（1024 PNG + .icns）。

只依赖 Pillow：python3 -m pip install pillow
用法：python3 packaging/macos/make-icon.py
产物：packaging/macos/AppIcon.icns（构建脚本会把它拷进 .app）
"""

from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
S = 1024
BG_TOP = (38, 43, 51)
BG_BOTTOM = (18, 21, 26)
COL = (79, 156, 249)          # 与 app 里的强调色一致
COL_DIM = (72, 80, 92)
TASK = (58, 66, 78)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角底（macOS 图标形状的近似）
radius = 224
bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
for y in range(S):
    t = y / (S - 1)
    color = tuple(int(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3)) + (255,)
    bd.line([(0, y), (S, y)], fill=color)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
img.paste(bg, (0, 0), mask)

d = ImageDraw.Draw(img)

# 看板：3 列轨道，卡片数量 3 / 2 / 1，第一列是强调色
MARGIN = 128
COL_W = 216
GAP = 60
TRACK_TOP = 192
TRACK_BOTTOM = 832
CARD_INSET = 16
CARD_H = 104
CARD_GAP = 28
CARD_RADIUS = 26
TRACK_RADIUS = 44

CARDS = [3, 2, 1]
for c in range(3):
    x0 = MARGIN + c * (COL_W + GAP)
    x1 = x0 + COL_W
    d.rounded_rectangle(
        [x0, TRACK_TOP, x1, TRACK_BOTTOM],
        radius=TRACK_RADIUS,
        fill=(44, 49, 58, 255),
    )
    # 列顶部的小标题点
    dot_y = TRACK_TOP + 34
    dot_color = COL if c == 0 else COL_DIM
    d.rounded_rectangle(
        [x0 + CARD_INSET, dot_y, x1 - CARD_INSET, dot_y + 10],
        radius=5,
        fill=dot_color + (255,),
    )
    for r in range(CARDS[c]):
        y0 = TRACK_TOP + 72 + r * (CARD_H + CARD_GAP)
        y1 = y0 + CARD_H
        fill = COL if c == 0 else (108, 118, 134)
        d.rounded_rectangle(
            [x0 + CARD_INSET, y0, x1 - CARD_INSET, y1],
            radius=CARD_RADIUS,
            fill=fill + (255,),
        )

# 描边，让图标在深色 Dock 上也有边界
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, outline=(70, 78, 92, 90), width=6)

png = HERE / "icon-1024.png"
img.save(png)

# 生成 iconset 再转 icns
iconset = HERE / "AppIcon.iconset"
if iconset.exists():
    for f in iconset.iterdir():
        f.unlink()
    iconset.rmdir()
iconset.mkdir()

SPECS = [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]
for size, name in SPECS:
    img.resize((size, size), Image.LANCZOS).save(iconset / name)

print("iconset:", iconset)
print("png    :", png)
