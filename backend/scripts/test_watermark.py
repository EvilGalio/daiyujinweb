"""Verify STEP preview watermark is applied after upload."""
import json, urllib.request, os, sys
from pathlib import Path

BASE = "http://127.0.0.1:5000"

# Find a test STEP file
step_files = list(Path("D:/myfirstgithubcode/daiyujinweb/backend/uploads").glob("*.stp"))
if not step_files:
    step_files = list(Path("D:/myfirstgithubcode/daiyujinweb/backend/uploads").glob("*.step"))
if not step_files:
    # Search more broadly
    for root, dirs, files in os.walk("D:/myfirstgithubcode/daiyujinweb"):
        for f in files:
            if f.lower().endswith(('.stp', '.step')):
                step_files.append(Path(root) / f)
                break
        if step_files:
            break

if not step_files:
    print("SKIP: No STEP file found for testing")
    sys.exit(0)

test_file = step_files[0]
print(f"Test file: {test_file}")

# Upload
import io
boundary = "----FormBoundary7MA4YWxkTrZu0gW"
body = io.BytesIO()
body.write(f"--{boundary}\r\n".encode())
body.write(f'Content-Disposition: form-data; name="file"; filename="{test_file.name}"\r\n'.encode())
body.write(b"Content-Type: application/octet-stream\r\n\r\n")
body.write(test_file.read_bytes())
body.write(f"\r\n--{boundary}--\r\n".encode())
body.seek(0)

req = urllib.request.Request(
    f"{BASE}/api/public/quote/upload",
    data=body.read(),
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
)
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())

print(f"Success: {result.get('success')}")
thumbnail_path = result.get("data", {}).get("thumbnail_path")
thumbnail_url = result.get("data", {}).get("thumbnail_url")
print(f"Thumbnail path: {thumbnail_path}")
print(f"Thumbnail URL: {thumbnail_url}")

if thumbnail_path and Path(thumbnail_path).exists():
    from PIL import Image
    img = Image.open(thumbnail_path)
    print(f"Image size: {img.size}")
    print(f"Image mode: {img.mode}")

    # Check if watermark exists: sample bottom-right pixels
    w, h = img.size
    # Check bottom-right corner for non-white pixels (watermark)
    pixels = []
    for y in range(h - 80, h - 20):
        for x in range(w - 300, w - 50):
            pixels.append(img.getpixel((x, y)))
    avg_brightness = sum(sum(p) for p in pixels) / (len(pixels) * 3) if pixels else 255
    print(f"Avg brightness in watermark zone: {avg_brightness:.0f}/255 (lower = watermark present)")
    if avg_brightness < 250:
        print("PASS: Watermark detected (reduced brightness in text zone)")
    else:
        print("WARN: Watermark may not be visible")
else:
    print("FAIL: No thumbnail generated")
