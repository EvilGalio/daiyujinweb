"""Preview PNG watermark — 45° tiled pattern, standalone module."""
import os as _os
from pathlib import Path


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

        font_size = max(28, int(min(w, h) * 0.045))
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

        # Create tile with padding
        pad = int(font_size * 0.65)
        tile = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
        tile_draw = ImageDraw.Draw(tile)
        tile_draw.text((pad, pad), text, font=font, fill=(38, 48, 62, alpha))

        # Rotate tile
        rotated = tile.rotate(angle, expand=True, resample=Image.BILINEAR)

        # Paste rotated tile in staggered grid across full overlay
        step = max(int(tw * spacing_mult), rotated.size[0] + font_size)

        for y in range(-rotated.size[1], h + rotated.size[1], step):
            row_offset = 0 if (y // step) % 2 == 0 else step // 2
            for x in range(-rotated.size[0] - row_offset, w + rotated.size[0], step):
                overlay.alpha_composite(rotated, (x + row_offset, y))

        # Composite and save
        out = Image.alpha_composite(img, overlay).convert("RGB")
        out.save(png_path, "PNG", optimize=True)
        return True

    except Exception:
        return False
