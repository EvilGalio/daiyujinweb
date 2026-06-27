"""Export STEP file as binary STL via OCC subprocess."""
import sys, json, os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from OCC.Core.StlAPI import StlAPI_Writer
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.IFSelect import IFSelect_RetDone

def main():
    if len(sys.argv) != 3:
        json.dump({"error": "usage: export_stl_cli.py <step_path> <stl_path>"}, sys.stdout)
        return 1

    step_path = Path(sys.argv[1])
    stl_path = Path(sys.argv[2])

    if not step_path.exists():
        json.dump({"error": f"STEP file not found: {step_path}"}, sys.stdout)
        return 1

    try:
        reader = STEPControl_Reader()
        if reader.ReadFile(str(step_path)) != IFSelect_RetDone:
            raise RuntimeError("STEP read failed")
        reader.TransferRoots()
        shape = reader.OneShape()

        mesh = BRepMesh_IncrementalMesh(shape, 0.15, False, 0.5)
        mesh.Perform()

        writer = StlAPI_Writer()
        writer.SetASCIIMode(False)
        writer.Write(shape, str(stl_path))

        size_kb = stl_path.stat().st_size / 1024
        json.dump({"success": True, "stl_path": str(stl_path), "size_kb": round(size_kb, 1)}, sys.stdout)

    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)
        return 1

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
