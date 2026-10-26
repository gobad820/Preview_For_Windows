#!/usr/bin/env python
"""Generates the PDF fixtures under tests/fixtures.

Usage: python scripts/make-fixtures.py [--font /path/to/NotoSansKR.ttf]

Requires reportlab (conda env `pdftools`). The Korean fixture embeds a subset of
the given TTF on page 1 and uses a non-embedded CID font on page 2 so both the
embedded and the CMap-based text paths are exercised.
"""
import argparse
import os
import sys

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib import pdfencrypt

OUT = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures")


def body(c, lines, y_start=270 * mm, font="Helvetica", size=12):
    c.setFont(font, size)
    y = y_start
    for line in lines:
        c.drawString(25 * mm, y, line)
        y -= 7 * mm


def simple(path):
    c = canvas.Canvas(path, pagesize=A4)
    for n in range(1, 4):
        c.setFont("Helvetica-Bold", 24)
        c.drawString(25 * mm, 280 * mm, f"Hello world page {n}")
        body(c, [
            f"This is page {n} of the simple fixture.",
            "The quick brown fox jumps over the lazy dog.",
            "Preview for Windows renders this with pdf.js.",
        ], y_start=265 * mm)
        c.showPage()
    c.save()


def mixed(path):
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont("Helvetica", 18)
    c.drawString(25 * mm, 280 * mm, "Portrait A4")
    c.showPage()
    c.setPageSize(landscape(A4))
    c.setFont("Helvetica", 18)
    c.drawString(25 * mm, 190 * mm, "Landscape A4")
    c.showPage()
    c.setPageSize((200, 200))
    c.setFont("Helvetica", 14)
    c.drawString(20, 170, "Small 200x200")
    c.showPage()
    c.save()


def long300(path):
    c = canvas.Canvas(path, pagesize=A4)
    for n in range(1, 301):
        c.setFont("Helvetica-Bold", 36)
        c.drawString(25 * mm, 270 * mm, f"Page {n} of 300")
        c.setFont("Helvetica", 11)
        c.drawString(25 * mm, 255 * mm, f"long fixture page {n}")
        c.rect(25 * mm, 40 * mm, 160 * mm, 200 * mm)
        c.showPage()
    c.save()


def outline(path):
    c = canvas.Canvas(path, pagesize=A4)
    entries = [
        ("Chapter 1", 0, None),
        ("Section 1.1", 1, "Chapter 1"),
        ("Section 1.2", 2, "Chapter 1"),
        ("Chapter 2", 3, None),
        ("Section 2.1", 4, "Chapter 2"),
        ("Appendix", 5, None),
    ]
    for i, (title, page, _parent) in enumerate(entries):
        c.setFont("Helvetica-Bold", 22)
        c.drawString(25 * mm, 280 * mm, title)
        c.setFont("Helvetica", 12)
        c.drawString(25 * mm, 265 * mm, f"Outline fixture page {page + 1}")
        c.bookmarkPage(f"p{page}")
        c.showPage()
    # Outline entries must be added after bookmarks exist; closed=False keeps them expanded.
    for title, page, parent in entries:
        level = 0 if parent is None else 1
        c.addOutlineEntry(title, f"p{page}", level=level, closed=False)
    c.showOutline()
    c.save()


def encrypted(path):
    enc = pdfencrypt.StandardEncryption("secret", canPrint=1, strength=128)
    c = canvas.Canvas(path, pagesize=A4, encrypt=enc)
    c.setFont("Helvetica", 18)
    c.drawString(25 * mm, 280 * mm, "Encrypted fixture")
    c.showPage()
    c.save()


def broken(path):
    with open(path, "w", encoding="utf-8") as f:
        f.write("This is not a PDF file.\n")


def korean(path, font_path):
    c = canvas.Canvas(path, pagesize=A4)
    if font_path and os.path.exists(font_path):
        pdfmetrics.registerFont(TTFont("KR", font_path))
        c.setFont("KR", 22)
        c.drawString(25 * mm, 280 * mm, "안녕하세요 미리보기")
        c.setFont("KR", 12)
        c.drawString(25 * mm, 265 * mm, "임베디드 글꼴 페이지 (Noto Sans KR)")
    else:
        print("warning: no TTF font given; page 1 uses the CID font too", file=sys.stderr)
        pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium"))
        c.setFont("HYSMyeongJo-Medium", 22)
        c.drawString(25 * mm, 280 * mm, "안녕하세요 미리보기")
    c.showPage()
    pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium"))
    c.setFont("HYSMyeongJo-Medium", 22)
    c.drawString(25 * mm, 280 * mm, "두 번째 페이지 미리보기")
    c.setFont("HYSMyeongJo-Medium", 12)
    c.drawString(25 * mm, 265 * mm, "비임베디드 CID 글꼴 페이지")
    c.showPage()
    c.save()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default=None, help="TTF with Korean glyphs to embed")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    simple(os.path.join(OUT, "simple.pdf"))
    mixed(os.path.join(OUT, "mixed.pdf"))
    long300(os.path.join(OUT, "long300.pdf"))
    outline(os.path.join(OUT, "outline.pdf"))
    encrypted(os.path.join(OUT, "encrypted.pdf"))
    broken(os.path.join(OUT, "broken.pdf"))
    korean(os.path.join(OUT, "한글 문서.pdf"), args.font)
    for name in sorted(os.listdir(OUT)):
        print(f"{name}\t{os.path.getsize(os.path.join(OUT, name))} bytes")


if __name__ == "__main__":
    main()
