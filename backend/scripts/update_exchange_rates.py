from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import init_db
from services.exchange_rates import refresh_exchange_rates


def main() -> int:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] Updating exchange rates")
    init_db()
    try:
        result = refresh_exchange_rates()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print("Exchange rates updated successfully.")
        return 0
    except Exception as exc:
        print(f"Exchange-rate update failed: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
