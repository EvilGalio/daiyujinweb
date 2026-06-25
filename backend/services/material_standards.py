"""Material standards lookup service."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "material_standards"

_cache: dict = {}


def _load_csv(name: str) -> list[dict]:
    key = f"csv_{name}"
    if key not in _cache:
        with open(DATA_DIR / name, encoding="utf-8-sig") as f:
            _cache[key] = list(csv.DictReader(f))
    return _cache[key]


def normalize(text: str) -> str:
    """Strip spaces, hyphens, lower case."""
    return re.sub(r"[^a-z0-9]", "", text.lower().strip())


def search(query: str, limit: int = 10) -> dict:
    q = query.strip()
    if not q:
        return {"query": q, "normalized_query": q, "results": []}

    norm_q = normalize(q)
    equivalences = _load_csv("material_equivalents.csv")
    aliases = _load_csv("material_aliases.csv")

    results = []
    seen = set()

    for alias_row in aliases:
        if normalize(alias_row["alias"]) == norm_q:
            mat_id = alias_row["material_id"]
            if mat_id in seen:
                continue
            mat = next((r for r in equivalences if r["material_id"] == mat_id), None)
            if mat:
                results.append(_format_result(mat, alias_row))
                seen.add(mat_id)

    # Also search directly in equivalences
    for row in equivalences:
        if row["material_id"] in seen:
            continue
        # Check all standard columns
        for col in ["ISO", "EN", "DIN", "ANSI_AA_USA", "UNS", "JIS_JP", "BS_GB",
                     "AFNOR_FR", "UNE_ES", "CSA_CA", "SIS_SE"]:
            if normalize(row.get(col, "")) == norm_q:
                results.append(_format_result(row, None))
                seen.add(row["material_id"])
                break

    # Partial match on common_name
    if len(results) < limit:
        for row in equivalences:
            if row["material_id"] in seen:
                continue
            if norm_q in normalize(row.get("common_name", "")):
                results.append(_format_result(row, None))
                seen.add(row["material_id"])
            if len(results) >= limit:
                break

    return {"query": q, "normalized_query": norm_q, "results": results[:limit]}


def get_families() -> dict:
    equivalences = _load_csv("material_equivalents.csv")
    families = sorted(set(r["material_family"] for r in equivalences if r.get("material_family")))
    return {"families": families}


def _format_result(row: dict, alias_row: dict | None) -> dict:
    return {
        "material_id": row["material_id"],
        "material_family": row.get("material_family", ""),
        "common_name": row.get("common_name", ""),
        "matched_alias": alias_row["alias"] if alias_row else row.get("common_name", ""),
        "confidence": alias_row.get("confidence", "medium") if alias_row else "medium",
        "review_status": row.get("review_status", "needs_review"),
        "standards": {
            "ISO": row.get("ISO", ""),
            "EN": row.get("EN", ""),
            "DIN": row.get("DIN", ""),
            "ANSI_AA_USA": row.get("ANSI_AA_USA", ""),
            "UNS": row.get("UNS", ""),
            "JIS_JP": row.get("JIS_JP", ""),
            "BS_GB": row.get("BS_GB", ""),
            "AFNOR_FR": row.get("AFNOR_FR", ""),
            "UNE_ES": row.get("UNE_ES", ""),
            "CSA_CA": row.get("CSA_CA", ""),
            "SIS_SE": row.get("SIS_SE", ""),
        },
        "notes": row.get("notes", ""),
    }
