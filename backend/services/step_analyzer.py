from __future__ import annotations

import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any


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


def _format_dimensions(values: list[float]) -> str:
    return " x ".join(f"{value:.2f}" for value in values)


def _export_thumbnail(shape: Any, png_path: Path) -> None:
    from OCC.Core.Quantity import Quantity_Color, Quantity_TOC_RGB
    from OCC.Core.Graphic3d import Graphic3d_NOM_ALUMINIUM
    from OCC.Display.SimpleGui import OffscreenRenderer

    with _suppress_occ_noise():
        display = OffscreenRenderer(screen_size=(3840, 2880))

    # Light gray background (Apple-style neutral)
    bg_color = Quantity_Color(0.94, 0.94, 0.96, Quantity_TOC_RGB)
    display.View.SetBackgroundColor(bg_color)

    # Display shape with aluminum material, soft gray edges
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


def analyze_step_file(file_path: str | Path, thumb_dir: str | Path) -> dict[str, Any]:
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
        from OCC.Core.IFSelect import IFSelect_RetDone
        from OCC.Core.STEPControl import STEPControl_Reader

        reader = STEPControl_Reader()
        if reader.ReadFile(str(file_path)) != IFSelect_RetDone:
            raise ValueError("STEP read failed")
        reader.TransferRoots()
        shape = reader.OneShape()

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
            "volume_mm3": volume_mm3,
            "obb_dimensions_mm": _format_dimensions(obb_dims),
            "aabb_dimensions_mm": _format_dimensions(aabb_dims),
            "thumbnail_path": str(thumbnail_path) if thumbnail_path else None,
        }
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"

    return result
