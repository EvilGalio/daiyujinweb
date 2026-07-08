"""Material weight calculator: volume formulas and unit conversion."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "material_weight"


def _first_float(row, *keys):
    for k in keys:
        v = row.get(k, "").strip()
        if v:
            try:
                return float(v)
            except ValueError:
                continue
    raise ValueError(f"Missing numeric value for any of: {', '.join(keys)}")


def _maybe_float(v):
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _round_weight(v: float) -> float:
    return round(v, 4)


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

    density_gcm3 = _first_float(mat, "density_g_cm3_nominal", "density_g_cm3")
    density_gcm3_min = _maybe_float(mat.get("density_g_cm3_min"))
    density_gcm3_max = _maybe_float(mat.get("density_g_cm3_max"))
    if density_gcm3_min is None:
        density_gcm3_min = density_gcm3
    if density_gcm3_max is None:
        density_gcm3_max = density_gcm3
    if density_gcm3_min > density_gcm3_max:
        density_gcm3_min, density_gcm3_max = density_gcm3_max, density_gcm3_min

    density_lb_in3 = _maybe_float(mat.get("density_lb_in3_nominal"))
    if density_lb_in3 is None:
        density_lb_in3 = density_gcm3 * 0.036127292

    density_confidence = _maybe_float(mat.get("confidence"))

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
    weight_g_nominal = volume_cm3 * density_gcm3
    weight_g_min = volume_cm3 * density_gcm3_min
    weight_g_max = volume_cm3 * density_gcm3_max
    if weight_g_min > weight_g_max:
        weight_g_min, weight_g_max = weight_g_max, weight_g_min

    # Output conversion
    piece_weight_nom, out_label = _convert_weight(weight_g_nominal, out_unit)
    piece_weight_min, _ = _convert_weight(weight_g_min, out_unit)
    piece_weight_max, _ = _convert_weight(weight_g_max, out_unit)

    piece_weight_nom = _round_weight(piece_weight_nom)
    piece_weight_min = _round_weight(piece_weight_min)
    piece_weight_max = _round_weight(piece_weight_max)
    if piece_weight_min > piece_weight_max:
        piece_weight_min, piece_weight_max = piece_weight_max, piece_weight_min

    piece_total_nom = _round_weight(piece_weight_nom * quantity)
    piece_total_min = _round_weight(piece_weight_min * quantity)
    piece_total_max = _round_weight(piece_weight_max * quantity)

    return {
        "material": {"id": mat_id, "label": mat.get("label", "")},
        "shape": {"id": shape_id, "label": shape_cfg["label"]},
        "density": {
            "nominal_g_cm3": _round_weight(density_gcm3),
            "min_g_cm3": _round_weight(density_gcm3_min),
            "max_g_cm3": _round_weight(density_gcm3_max),
            "nominal_lb_in3": _round_weight(density_lb_in3),
            "confidence": density_confidence,
        },
        "piece_weight": {
            "value": piece_weight_nom,
            "unit": out_label,
            "display": f"{piece_weight_nom} {out_label}",
        },
        "piece_weight_range": {
            "min": piece_weight_min,
            "max": piece_weight_max,
            "display": f"{piece_weight_min} - {piece_weight_max} {out_label}",
        },
        "total_weight": {
            "value": piece_total_nom,
            "unit": out_label,
            "display": f"{piece_total_nom} {out_label}",
        },
        "total_weight_range": {
            "min": piece_total_min,
            "max": piece_total_max,
            "display": f"{piece_total_min} - {piece_total_max} {out_label}",
        },
        "volume": {"value_cm3": _round_weight(volume_cm3)},
        "quantity": quantity,
        "note": "Calculated from reference density range. Actual weight may vary by tolerance and material condition.",
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
    elif shape_id == "angle_bar":
        la = d["leg_a"]
        lb = d["leg_b"]
        t = d["thickness"]
        l = d["length"]
        if t >= min(la, lb):
            raise ValueError("Thickness must be less than each leg length")
        area = la * t + lb * t - t ** 2
        return area * l
    elif shape_id == "channel":
        h = d["height"]
        fw = d["flange_width"]
        wt = d["web_thickness"]
        ft = d["flange_thickness"]
        if ft * 2 >= h:
            raise ValueError("Flange thickness too large")
        if wt >= fw:
            raise ValueError("Web thickness too large")
        return (h * wt + 2 * fw * ft) * d["length"]
    elif shape_id == "i_beam":
        h = d["height"]
        fw = d["flange_width"]
        wt = d["web_thickness"]
        ft = d["flange_thickness"]
        wh = h - 2 * ft
        if wh <= 0:
            raise ValueError("Flange thickness too large for given height")
        if wt >= fw:
            raise ValueError("Web thickness too large")
        return (wh * wt + 2 * fw * ft) * d["length"]
    elif shape_id == "t_bar":
        fw = d["flange_width"]
        ft = d["flange_thickness"]
        wh = d["web_height"]
        wt = d["web_thickness"]
        if wt >= fw:
            raise ValueError("Web thickness too large")
        if wh <= 0:
            raise ValueError("Web height must be positive")
        return (fw * ft + wh * wt) * d["length"]
    elif shape_id == "hex_bar":
        return (math.sqrt(3) / 2) * d["across_flats"] ** 2 * d["length"]
    elif shape_id == "ring":
        od, id_, t = d["outer_diameter"], d["inner_diameter"], d["thickness"]
        if id_ >= od:
            raise ValueError("Inner diameter must be less than outer diameter")
        return math.pi * t * ((od / 2) ** 2 - (id_ / 2) ** 2)
    elif shape_id == "disc":
        return math.pi * (d["diameter"] / 2) ** 2 * d["thickness"]
    elif shape_id == "sphere":
        r = d["diameter"] / 2
        return 4 / 3 * math.pi * r ** 3
    elif shape_id == "frustum":
        h = d["height"]
        r1 = d["top_diameter"] / 2
        r2 = d["bottom_diameter"] / 2
        return math.pi * h / 3 * (r1 ** 2 + r1 * r2 + r2 ** 2)
    else:
        raise ValueError(f"Unknown shape: {shape_id}")


_UNIT_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0, "inch": 2.54, "ft": 30.48}


def _unit_to_cm(unit: str) -> float:
    u = _UNIT_CM.get(unit)
    if u is None:
        raise ValueError(f"Unknown unit: {unit}. Use mm, cm, m, inch, ft.")
    return u


def _convert_weight(grams: float, out_unit: str) -> tuple[float, str]:
    if out_unit == "g":
        return grams, "g"
    elif out_unit == "lb":
        return grams / 453.592, "lb"
    else:
        return grams / 1000, "kg"


def _load_csv(name: str) -> list[dict]:
    with open(DATA_DIR / name, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))
