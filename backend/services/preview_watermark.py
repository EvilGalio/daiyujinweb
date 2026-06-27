"""Preview PNG watermark — 45° tiled pattern, standalone module."""
import logging
import os as _os
from pathlib import Path

LOGGER = logging.getLogger(__name__)


def apply_preview_watermark(png_path: Path) -> bool:
    """Apply 45° tiled watermark by rotating each text tile then pasting.

    Environment variables (optional):
      QUOTE_PREVIEW_WATERMARK         text (default "GCNOV CO., LIMITED")
      QUOTE_PREVIEW_WATERMARK_OPACITY 0–1 (default 0.12)
      QUOTE_PREVIEW_WATERMARK_ANGLE   degrees (default 45)
      QUOTE_PREVIEW_WATERMARK_SPACING multiplier (default 3.0)
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return False

    if not png_path.exists():
        return False

    try:
        img = Image.open(png_path).convert("RGBA")
        w, h = img.size
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))

        text = _os.environ.get("QUOTE_PREVIEW_WATERMARK", "GCNOV CO., LIMITED")
        opacity = float(_os.environ.get("QUOTE_PREVIEW_WATERMARK_OPACITY", "0.12"))
        angle = float(_os.environ.get("QUOTE_PREVIEW_WATERMARK_ANGLE", "45"))
        spacing_mult = float(_os.environ.get("QUOTE_PREVIEW_WATERMARK_SPACING", "3.0"))

        # OCC thumbnails are usually 3K-4K. If the font is too large, the
        # required 3x text-width spacing pushes nearly every tile off-canvas.
        font_size = max(24, int(min(w, h) * 0.026))
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except (OSError, IOError):
            try:
                font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", font_size)
            except (OSError, IOError):
                font = ImageFont.load_default()

        alpha = int(255 * opacity)

        # Measure text
        probe = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        probe_draw = ImageDraw.Draw(probe)
        bbox = probe_draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]

        # Create one transparent text tile. We rotate the tile itself and then
        # repeat it, instead of rotating the whole overlay and cropping away
        # most of the drawn text.
        pad = int(font_size * 0.65)
        tile = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
        tile_draw = ImageDraw.Draw(tile)
        tile_draw.text((pad, pad), text, font=font, fill=(38, 48, 62, alpha))

        # Rotate tile
        rotated = tile.rotate(angle, expand=True, resample=Image.BILINEAR)

        # Horizontal spacing follows the product requirement: about 3x text
        # width. Vertical spacing is independent so long watermarks still form
        # a full-screen pattern.
        step_x = max(int(tw * spacing_mult), rotated.size[0] + font_size)
        step_y = max(int(font_size * 5.5), int(rotated.size[1] * 0.45))

        row_index = 0
        for y in range(-rotated.size[1], h + rotated.size[1], step_y):
            row_offset = 0 if row_index % 2 == 0 else step_x // 2
            x_start = -(rotated.size[0] // 2) + row_offset
            for x in range(x_start, w + rotated.size[0], step_x):
                overlay.alpha_composite(rotated, (x, y))
            row_index += 1

        # Composite and save
        out = Image.alpha_composite(img, overlay).convert("RGB")
        out.save(png_path, "PNG", optimize=True)
        return True

    except Exception as exc:
        LOGGER.warning("Failed to apply preview watermark to %s: %s", png_path, exc)
        return False
