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

# ── Chinese → English translation maps ─────────
FEATURE_EN = {
    "硬铝合金": "Hard aluminum alloy",
    "耐蚀性好，焊接性优良，冷加工性较好": "Good corrosion resistance & weldability",
    "高镁合金": "High-magnesium alloy",
    "防锈铝": "Anti-rust aluminum",
    "中等强度，耐腐蚀性能好": "Medium strength, good corrosion resistance",
    "热处理耐腐蚀性合金": "Heat-treated corrosion-resistant alloy",
    "普通抗腐蚀性能": "General corrosion resistance",
    "压铸铝合金": "Die-cast aluminum alloy",
    "变形铝": "Wrought aluminum",
    "抗腐蚀性、抗氧化性好": "Excellent corrosion & oxidation resistance",
    "易切削钢": "Free-cutting steel",
    "渗碳钢": "Case-hardening steel",
    "合金钢": "Alloy steel",
    "中碳钢": "Medium carbon steel",
    "碳素结构钢": "Carbon structural steel",
    "合金结构钢": "Alloy structural steel",
    "轴承钢": "Bearing steel",
    "模具钢": "Tool & die steel",
    "马氏体不锈钢": "Martensitic stainless steel",
    "奥氏体不锈钢": "Austenitic stainless steel",
    "不锈铁": "Stainless iron",
    "高级氮化钢": "Premium nitriding steel",
    "易切削不锈钢": "Free-cutting stainless steel",
    "双相不锈钢": "Duplex stainless steel",
    "沉淀硬化不锈钢": "Precipitation-hardening stainless steel",
    "优质碳素钢": "Quality carbon steel",
    "预硬塑料模具钢": "Pre-hardened plastic mold steel",
    "塑料模具钢": "Plastic mold steel",
    "冷作模具钢": "Cold work tool steel",
    "热作模具钢": "Hot work tool steel",
    "通用工程塑料": "General-purpose engineering plastic",
    "高抗冲": "High impact resistance",
    "通用耐磨": "General wear-resistant",
    "润滑性好": "Self-lubricating",
    "高润滑": "High lubricity",
    "耐高温": "High temperature resistant",
    "高强度": "High strength",
    "耐磨": "Wear-resistant",
    "耐化学": "Chemical resistant",
    "电绝缘": "Electrical insulation",
    "透明": "Transparent",
    "阻燃": "Flame retardant",
}

LABEL_CLEAN = {
    "7075(国产)": "7075 Domestic",
    "7075(进口)": "7075 Imported",
    "5053(日本进口)": "5053 Imported (Japan)",
    "50#钢": "50# Steel",
    "65MU": "65Mn",
    "电木 棕红 黑色 黄色": "Bakelite",
    "电木": "Bakelite",
}

def _en_label(label: str) -> str:
    """Translate Chinese labels to English."""
    if label in LABEL_CLEAN:
        return LABEL_CLEAN[label]
    # Generic: "XXX钢" → "XXX Steel"
    if label.endswith("钢"):
        base = label[:-1]
        return f"{base} Steel"
    # Clean color suffixes: "ABS 米黄 黑色" → "ABS"
    import re
    cleaned = re.sub(r'\s+[\u4e00-\u9fff]+$', '', label)
    # Remove any remaining Chinese chars from label
    cleaned = re.sub(r'[\u4e00-\u9fff]+', '', cleaned).strip()
    return cleaned if cleaned else label

def _en_subtitle(row: dict) -> str:
    feature = row.get("feature", "")
    if feature in FEATURE_EN:
        return FEATURE_EN[feature]
    base = _en_label(row.get("material_base_norm", ""))
    return f"{base} alloy" if base else ""

# ── Build material options ──────────────────────
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
        # NaN guard: isfinite rejects NaN and Inf
        import math
        if not (math.isfinite(price) and math.isfinite(density)):
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

    # Group candidates by category
    groups = {}
    for r in pub:
        cat_id, cat_label, cat_desc = classify(r)
        if cat_id not in groups:
            groups[cat_id] = {"id": cat_id, "label": cat_label, "description": cat_desc, "_candidates": []}

        grade = _en_label(r.get("material_grade_norm", r.get("material_base_norm", "")))
        subtitle = _en_subtitle(r)

        # Keep descriptive subtitles, drop generic "X alloy" pattern for dedup
        clean_sub = subtitle if not subtitle.endswith(" alloy") else ""

        groups[cat_id]["_candidates"].append({
            "id": r["price_id"],
            "label": grade,
            "subtitle": subtitle,
            "clean_sub": clean_sub,
            "badges": ["Common"] if r.get("source_priority", "0") == "100" else [],
            "review_recommended": False,
        })

    # Deduplicate visible materials within each category
    for g in groups.values():
        seen = {}
        deduped = []
        for item in g.pop("_candidates", []):
            key = (item["label"].strip().lower(), item.get("clean_sub", "").strip().lower())
            if key not in seen:
                seen[key] = item
                deduped.append(item)
        # Sort: Common first, then by label
        deduped.sort(key=lambda m: (0 if m.get("badges") else 1, m["label"]))
        # Remove internal clean_sub before output
        for item in deduped:
            item.pop("clean_sub", None)
        g["materials"] = deduped
        g["default_material_id"] = deduped[0]["id"] if deduped else ""
        g["description"] = f"{g['description']} {len(deduped)} grades available."

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
