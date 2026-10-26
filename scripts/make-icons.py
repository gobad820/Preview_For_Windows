"""Second half of scripts/make-icons.mjs: builds the icon files from the rasterized sizes."""
import sys

from PIL import Image

src, out = sys.argv[1], sys.argv[2]
s = {n: Image.open(f"{src}/{n}.png").convert("RGBA") for n in (16, 24, 32, 48)}
for k in (2, 4, 8, 16):
    s[32 * k] = s[32].resize((32 * k, 32 * k), Image.NEAREST)

ico = [16, 24, 32, 48, 64, 128, 256]
s[256].save(f"{out}/icon.ico", format="ICO", sizes=[(n, n) for n in ico], append_images=[s[n] for n in ico if n != 256])
s[32].save(f"{out}/32x32.png")
s[64].save(f"{out}/64x64.png")
s[128].save(f"{out}/128x128.png")
s[256].save(f"{out}/128x128@2x.png")
s[512].save(f"{out}/icon.png")
s[512].save(f"{out}/icon.icns")
for n in (30, 44, 71, 89, 107, 142, 150, 284, 310):
    s[512].resize((n, n), Image.NEAREST).save(f"{out}/Square{n}x{n}Logo.png")
s[512].resize((50, 50), Image.NEAREST).save(f"{out}/StoreLogo.png")
print("icons written to", out)
