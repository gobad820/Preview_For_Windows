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


def links(path):
    """Contents page linking to pages A/B/C with explicit [pageRef /Fit] destinations."""
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(25 * mm, 280 * mm, "Contents")
    for i, label in enumerate(["Go to A", "Go to B", "Go to C"]):
        y = (260 - i * 12) * mm
        c.setFont("Helvetica", 14)
        c.drawString(25 * mm, y, label)
        c.linkRect("", f"dest{i}", (25 * mm, y - 2 * mm, 80 * mm, y + 6 * mm), relative=0, thickness=0)
    c.showPage()
    for i, label in enumerate(["Page A", "Page B", "Page C"]):
        c.bookmarkPage(f"dest{i}")
        c.setFont("Helvetica-Bold", 24)
        c.drawString(25 * mm, 280 * mm, label)
        c.showPage()
    c.save()


def links_named(src, path):
    """Same document with named destinations: /Dest names for A and B, a GoTo action for C."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (ArrayObject, DictionaryObject, NameObject, TextStringObject)
    reader = PdfReader(src)
    writer = PdfWriter(clone_from=reader)
    names = ["A", "B", "C"]
    for i, n in enumerate(names):
        writer.add_named_destination(f"chapter-{n}", i + 1)
    annots = writer.pages[0]["/Annots"]
    for i, ref in enumerate(annots):
        annot = ref.get_object()
        del annot["/Dest"]
        name = TextStringObject(f"chapter-{names[i]}")
        if i < 2:
            annot[NameObject("/Dest")] = name
        else:
            action = DictionaryObject()
            action[NameObject("/S")] = NameObject("/GoTo")
            action[NameObject("/D")] = name
            annot[NameObject("/A")] = action
    with open(path, "wb") as f:
        writer.write(f)


def restricted(src, rc4_path, aes_path):
    """Owner-password-only encryption: opens without a password, but the file is encrypted."""
    from pypdf import PdfReader, PdfWriter
    for path, algorithm in ((rc4_path, "RC4-128"), (aes_path, "AES-256")):
        w = PdfWriter(clone_from=PdfReader(src))
        w.encrypt(user_password="", owner_password="owner", algorithm=algorithm, permissions_flag=0)
        with open(path, "wb") as f:
            w.write(f)


def forms_actions(src, path):
    """Page 1 carries a chained GoTo link (to 3, then 2), a push button that goes to page 2,
    and one widget of a text field whose other widget sits on page 2."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject,
                               NameObject, NumberObject, TextStringObject)
    w = PdfWriter(clone_from=PdfReader(src))
    p1, p2, p3 = w.pages
    N = NameObject

    def rect(*v):
        return ArrayObject([FloatObject(x) for x in v])

    def goto(page, nxt=None):
        a = DictionaryObject({N("/S"): N("/GoTo"), N("/D"): ArrayObject([page.indirect_reference, N("/Fit")])})
        if nxt is not None:
            a[N("/Next")] = nxt
        return a

    helv = w._add_object(DictionaryObject({N("/Type"): N("/Font"), N("/Subtype"): N("/Type1"), N("/BaseFont"): N("/Helvetica")}))

    def ap(text):
        s = DecodedStreamObject()
        s.set_data(f"BT /Helv 10 Tf 2 5 Td ({text}) Tj ET".encode())
        s.update({N("/Type"): N("/XObject"), N("/Subtype"): N("/Form"), N("/BBox"): rect(0, 0, 160, 20),
                  N("/Resources"): DictionaryObject({N("/Font"): DictionaryObject({N("/Helv"): helv})})})
        return w._add_object(s)

    link = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Link"), N("/Rect"): rect(60, 560, 220, 580),
        N("/Border"): ArrayObject([NumberObject(0)] * 3), N("/A"): goto(p3, goto(p2))}))
    button = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Widget"), N("/FT"): N("/Btn"), N("/Ff"): NumberObject(65536),
        N("/T"): TextStringObject("go"), N("/Rect"): rect(60, 520, 220, 540), N("/P"): p1.indirect_reference,
        # An indirect action: removing it must not leave the object behind.
        N("/A"): w._add_object(goto(p2)), N("/AA"): DictionaryObject({N("/E"): goto(p2)}),
        N("/AP"): DictionaryObject({N("/N"): ap("BUTTON")})}))
    field = w._add_object(DictionaryObject({N("/FT"): N("/Tx"), N("/T"): TextStringObject("secret"),
                                            N("/V"): TextStringObject("SHARED-VALUE")}))
    w1 = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Widget"), N("/Parent"): field, N("/Rect"): rect(60, 480, 220, 500),
        N("/P"): p1.indirect_reference, N("/AP"): DictionaryObject({N("/N"): ap("PAGE1-SHOWN")})}))
    w2 = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Widget"), N("/Parent"): field, N("/Rect"): rect(60, 480, 220, 500),
        N("/P"): p2.indirect_reference, N("/AP"): DictionaryObject({N("/N"): ap("PAGE2-ONLY")})}))
    field.get_object()[N("/Kids")] = ArrayObject([w1, w2])
    p1[N("/Annots")] = ArrayObject([link, button, w1])
    p2[N("/Annots")] = ArrayObject([w2])
    w._root_object[N("/AcroForm")] = DictionaryObject({
        N("/Fields"): ArrayObject([field, button]), N("/DA"): TextStringObject("/Helv 0 Tf 0 g"),
        N("/DR"): DictionaryObject({N("/Font"): DictionaryObject({N("/Helv"): helv})})})
    with open(path, "wb") as f:
        w.write(f)


