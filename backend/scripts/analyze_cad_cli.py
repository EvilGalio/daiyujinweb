"""Analyze STEP/IGES files via OCC in an isolated subprocess."""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.cad_analyzer import analyze_cad_file


def main() -> int:
    if len(sys.argv) not in (3, 4):
        json.dump(
            {
                "success": False,
                "data": None,
                "warnings": [],
                "error": "usage: analyze_cad_cli.py <cad-file> <thumbnail-dir> [site]",
            },
            sys.stdout,
        )
        return 2

    cad_file = Path(sys.argv[1])
    thumbnail_dir = Path(sys.argv[2])
    site = sys.argv[3] if len(sys.argv) == 4 else "default"
    result = analyze_cad_file(cad_file, thumbnail_dir, site=site)
    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
