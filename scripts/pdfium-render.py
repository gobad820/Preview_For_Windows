#!/usr/bin/env python
"""Renders a PDF page with PDFium (the engine of Chrome and Edge) for appearance checks.

Usage: python scripts/pdfium-render.py FILE PAGE SCALE [--png OUT.png] [--probe X,Y ...]

PAGE is 0-based, SCALE is pixels per point. --probe prints "x,y r g b" for each device
pixel. Annotations are drawn from their appearance streams, as viewers do.
Requires pypdfium2 (conda env `pdftools`).
"""
import argparse

import pypdfium2 as pdfium


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("page", type=int)
    ap.add_argument("scale", type=float)
    ap.add_argument("--png")
    ap.add_argument("--probe", nargs="*", default=[])
    args = ap.parse_args()
    pdf = pdfium.PdfDocument(args.file)
    page = pdf[args.page]
    bitmap = page.render(scale=args.scale, draw_annots=True)
    image = bitmap.to_pil().convert("RGB")
    print(f"size {image.width} {image.height}")
    if args.png:
        image.save(args.png)
    for spec in args.probe:
        x, y = (int(v) for v in spec.split(","))
        r, g, b = image.getpixel((x, y))
        print(f"{x},{y} {r} {g} {b}")


if __name__ == "__main__":
    main()
