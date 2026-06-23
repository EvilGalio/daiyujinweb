from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import DATA_DIR, init_db


if __name__ == "__main__":
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    print(f"database initialized: {Path(DATA_DIR / 'daiyujin.db')}")
