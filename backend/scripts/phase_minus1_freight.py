from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.freight_importer import find_freight_workbook, parse_freight_workbook


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parents[2]
    workbook = find_freight_workbook(project_root)
    summary = parse_freight_workbook(workbook, include_records=False)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
