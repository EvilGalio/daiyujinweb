"""Export STEP/IGES file as binary STL via OCC subprocess."""
import sys, json, os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from services.cad_analyzer import export_cad_stl

def main():
    if len(sys.argv) != 3:
        json.dump({"error": "usage: export_stl_cli.py <cad_path> <stl_path>"}, sys.stdout)
        return 1

    cad_path = Path(sys.argv[1])
    stl_path = Path(sys.argv[2])

    if not cad_path.exists():
        json.dump({"error": f"CAD file not found: {cad_path}"}, sys.stdout)
        return 1

    try:
        json.dump(export_cad_stl(cad_path, stl_path), sys.stdout)

    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)
        return 1

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
