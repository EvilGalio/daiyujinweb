"""Build material_public_options.json from v2.2 material_prices.csv.

Rules:
- Only active, reviewed materials with valid price/density
- Classify into 8 public categories based on material_family + material_grade_norm
- Exclude all internal fields (price, density, source, confidence, etc.)
"""

import csv, json, os
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "quote_model_v2_2"
SRC = DATA_DIR / "material_prices.csv"
OUT = DATA_DIR / "material_public_options.json"

# Classification rules: (category_id, label, description, match_fn)
CATEGORIES = [
    ("aluminum_alloy", "Aluminum Alloy",
     "Lightweight CNC materials for prototypes and production.",
     lambda r: r["material_family"] == "aluminum"),

    ("stainless_steel", "Stainless Steel",
     "Corrosion-resistant machining grades.",
     lambda r: r["material_family"] == "steel" and any(
         tag in (r.get("material_grade_norm", "") + r.get("material_base_norm", "") + r.get("feature", "")).upper()
         for tag in ["SUS", "SS ", "STAINLESS", "不锈钢", "不锈铁"])),

    ("tool_steel", "Tool Steel",
     "Mold and die steels, high-wear grades.",
     lambda r: r["material_family"] == "steel" and (
         r.get("feature", "") == "模具钢" or
         any(tag in (r.get("material_grade_norm", "") + r.get("material_base_norm", "")).upper()
             for tag in ["CR12", "D2", "SKD", "P20", "O1", "H13"]))),

    ("carbon_alloy_steel", "Carbon / Alloy Steel",
     "General structural and alloy steels.",
     lambda r: r["material_family"] == "steel"),

    ("engineering_plastic", "Engineering Plastic",
     "Common thermoplastics. ABS, POM, PC, Nylon/PA, etc.",
     lambda r: r["material_family"] == "plastic" and not any(
         tag in r.get("material_grade_norm", "").upper() or tag in r.get("material_base_norm", "").upper()
         for tag in ["PEEK", "PEI", "PPS", "PI", "PBI", "PAI", "PFA", "PTFE", "PVDF", "TORLON", "ULTEM", "RADEL", "KETRON", "SEMITRON", "RYTON", "VESPEL", "KAPTON"])),

    ("high_performance_plastic", "High-Performance Plastic",
     "Advanced polymers for extreme conditions. PEEK, PTFE, PPS, PI, etc.",
     lambda r: r["material_family"] == "plastic"),

    ("brass_copper", "Brass / Copper",
     "Copper alloys for electrical and thermal applications.",
     lambda r: False),  # v2.2 data doesn't have brass/copper yet

    ("titanium_specialty", "Titanium / Specialty",
     "Titanium alloys and specialty metals.",
     lambda r: False),  # v2.2 data doesn't have these yet
]


def load_rows():
    with open(SRC, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def is_publishable(r):
    if r.get("is_active", "").upper() != "TRUE":
        return False
    if r.get("review_required", "").upper() == "TRUE":
        return False
    try:
        price = float(r.get("price_rmb_per_kg", 0))
        density = float(r.get("density_g_cm3", 0))
        if price <= 0 or density <= 0:
            return False
        # Sanity checks
        if density < 0.5 or density > 25:
            return False
        if price < 1 or price > 5000:
            return False
        # Known anomaly: SKS3 price=7.85 density=1.251 (misaligned columns)
        if r.get("material_grade_norm") == "SKS3" and density < 5:
            return False
    except (ValueError, TypeError):
        return False
    return True


def classify(row):
    for cat_id, label, desc, fn in CATEGORIES:
        if fn(row):
            return (cat_id, label, desc)
    # Fallback
    fam = row.get("material_family", "")
    return (fam, fam.replace("_", " ").title(), "")


def build():
    rows = load_rows()
    pub = [r for r in rows if is_publishable(r)]

    # Group by category
    groups = {}
    for r in pub:
        cat_id, cat_label, cat_desc = classify(r)
        if cat_id not in groups:
            groups[cat_id] = {"id": cat_id, "label": cat_label, "description": cat_desc, "materials": []}

        grade = r.get("material_grade_norm", r.get("material_base_norm", ""))
        feature = r.get("feature", "")
        subtitle = feature if feature else (r.get("material_base_norm", "") + " alloy")

        groups[cat_id]["materials"].append({
            "id": r["price_id"],
            "label": grade,
            "subtitle": subtitle,
            "badges": ["Common"] if r.get("source_priority", "0") == "100" else [],
            "review_recommended": False,
        })

    # Sort materials within each category: common first, then by label
    for g in groups.values():
        g["materials"].sort(key=lambda m: (0 if m["badges"] else 1, m["label"]))

    # Set default material (first "Common" or first overall)
    for g in groups.values():
        mats = g["materials"]
        g["default_material_id"] = mats[0]["id"] if mats else ""
        g["description"] = f"{g['description']} {len(mats)} grades available."

    # Order categories alphabetically by label
    result = {
        "categories": sorted(groups.values(), key=lambda g: g["label"]),
        "_meta": {
            "source": "material_prices.csv v2.2-A.1",
            "generated": "2026-06-27",
            "total_materials": len(pub),
            "categories_count": len(groups),
            "note": "Public-safe. No prices, densities, or internal fields.",
        }
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Written {OUT}")
    print(f"  Categories: {len(groups)}")
    for g in result["categories"]:
        print(f"    {g['label']}: {len(g['materials'])} materials, default={g['default_material_id']}")

if __name__ == "__main__":
    build()
