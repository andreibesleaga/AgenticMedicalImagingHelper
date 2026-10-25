#!/usr/bin/env python3
"""Rebuild the website's social preview card, site/img/og.png (1200 x 630).

The card shows the project name, one line on what it is, the system context
diagram (docs/context.png) and the research-only notice. Run it from the
repository root after changing any of them:

    python3 scripts/make-og-image.py

Needs Pillow and the DejaVu Sans fonts (Debian/Ubuntu: fonts-dejavu-core).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DIAGRAM = ROOT / "docs" / "context.png"
OUT = ROOT / "site" / "img" / "og.png"
FONTS = Path("/usr/share/fonts/truetype/dejavu")

WIDTH, HEIGHT = 1200, 630
MARGIN = 50
INK, MUTED, ACCENT, WARN = "#1f2937", "#5b6472", "#1d4ed8", "#b91c1c"

TITLE = "Agentic Medical Imaging Helper"
SUBTITLE = "Agentic multimodal analysis of medical image series, with governance. Open source."
NOTICE = "Research and education only. Not a medical device. Never for decisions about a real patient."


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def paste_diagram(card: Image.Image, top: int, bottom: int) -> None:
    """Scale the diagram to the free band between top and bottom, centred."""
    diagram = Image.open(DIAGRAM).convert("RGB")
    box_w, box_h = WIDTH - 2 * MARGIN, bottom - top
    scale = min(box_w / diagram.width, box_h / diagram.height)
    size = (round(diagram.width * scale), round(diagram.height * scale))
    diagram = diagram.resize(size, Image.LANCZOS)
    card.paste(diagram, ((WIDTH - size[0]) // 2, top + (box_h - size[1]) // 2))


def main() -> None:
    card = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(card)
    draw.rectangle([0, 0, 11, HEIGHT], fill=ACCENT)
    draw.text((MARGIN, 40), TITLE, font=font("DejaVuSans-Bold.ttf", 54), fill=INK)
    draw.text((MARGIN, 115), SUBTITLE, font=font("DejaVuSans.ttf", 26), fill=MUTED)
    paste_diagram(card, top=170, bottom=525)
    notice_font = font("DejaVuSans.ttf", 22)
    draw.rectangle([MARGIN, 548, WIDTH - MARGIN, 598], outline=WARN, width=3)
    draw.text((MARGIN + 18, 560), NOTICE, font=notice_font, fill=WARN)
    card.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({WIDTH} x {HEIGHT})")


if __name__ == "__main__":
    main()
