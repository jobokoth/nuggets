"""Renders the PNG app icons (letter-mark "n" on the accent blue) into public/icons."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BLUE = (63, 127, 214)        # approx oklch(0.62 0.16 250)
SURFACE = (250, 249, 246)
FONT = "C:/Windows/Fonts/arialbd.ttf"


def icon(size, *, maskable=False, bg=None):
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BLUE)
        glyph = s * 0.42  # keep inside the 80% safe zone
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.285), fill=BLUE)
        glyph = s * 0.56
    font = ImageFont.truetype(FONT, int(glyph))
    l, t, r, b = d.textbbox((0, 0), "n", font=font)
    d.text(((s - (r - l)) / 2 - l, (s - (b - t)) / 2 - t), "n", font=font, fill="white")
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192).save(OUT / "icon-192.png")
icon(512).save(OUT / "icon-512.png")
icon(512, maskable=True).save(OUT / "maskable-512.png")
icon(180, maskable=True).convert("RGB").save(OUT / "apple-touch-icon.png")
print("Icons written to", OUT)
