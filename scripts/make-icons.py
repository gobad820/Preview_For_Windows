"""Builds every app icon file from the logo artwork (src-tauri/icons/source/logo.png).

Usage: python scripts/make-icons.py   (needs Pillow)

The logo is cropped to the lens (CROP), given rounded corners, and resized for each size;
sizes up to 48 px are lightly sharpened so the ring stays crisp in the taskbar.
"""
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "src-tauri", "icons", "source", "logo.png")
OUT = os.path.join(ROOT, "src-tauri", "icons")
# Square around the lens ring in the 660 x 660 artwork (left, top, right, bottom).
CROP = (50, 80, 630, 660)
# Corner radius as a fraction of the icon size.
RADIUS = 0.18


def rounded(im: Image.Image) -> Image.Image:
    big = Image.new("L", (im.width * 4, im.height * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, big.width - 1, big.height - 1), radius=RADIUS * big.width, fill=255)
    mask = big.resize(im.size, Image.LANCZOS)
    out = im.copy()
    out.putalpha(Image.composite(im.getchannel("A"), Image.new("L", im.size, 0), mask))
    return out


def size(base: Image.Image, n: int) -> Image.Image:
    im = base.resize((n, n), Image.LANCZOS)
    if n <= 48:
        im = im.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    return rounded(im)


base = Image.open(SRC).convert("RGBA").crop(CROP)
s = {n: size(base, n) for n in (16, 24, 32, 48, 64, 128, 256, 512)}
ico = [16, 24, 32, 48, 64, 128, 256]
s[256].save(f"{OUT}/icon.ico", format="ICO", sizes=[(n, n) for n in ico], append_images=[s[n] for n in ico if n != 256])
s[32].save(f"{OUT}/32x32.png")
s[64].save(f"{OUT}/64x64.png")
s[128].save(f"{OUT}/128x128.png")
s[256].save(f"{OUT}/128x128@2x.png")
s[512].save(f"{OUT}/icon.png")
s[512].save(f"{OUT}/icon.icns")
for n in (30, 44, 71, 89, 107, 142, 150, 284, 310):
    size(base, n).save(f"{OUT}/Square{n}x{n}Logo.png")
size(base, 50).save(f"{OUT}/StoreLogo.png")
print("icons written to", os.path.normpath(OUT))
