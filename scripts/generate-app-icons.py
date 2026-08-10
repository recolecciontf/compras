from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

LOGO_BASE64 = (
    "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"
    "23sAAAAASUVORK5CYII="
)

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
BRAND_GRAY = "#575756"
BRAND_YELLOW = "#FCEA10"
BRAND_ORANGE = "#F39200"
BRAND_RED = "#E94E1B"
BRAND_GREEN = "#7CB340"


def font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def create_icon(size: int) -> Image.Image:
    scale = size / 512
    canvas = Image.new("RGBA", (size, size), "white")
    draw = ImageDraw.Draw(canvas)

    band = max(5, round(14 * scale))
    segment = size // 4
    colors = [BRAND_YELLOW, BRAND_ORANGE, BRAND_RED, BRAND_GREEN]
    for index, color in enumerate(colors):
        left = index * segment
        right = size if index == 3 else (index + 1) * segment
        draw.rectangle((left, 0, right, band), fill=color)

    logo = Image.open(io.BytesIO(base64.b64decode(LOGO_BASE64))).convert("RGBA")
    logo_width = round(size * 0.76)
    logo_height = round(logo.height * logo_width / logo.width)
    logo = logo.resize((logo_width, logo_height), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, ((size - logo_width) // 2, round(size * 0.23)))

    label_font = font(round(size * 0.105))
    label = "COMPRAS"
    box = draw.textbbox((0, 0), label, font=label_font)
    label_width = box[2] - box[0]
    draw.text(((size - label_width) / 2, round(size * 0.60)), label, font=label_font, fill=BRAND_GRAY)

    dot_y = round(size * 0.78)
    dot_radius = max(3, round(size * 0.012))
    gap = round(size * 0.075)
    center = size // 2
    for offset, color in zip((-gap, 0, gap), (BRAND_YELLOW, BRAND_ORANGE, BRAND_GREEN)):
        draw.ellipse(
            (center + offset - dot_radius, dot_y - dot_radius, center + offset + dot_radius, dot_y + dot_radius),
            fill=color,
        )

    return canvas.convert("RGB")


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    create_icon(512).save(PUBLIC / "app-icon-512.png", optimize=True)
    create_icon(192).save(PUBLIC / "app-icon-192.png", optimize=True)
    create_icon(180).save(PUBLIC / "apple-touch-icon.png", optimize=True)


if __name__ == "__main__":
    main()

