#!/usr/bin/env python3
"""Make a small synthetic "handwritten notes" PDF for the handwriting smoke test (offline, nothing downloaded).

Each page is one grayscale image with a few lines of text drawn in a handwriting-style font that is already
on this computer (for example Ink Free or Segoe Print on Windows). There is no text layer, so the app must
recognise the page. This is NOT real handwriting: it is tidier, so real notes will read worse.

Developer tool only: needs Pillow (`pip install pillow`); the app itself never needs it.
The output is written where you say (default: the system temp folder) and should not be committed.

Usage:  python tools/make-handwriting-fixture.py [out.pdf] [--font path.ttf] [--png out.png]
"""
import argparse
import json
import os
import sys
import tempfile
import zlib

LINES = [
    "Limits and continuity",
    "A limit describes the value a function approaches.",
    "Definition: A function is continuous at c",
    "if the limit equals the value of the function.",
    "The derivative is the slope of the tangent line.",
]
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\Inkfree.ttf",
    r"C:\Windows\Fonts\segoepr.ttf",
    r"C:\Windows\Fonts\segoesc.ttf",
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/System/Library/Fonts/Noteworthy.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
]
W, H = 1240, 1754  # A4 at 150 dpi
PAGE_W, PAGE_H = 595, 842  # PDF points


def find_font(explicit):
    for path in ([explicit] if explicit else FONT_CANDIDATES):
        if path and os.path.exists(path):
            return path
    raise SystemExit("No handwriting-style font found; pass one with --font path.ttf")


def draw_page(font_path):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("L", (W, H), 255)
    draw = ImageDraw.Draw(img)
    y = 150
    for i, text in enumerate(LINES):
        font = ImageFont.truetype(font_path, 64 if i == 0 else 44)
        draw.text((110, y), text, font=font, fill=25)
        y += 170 if i == 0 else 130
    return img


def pdf_bytes(img):
    """One page, one /DeviceGray Flate image, no fonts and no text operators."""
    data = zlib.compress(img.tobytes(), 9)
    content = b"q %d 0 0 %d 0 0 cm /Im0 Do Q" % (PAGE_W, PAGE_H)
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /XObject << /Im0 4 0 R >> >> "
        b"/Contents 5 0 R >>" % (PAGE_W, PAGE_H),
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 "
        b"/Filter /FlateDecode /Length %d >>\nstream\n" % (W, H, len(data)) + data + b"\nendstream",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", nargs="?", default=os.path.join(tempfile.gettempdir(), "pdf-study-handwriting-fixture.pdf"))
    ap.add_argument("--font", help="path to a .ttf/.ttc handwriting-style font")
    ap.add_argument("--png", help="also save the page image here")
    args = ap.parse_args(argv)
    try:
        import PIL  # noqa: F401
    except ImportError:
        raise SystemExit("This developer tool needs Pillow: pip install pillow")
    font = find_font(args.font)
    img = draw_page(font)
    if args.png:
        img.save(args.png)
    with open(args.out, "wb") as fh:
        fh.write(pdf_bytes(img))
    with open(args.out + ".expected.json", "w", encoding="utf-8") as fh:
        json.dump({"font": os.path.basename(font), "lines": LINES}, fh)  # read by tools/smoke-handwriting.js
    print("font: %s" % font)
    print("expected lines:")
    for line in LINES:
        print("  " + line)
    print("wrote %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