def rotated(path):
    """Page 1 has /Rotate 90 (shown landscape, text running down the screen); page 2 is upright."""
    c = canvas.Canvas(path, pagesize=A4)
    c.setPageRotation(90)
    body(c, ["Rotated page one", "The quick brown fox jumps over the lazy dog."])
    c.showPage()
    c.setPageRotation(0)
    body(c, ["Upright page two", "Pack my box with five dozen liquor jugs."])
    c.showPage()
    c.save()


def annotated(src, path):
    """Page 1 carries annotations made by another application: a highlight with its own
    appearance stream, a sticky note with a popup, and a reply to that note (/IRT)."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject,
                               NameObject, NumberObject, TextStringObject)
    w = PdfWriter(clone_from=PdfReader(src))
    p1 = w.pages[0]
    N = NameObject

    def nums(*v):
        return ArrayObject([FloatObject(x) for x in v])

    gs = DictionaryObject({N("/Type"): N("/ExtGState"), N("/BM"): N("/Multiply"), N("/ca"): FloatObject(1)})
    hl_ap = DecodedStreamObject()
    hl_ap.set_data(b"/G0 gs 1 0.9 0 rg 70 740 m 200 740 l 200 758 l 70 758 l h f")
    hl_ap.update({N("/Type"): N("/XObject"), N("/Subtype"): N("/Form"), N("/BBox"): nums(70, 740, 200, 758),
                  N("/Resources"): DictionaryObject({N("/ExtGState"): DictionaryObject({N("/G0"): gs})})})
    highlight = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Highlight"), N("/Rect"): nums(70, 740, 200, 758),
        N("/QuadPoints"): nums(70, 758, 200, 758, 70, 740, 200, 740), N("/C"): nums(1, 0.9, 0),
        N("/T"): TextStringObject("Acrobat User"), N("/Contents"): TextStringObject("foreign highlight"),
        N("/NM"): TextStringObject("foreign-hl-1"), N("/F"): NumberObject(4),
        N("/AP"): DictionaryObject({N("/N"): w._add_object(hl_ap)})}))
    note = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Text"), N("/Rect"): nums(400, 700, 420, 720),
        N("/Name"): N("/Comment"), N("/T"): TextStringObject("Acrobat User"),
        N("/Contents"): TextStringObject("foreign note"), N("/NM"): TextStringObject("foreign-note-1"),
        N("/F"): NumberObject(28), N("/C"): nums(1, 0.82, 0)}))
    popup = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Popup"), N("/Rect"): nums(420, 620, 580, 720),
        N("/Parent"): note, N("/Open"): FloatObject(0), N("/F"): NumberObject(28)}))
    note.get_object()[N("/Popup")] = popup
    reply = w._add_object(DictionaryObject({
        N("/Type"): N("/Annot"), N("/Subtype"): N("/Text"), N("/Rect"): nums(400, 700, 420, 720),
        N("/IRT"): note, N("/T"): TextStringObject("Reviewer"), N("/Contents"): TextStringObject("foreign reply"),
        N("/NM"): TextStringObject("foreign-reply-1"), N("/F"): NumberObject(28)}))
    p1[N("/Annots")] = ArrayObject([highlight, note, popup, reply])
    with open(path, "wb") as f:
        w.write(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default=None, help="TTF with Korean glyphs to embed")
    ap.add_argument("--only", default=None, help="comma-separated fixture names to (re)generate, e.g. rotated,annotated")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if args.only:
        jobs = {
            "rotated": lambda: rotated(os.path.join(OUT, "rotated.pdf")),
            "annotated": lambda: annotated(os.path.join(OUT, "simple.pdf"), os.path.join(OUT, "annotated.pdf")),
        }
        for name in args.only.split(","):
            jobs[name]()
            print(f"{name}.pdf\t{os.path.getsize(os.path.join(OUT, name + '.pdf'))} bytes")
        return
    simple(os.path.join(OUT, "simple.pdf"))
    mixed(os.path.join(OUT, "mixed.pdf"))
    long300(os.path.join(OUT, "long300.pdf"))
    outline(os.path.join(OUT, "outline.pdf"))
    encrypted(os.path.join(OUT, "encrypted.pdf"))
    broken(os.path.join(OUT, "broken.pdf"))
    korean(os.path.join(OUT, "한글 문서.pdf"), args.font)
    links(os.path.join(OUT, "links.pdf"))
    links_named(os.path.join(OUT, "links.pdf"), os.path.join(OUT, "links-named.pdf"))
    restricted(os.path.join(OUT, "simple.pdf"), os.path.join(OUT, "restricted-rc4.pdf"), os.path.join(OUT, "restricted-aes.pdf"))
    forms_actions(os.path.join(OUT, "simple.pdf"), os.path.join(OUT, "forms-actions.pdf"))
    rotated(os.path.join(OUT, "rotated.pdf"))
    annotated(os.path.join(OUT, "simple.pdf"), os.path.join(OUT, "annotated.pdf"))
    for name in sorted(os.listdir(OUT)):
        print(f"{name}\t{os.path.getsize(os.path.join(OUT, name))} bytes")


if __name__ == "__main__":
    main()
