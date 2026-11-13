#!/usr/bin/env python3
"""Draw synthetic "scanned textbook" pages with known text for tools/eval-handwriting.js (offline).

Three printed pages are written to the output folder as JPEG images, with TRANSCRIPTS.json beside them:
  printed-01-single-column.jpg   running head, heading, three paragraphs, page number (serif)
  printed-02-two-columns.jpg     title across the page, two columns of small serif text
  printed-03-notes-table.jpg     sans-serif handout: bullets, numbered steps, a ruled three-column table
Each page is turned a fraction of a degree, blurred, given paper tone and grain, and saved as a lossy JPEG,
so it looks like a flatbed scan rather than a clean render. The text is drawn with fonts already on this
computer; nothing is downloaded. The transcript lists the lines in reading order (left column, then right).

Developer tool only: needs Pillow. Keep the output in a git-ignored folder (for example under vendor/hw/).
Usage:  python tools/make-scan-fixtures.py <out-folder> [--clean]     (--clean: no scan damage)
"""
import json
import os
import random
import sys

W, H = 1700, 2200  # US letter at 200 dpi
PT = 200 / 72.0
SERIF = [r"C:\Windows\Fonts\times.ttf", "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"]
SERIF_BOLD = [r"C:\Windows\Fonts\timesbd.ttf", "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"]
SANS = [r"C:\Windows\Fonts\arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
SANS_BOLD = [r"C:\Windows\Fonts\arialbd.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]

CELLS = [
    "Every living thing is built from cells. A cell is the smallest unit that can carry out the work of "
    "life: it takes in food, releases energy, removes waste and makes copies of itself. Some organisms are "
    "a single cell, while a person is made of many trillions of them working together.",
    "A thin membrane surrounds each cell and controls what enters and leaves. Inside, the cytoplasm holds "
    "small structures called organelles. The nucleus stores the genetic material and directs most of the "
    "activity of the cell. Mitochondria release the energy stored in sugar, and ribosomes build proteins "
    "from the instructions they receive.",
    "Plant cells have three features that animal cells lack. A rigid wall outside the membrane gives the "
    "plant its shape. Chloroplasts capture light and use it to make sugar from water and carbon dioxide. "
    "A large central vacuole stores water and keeps the cell firm, which is why a plant wilts when the "
    "soil dries out.",
]
ROCKS = [
    "Rocks are sorted into three families by the way they form. Igneous rock hardens from melted material. "
    "When the melt cools slowly below the surface the crystals grow large, as in granite. When lava cools "
    "quickly at the surface the crystals stay small, as in basalt.",
    "Sedimentary rock forms from layers of sand, mud and shells that settle in water and are pressed "
    "together over a long time. Sandstone and limestone are common examples, and most fossils are found "
    "in rock of this kind.",
    "Metamorphic rock begins as one of the other two kinds and is changed by heat and pressure deep in the "
    "crust without melting. Limestone becomes marble and shale becomes slate. The mineral grains often "
    "line up in bands that record the direction of the pressure.",
    "These families are linked in a cycle. Wind and rain break any rock into grains that may become "
    "sediment. Burial can turn sediment into metamorphic rock, and enough heat melts it so that new "
    "igneous rock can form. No stage is final, and the cycle has no fixed order.",
]
BULLETS = ["Speed tells how fast an object moves.", "Velocity is speed in a stated direction.",
           "Acceleration is the rate of change of velocity.", "A force is a push or a pull on an object."]
STEPS = ["Write down the known values with their units.", "Choose the equation that links them.",
         "Solve for the unknown and check the units."]
TABLE = [("Quantity", "Symbol", "Unit"), ("Distance", "d", "metre"), ("Time", "t", "second"),
         ("Force", "F", "newton"), ("Energy", "E", "joule")]


def font(paths, pt):
    from PIL import ImageFont
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, int(round(pt * PT)))
    raise SystemExit("no usable font found: " + ", ".join(paths))


def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if cur and draw.textlength(trial, font=fnt) > width:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    return lines + ([cur] if cur else [])


class Page:
    def __init__(self):
        from PIL import Image, ImageDraw
        self.img = Image.new("L", (W, H), 255)
        self.draw = ImageDraw.Draw(self.img)
        self.lines = []

    def text(self, x, y, s, fnt, record=True):
        self.draw.text((x, y), s, font=fnt, fill=20)
        if record:
            self.lines.append(s)

    def block(self, x, y, paragraphs, fnt, width, leading, gap):
        for para in paragraphs:
            for line in wrap(self.draw, para, fnt, width):
                self.text(x, y, line, fnt)
                y += leading
            y += gap
        return y


def single_column():
    p = Page()
    small, head, body = font(SERIF, 9), font(SERIF_BOLD, 16), font(SERIF, 11)
    p.text(200, 130, "42", small, record=False)
    p.text(1100, 130, "Chapter 3 Cells and Tissues", small, record=False)
    p.lines.append("42 Chapter 3 Cells and Tissues")
    p.text(200, 260, "The Structure of a Cell", head)
    p.block(200, 360, CELLS, body, 1300, 42, 26)
    p.text(830, 2050, "42", small)
    return p


def two_columns():
    p = Page()
    head, body = font(SERIF_BOLD, 15), font(SERIF, 10)
    p.text(180, 200, "Three Families of Rock", head)
    p.block(180, 300, ROCKS[:2], body, 630, 38, 22)
    p.block(890, 300, ROCKS[2:], body, 630, 38, 22)
    return p


def notes_table():
    p = Page()
    head, sub, body = font(SANS_BOLD, 15), font(SANS_BOLD, 11), font(SANS, 11)
    p.text(200, 200, "Motion and Force: Key Ideas", head)
    y = 320
    for b in BULLETS:
        p.draw.ellipse((212, y + 12, 222, y + 22), fill=20)
        p.text(250, y, b, body)
        y += 50
    y += 30
    p.text(200, y, "Solving a problem", sub)
    y += 60
    for i, s in enumerate(STEPS):
        p.text(200, y, f"{i + 1}. {s}", body)
        y += 50
    y += 50
    xs = (200, 640, 960, 1300)
    top = y
    for r, row in enumerate(TABLE):
        for c, cell in enumerate(row):
            p.text(xs[c] + 24, y + 12, cell, sub if r == 0 else body, record=False)
        p.lines.append(" ".join(row))
        y += 62
    for k in range(len(TABLE) + 1):
        p.draw.line((xs[0], top + 62 * k, xs[3], top + 62 * k), fill=40, width=2)
    for x in xs:
        p.draw.line((x, top, x, y), fill=40, width=2)
    return p


def scan(img, seed):
    """Flatbed-scan look: slight turn, soft focus, paper tone, grain."""
    from PIL import Image, ImageFilter
    rnd = random.Random(seed)
    out = img.rotate(rnd.choice((-0.35, 0.3, 0.4)), resample=Image.BICUBIC, fillcolor=255)
    out = out.filter(ImageFilter.GaussianBlur(0.8))
    out = out.point(lambda v: int(28 + v * (236 - 28) / 255))
    grain = Image.frombytes("L", (W, H), bytes(rnd.randrange(0, 256) for _ in range(W * H)))
    return Image.blend(out, grain, 0.035)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    try:
        import PIL  # noqa: F401
    except ImportError:
        raise SystemExit("Pillow is not installed (pip install pillow)")
    out = args[0]
    os.makedirs(out, exist_ok=True)
    pages = (("printed-01-single-column.jpg", single_column), ("printed-02-two-columns.jpg", two_columns),
             ("printed-03-notes-table.jpg", notes_table))
    transcripts = {}
    for i, (name, make) in enumerate(pages):
        page = make()
        img = page.img if "--clean" in argv else scan(page.img, i + 1)
        img.save(os.path.join(out, name), quality=78)
        transcripts[name] = {"lines": page.lines}
        print(f"{name}: {len(page.lines)} lines")
    with open(os.path.join(out, "TRANSCRIPTS.json"), "w", encoding="utf-8") as f:
        json.dump(transcripts, f, indent=1)


if __name__ == "__main__":
    main(sys.argv)
