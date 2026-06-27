"""Quick export: first STEP in uploads → STL for 3D preview testing."""
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from OCC.Core.StlAPI import StlAPI_Writer
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.IFSelect import IFSelect_RetDone

UPLOAD_DIR = BACKEND_ROOT / "uploads"
STATIC_DIR = BACKEND_ROOT / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

stp_files = sorted(UPLOAD_DIR.glob("*.stp")) + sorted(UPLOAD_DIR.glob("*.step"))
if not stp_files:
    print("No STEP files found")
    sys.exit(1)

src = stp_files[0]
print(f"Source: {src.name}")

reader = STEPControl_Reader()
if reader.ReadFile(str(src)) != IFSelect_RetDone:
    print("STEP read failed")
    sys.exit(2)
reader.TransferRoots()
shape = reader.OneShape()

# Triangulate with good precision
mesh = BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5)
mesh.Perform()

# Export STL
out = STATIC_DIR / "test_part.stl"
writer = StlAPI_Writer()
writer.SetASCIIMode(False)  # binary = smaller
writer.Write(shape, str(out))
print(f"Exported: {out} ({out.stat().st_size / 1024:.1f} KB)")
