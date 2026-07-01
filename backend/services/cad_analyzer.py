from __future__ import annotations

import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any


SUPPORTED_CAD_EXTENSIONS = {".stp", ".step", ".igs", ".iges"}


@contextmanager
def _suppress_occ_noise():
    saved = [(1, os.dup(1)), (2, os.dup(2))]
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    os.close(devnull)
    try:
        yield
    finally:
        for fd_num, fd_saved in reversed(saved):
            os.dup2(fd_saved, fd_num)
            os.close(fd_saved)


def cad_format_for_path(file_path: str | Path) -> str:
    suffix = Path(file_path).suffix.lower()
    if suffix in {".stp", ".step"}:
        return "STEP"
    if suffix in {".igs", ".iges"}:
        return "IGES"
    raise ValueError(f"Unsupported CAD file type: {suffix or '(none)'}")


def _format_dimensions(values: list[float]) -> str:
    return " x ".join(f"{value:.2f}" for value in values)


def read_cad_shape(file_path: str | Path) -> Any:
    file_path = Path(file_path).resolve()
    suffix = file_path.suffix.lower()

    if suffix not in SUPPORTED_CAD_EXTENSIONS:
        raise ValueError(f"Unsupported CAD file type: {suffix or '(none)'}")
    if not file_path.exists():
        raise FileNotFoundError(f"CAD file not found: {file_path}")

    from OCC.Core.IFSelect import IFSelect_RetDone

    if suffix in {".stp", ".step"}:
        from OCC.Core.STEPControl import STEPControl_Reader

        reader = STEPControl_Reader()
        if reader.ReadFile(str(file_path)) != IFSelect_RetDone:
            raise ValueError("STEP read failed")
    else:
        from OCC.Core.IGESControl import IGESControl_Reader

        reader = IGESControl_Reader()
        if reader.ReadFile(str(file_path)) != IFSelect_RetDone:
            raise ValueError("IGES read failed")

    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        raise ValueError(f"{cad_format_for_path(file_path)} file did not contain a readable shape")
    return shape


def _export_thumbnail(shape: Any, png_path: Path) -> None:
    from OCC.Core.Graphic3d import Graphic3d_NOM_ALUMINIUM
    from OCC.Core.Quantity import Quantity_Color, Quantity_TOC_RGB
    from OCC.Display.SimpleGui import OffscreenRenderer

    with _suppress_occ_noise():
        display = OffscreenRenderer(screen_size=(3840, 2880))

    bg_color = Quantity_Color(0.94, 0.94, 0.96, Quantity_TOC_RGB)
    display.View.SetBackgroundColor(bg_color)
    display.DisplayShape(
        shape,
        color=Quantity_Color(0.58, 0.60, 0.64, Quantity_TOC_RGB),
        material=Graphic3d_NOM_ALUMINIUM,
        transparency=0.0,
        update=True,
    )
    display.View_Iso()
    display.FitAll()
    display.View.Dump(str(png_path))
    display.EraseAll()
    time.sleep(0.2)


def analyze_cad_file(file_path: str | Path, thumb_dir: str | Path) -> dict[str, Any]:
    file_path = Path(file_path).resolve()
    thumb_dir = Path(thumb_dir).resolve()
    thumb_dir.mkdir(parents=True, exist_ok=True)

    result: dict[str, Any] = {
        "success": False,
        "data": None,
        "warnings": [],
        "error": None,
    }

    try:
        from OCC.Core.Bnd import Bnd_Box, Bnd_OBB
        from OCC.Core.BRepBndLib import brepbndlib
        from OCC.Core.BRepGProp import brepgprop
        from OCC.Core.GProp import GProp_GProps

        shape = read_cad_shape(file_path)

        aabb = Bnd_Box()
        brepbndlib.AddOptimal(shape, aabb, False, False)
        xmin, ymin, zmin, xmax, ymax, zmax = aabb.Get()
        aabb_dims = sorted(
            [round(xmax - xmin, 2), round(ymax - ymin, 2), round(zmax - zmin, 2)],
            reverse=True,
        )

        obb = Bnd_OBB()
        brepbndlib.AddOBB(shape, obb, True, True, True)
        obb_dims = sorted(
            [
                round(obb.XHSize() * 2, 2),
                round(obb.YHSize() * 2, 2),
                round(obb.ZHSize() * 2, 2),
            ],
            reverse=True,
        )

        props = GProp_GProps()
        brepgprop.VolumeProperties(shape, props)
        volume_mm3 = float(props.Mass())

        thumbnail_path = thumb_dir / f"{file_path.stem}.png"
        try:
            _export_thumbnail(shape, thumbnail_path)
        except Exception as exc:
            thumbnail_path = None
            result["warnings"].append(f"thumbnail generation failed: {type(exc).__name__}: {exc}")

        result["success"] = True
        result["data"] = {
            "name": file_path.stem,
            "source_format": cad_format_for_path(file_path),
            "volume_mm3": volume_mm3,
            "obb_dimensions_mm": _format_dimensions(obb_dims),
            "aabb_dimensions_mm": _format_dimensions(aabb_dims),
            "thumbnail_path": str(thumbnail_path) if thumbnail_path else None,
        }
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"

    return result


def export_cad_stl(file_path: str | Path, stl_path: str | Path) -> dict[str, Any]:
    file_path = Path(file_path).resolve()
    stl_path = Path(stl_path).resolve()
    stl_path.parent.mkdir(parents=True, exist_ok=True)

    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
    from OCC.Core.StlAPI import StlAPI_Writer

    shape = read_cad_shape(file_path)
    mesh = BRepMesh_IncrementalMesh(shape, 0.15, False, 0.5)
    mesh.Perform()

    writer = StlAPI_Writer()
    writer.SetASCIIMode(False)
    writer.Write(shape, str(stl_path))

    size_kb = stl_path.stat().st_size / 1024
    return {
        "success": True,
        "source_format": cad_format_for_path(file_path),
        "stl_path": str(stl_path),
        "size_kb": round(size_kb, 1),
    }
