from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.step_analyzer import analyze_step_file


if __name__ == "__main__":
    readstep_root = Path(r"D:\dyj-scrapling\ReadStep")
    sample = readstep_root / "1-ID0734-G-TORNITO.STEP"
    output_dir = Path(__file__).resolve().parents[1] / "static" / "thumbnails"
    result = analyze_step_file(sample, output_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
