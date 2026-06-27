"""Watermark test v2 — full-image difference + 3x3 grid coverage."""
import shutil
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
from services.preview_watermark import apply_preview_watermark

PASS = 0
FAIL = 0

def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \u2713 {name}")
    else:
        FAIL += 1; print(f"  \u2717 {name}  {detail}")

# ─── Test 1: synthetic image ───────────────────
print("1. Synthetic test image")
img = Image.new("RGB", (800, 600), "#f2f2f5")
draw = ImageDraw.Draw(img)
draw.rectangle([150, 100, 650, 500], fill="#c8cdd4", outline="#aaa")
draw.rectangle([200, 160, 300, 440], fill="#b0b5bd")
draw.rectangle([500, 200, 580, 400], fill="#a8adb5")
draw.text((320, 290), "Test Part", fill="#666")
test_path = Path("D:/myfirstgithubcode/daiyujinweb/backend/static/thumbnails/_wm_test.png")
test_path.parent.mkdir(parents=True, exist_ok=True)
img.save(test_path)

orig_path = test_path.with_suffix(".orig_test.png")
shutil.copy(test_path, orig_path)

original_img = Image.open(orig_path)
original_img.load()
original = original_img.convert("RGB")

before_hash = test_path.read_bytes()

ok = apply_preview_watermark(test_path)
check("function returns True", ok)
check("file still exists", test_path.exists())
check("file was modified", test_path.read_bytes() != before_hash)
check("file byte content changed", test_path.read_bytes() != before_hash)

after_img = Image.open(test_path)
after_img.load()
after_img = after_img.convert("RGB")
diff = ImageChops.difference(original, after_img)
diff_px = list(diff.getdata())
changed = sum(1 for p in diff_px if p != (0, 0, 0))
total = len(diff_px)
pct = 100 * changed / total

check("difference pixels in range 0.1%-20%", 0.1 <= pct <= 20, f"{pct:.2f}%")

# 3x3 grid coverage
w, h = after_img.size
gw, gh = w // 3, h // 3
grid_hits = 0
for gy in range(3):
    for gx in range(3):
        x0, y0 = gx * gw, gy * gh
        x1, y1 = min(x0 + gw, w), min(y0 + gh, h)
        zone = diff.crop((x0, y0, x1, y1))
        zone_px = list(zone.getdata())
        zone_changed = sum(1 for p in zone_px if p != (0, 0, 0))
        if zone_changed > 0:
            grid_hits += 1
check("at least 5 of 9 grids have changes", grid_hits >= 5, f"{grid_hits}/9")

test_path.unlink()
orig_path.unlink(missing_ok=True)

# ─── Test 2: real STEP thumbnail ───────────────
print("\n2. Real STEP thumbnail")
thumb_dir = BACKEND_ROOT / "static" / "thumbnails"
thumbs = sorted([
    t for t in thumb_dir.glob("*.png")
    if not t.name.startswith("_") and "_debug_tmp" not in t.name
])
if thumbs:
    real = thumbs[0]
    print(f"  Testing: {real.name}")
    real_copy = real.with_name(f"_wm_real_copy_{real.name}")
    shutil.copy(real, real_copy)
    before_hash = real_copy.read_bytes()
    ok = apply_preview_watermark(real_copy)
    check("real thumbnail watermark applied", ok, f"file: {real.name}")
    check("real copy modified", real_copy.read_bytes() != before_hash)
    real_copy.unlink(missing_ok=True)
else:
    print("  SKIP - no real thumbnails found")

# ─── Summary ───────────────────────────────────
print(f"\n{'='*40}")
print(f"Results: {PASS} passed, {FAIL} failed")
if FAIL:
    sys.exit(1)
