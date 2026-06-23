from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.step_analyzer import analyze_step_file


def main() -> int:
    if len(sys.argv) != 3:
        print(
            json.dumps(
                {
                    "success": False,
                    "data": None,
                    "warnings": [],
                    "error": "usage: analyze_step_cli.py <step-file> <thumbnail-dir>",
                }
            )
        )
        return 2

    step_file = Path(sys.argv[1])
    thumbnail_dir = Path(sys.argv[2])
    result = analyze_step_file(step_file, thumbnail_dir)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
