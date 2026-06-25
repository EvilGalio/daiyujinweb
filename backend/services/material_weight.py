"""Material weight calculator — volume formulas and unit conversion."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "material_weight"


def get_options() -> dict:
    densities = _load_csv("material_density.csv")
    with open(DATA_DIR / "shapes.json", encoding="utf-8") as f:
        shapes = json.load(f)

    materials = []
    for row in densities:
        if row.get("is_active", "1") != "0":
            materials.append({
                "id": row["material_id"],
                "family": row.get("family", ""),
                "label": row.get("label", ""),
            })

    shape_list = []
    for sid, s in shapes.items():
        shape_list.append({
            "id": sid,
            "label": s["label"],
            "dimensions": s["dimensions"],
        })

    return {
        "materials": materials,
        "shapes": shape_list,
        "units": ["mm", "cm", "m", "inch", "ft"],
        "output_units": ["kg", "g", "lb"],
    }


def calculate(payload: dict) -> dict:
    mat_id = str(payload.get("material_id", ""))
    shape_id = str(payload.get("shape", ""))
    unit = str(payload.get("unit", "mm"))
    out_unit = str(payload.get("output_unit", "kg"))
    quantity = int(payload.get("quantity", 1))
    dims = payload.get("dimensions", {})

    if quantity < 1:
        raise ValueError("Quantity must be >= 1")

    # Find material density
    densities = _load_csv("material_density.csv")
    mat = next((r for r in densities if r["material_id"] == mat_id), None)
    if mat is None:
        raise ValueError(f"Unknown material: {mat_id}")
    density_gcm3 = float(mat["density_g_cm3"])
    density_lb_in3 = float(mat.get("density_lb_in3", 0))

    # Shape config
    with open(DATA_DIR / "shapes.json", encoding="utf-8") as f:
        shapes = json.load(f)
    shape_cfg = shapes.get(shape_id)
    if shape_cfg is None:
        raise ValueError(f"Unknown shape: {shape_id}")

    # Convert all dimensions to cm
    scale = _unit_to_cm(unit)
    dims_cm = {}
    for d in shape_cfg["dimensions"]:
        key = d["key"]
        val = float(dims.get(key, 0))
        if val <= 0:
            raise ValueError(f"Dimension '{key}' must be positive")
        dims_cm[key] = val * scale

    # Volume calculation
    volume_cm3 = _shape_volume(shape_id, dims_cm)

    # Weight
    weight_g = volume_cm3 * density_gcm3

    # Output conversion
    piece_weight, out_label = _convert_weight(weight_g, out_unit, density_lb_in3)

    return {
        "material": {"id": mat_id, "label": mat.get("label", "")},
        "shape": {"id": shape_id, "label": shape_cfg["label"]},
        "piece_weight": {
            "value": round(piece_weight, 4),
            "unit": out_label,
            "display": f"{round(piece_weight, 4)} {out_label}",
        },
        "total_weight": {
            "value": round(piece_weight * quantity, 4),
            "unit": out_label,
            "display": f"{round(piece_weight * quantity, 4)} {out_label}",
        },
        "volume": {"value_cm3": round(volume_cm3, 4)},
        "quantity": quantity,
        "note": "Calculated from reference density. Actual weight may vary by tolerance and material condition.",
    }


def _shape_volume(shape_id: str, d: dict) -> float:
    """Calculate volume in cm^3."""
    if shape_id == "round_bar":
        return math.pi * (d["diameter"] / 2) ** 2 * d["length"]
    elif shape_id == "square_bar":
        return d["side"] * d["side"] * d["length"]
    elif shape_id == "rectangular_bar":
        return d["width"] * d["thickness"] * d["length"]
    elif shape_id == "sheet":
        return d["length"] * d["width"] * d["thickness"]
    elif shape_id == "round_tube":
        od, wt, l = d["outer_diameter"], d["wall_thickness"], d["length"]
        if wt >= od / 2:
            raise ValueError("Wall thickness must be less than half outer diameter")
        return math.pi * l * ((od / 2) ** 2 - (od / 2 - wt) ** 2)
    elif shape_id == "square_tube":
        os, wt, l = d["outer_side"], d["wall_thickness"], d["length"]
        if wt >= os / 2:
            raise ValueError("Wall thickness must be less than half outer side")
        return (os * os - (os - 2 * wt) ** 2) * l
    elif shape_id == "rectangular_tube":
        ow, oh, wt, l = d["outer_width"], d["outer_height"], d["wall_thickness"], d["length"]
        if wt * 2 >= min(ow, oh):
            raise ValueError("Wall thickness too large")
        return (ow * oh - (ow - 2 * wt) * (oh - 2 * wt)) * l
    elif shape_id == "hex_bar":
        return (math.sqrt(3) / 2) * d["across_flats"] ** 2 * d["length"]
    elif shape_id == "ring":
        od, id_, t = d["outer_diameter"], d["inner_diameter"], d["thickness"]
        if id_ >= od:
            raise ValueError("Inner diameter must be less than outer diameter")
        return math.pi * t * ((od / 2) ** 2 - (id_ / 2) ** 2)
    elif shape_id == "disc":
        return math.pi * (d["diameter"] / 2) ** 2 * d["thickness"]
    else:
        raise ValueError(f"Unknown shape: {shape_id}")


_UNIT_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0, "inch": 2.54, "ft": 30.48}


def _unit_to_cm(unit: str) -> float:
    u = _UNIT_CM.get(unit)
    if u is None:
        raise ValueError(f"Unknown unit: {unit}. Use mm, cm, m, inch, ft.")
    return u


def _convert_weight(grams: float, out_unit: str, density_lb_in3: float) -> tuple[float, str]:
    if out_unit == "g":
        return grams, "g"
    elif out_unit == "lb":
        vol_in3 = grams / (density_lb_in3 * 453.592 if density_lb_in3 else 1)
        return vol_in3 * density_lb_in3 if density_lb_in3 else grams / 453.592, "lb"
    else:
        return grams / 1000, "kg"


def _load_csv(name: str) -> list[dict]:
    with open(DATA_DIR / name, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))
