"""Material standards lookup service."""

from __future__ import annotations

import csv
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "material_standards"
_cache: dict[str, list[dict]] = {}

STANDARD_COLUMNS = [
    "ISO",
    "EN",
    "DIN",
    "ANSI_AA_USA",
    "SAE_AISI",
    "UNS",
    "JIS_JP",
    "GB_CN",
    "BS_GB",
    "AFNOR_FR",
    "UNE_ES",
    "UNI_IT",
    "CSA_CA",
    "SIS_SE",
    "WNr",
]

STANDARD_FILTER_MAP = {
    "ISO": "ISO",
    "EN": "EN",
    "DIN": "DIN",
    "AA": "ANSI_AA_USA",
    "ANSI": "ANSI_AA_USA",
    "ANSI_AA": "ANSI_AA_USA",
    "SAE": "SAE_AISI",
    "AISI": "SAE_AISI",
    "UNS": "UNS",
    "JIS": "JIS_JP",
    "JPS": "JIS_JP",
    "GB": "GB_CN",
    "BS": "BS_GB",
    "AFNOR": "AFNOR_FR",
    "UNE": "UNE_ES",
    "UNI": "UNI_IT",
    "CSA": "CSA_CA",
    "SIS": "SIS_SE",
    "WNR": "WNr",
}

CONFIDENCE_LEVELS = {
    "high": 0.90,
    "medium": 0.75,
    "low": 0.0,
}


def _load_csv(name: str) -> list[dict]:
    key = f"csv_{name}"
    if key not in _cache:
        with open(DATA_DIR / name, encoding="utf-8-sig") as f:
            _cache[key] = list(csv.DictReader(f))
    return _cache[key]


def normalize(text: str | None) -> str:
    """Normalize text for matching."""
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]", "", str(text).lower().strip())


def _to_float(value: str | float | int | None) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _confidence_label(value: float) -> str:
    if value >= 0.90:
        return "high"
    if value >= 0.75:
        return "medium"
    return "low"


def _confidence_from_alias(alias_row: dict | None) -> float:
    if not alias_row:
        return 0.0
    level = str(alias_row.get("confidence") or "").strip().lower()
    return CONFIDENCE_LEVELS.get(level, 0.0)


def _resolve_standard_filter(value: str | None) -> str:
    if not value:
        return ""
    norm = normalize(value).upper()
    return STANDARD_FILTER_MAP.get(norm) or STANDARD_FILTER_MAP.get(value.upper(), "")


def _parse_confidence_filter(value: str | float | None) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    level = str(value).strip().lower()
    if level in CONFIDENCE_LEVELS:
        return CONFIDENCE_LEVELS[level]
    try:
        return float(level)
    except (TypeError, ValueError):
        return 0.0


def _source_lookup() -> dict[str, dict]:
    rows = _load_csv("sources.csv")
    return {r.get("source_id", ""): r for r in rows if r.get("source_id")}


def get_families() -> dict:
    equivalences = _load_csv("material_equivalents.csv")
    families = sorted({r["material_family"] for r in equivalences if r.get("material_family")})
    return {"families": families}


def search(
    query: str,
    limit: int = 10,
    family: str | None = None,
    standard: str | None = None,
    min_confidence: str | float | None = None,
) -> dict:
    q = (query or "").strip()
    if not q:
        return {"query": q, "normalized_query": "", "results": []}

    norm_q = normalize(q)
    equivalences = _load_csv("material_equivalents.csv")
    aliases = _load_csv("material_aliases.csv")
    by_id = {r.get("material_id"): r for r in equivalences}
    source_lookup = _source_lookup()

    family_norm = normalize(family)
    std_col = _resolve_standard_filter(standard)
    confidence_floor = _parse_confidence_filter(min_confidence)

    candidates: dict[str, dict] = {}
    for alias_row in aliases:
        mat_id = alias_row.get("material_id", "")
        if not mat_id:
            continue
        alias_norm = normalize(alias_row.get("alias", ""))
        if not alias_norm:
            continue
        if norm_q == alias_norm:
            score = 120
        elif norm_q in alias_norm:
            score = 65
        else:
            continue
        candidate = candidates.get(mat_id)
        if not candidate or score > candidate["score"]:
            candidates[mat_id] = {
                "score": score,
                "matched_alias": alias_row,
                "matched_standard": "",
            }

    for row in equivalences:
        mat_id = row.get("material_id", "")
        if not mat_id:
            continue

        norm_common = normalize(row.get("common_name", ""))
        if norm_q in norm_common:
            score = 40
            candidate = candidates.get(mat_id)
            if not candidate or score > candidate["score"]:
                candidates[mat_id] = {
                    "score": score,
                    "matched_alias": None,
                    "matched_standard": "",
                }

        for col in STANDARD_COLUMNS:
            norm_val = normalize(row.get(col, ""))
            if not norm_val:
                continue
            if norm_q == norm_val:
                score = 110
            elif norm_q in norm_val:
                score = 70
            else:
                continue
            candidate = candidates.get(mat_id)
            if not candidate or score > candidate["score"]:
                candidates[mat_id] = {
                    "score": score,
                    "matched_alias": None,
                    "matched_standard": col,
                }

    candidate_rows = []
    for mat_id, match in candidates.items():
        row = by_id.get(mat_id)
        if not row:
            continue
        if family_norm and normalize(row.get("material_family", "")) != family_norm:
            continue
        if std_col and not row.get(std_col):
            continue

        row_confidence = _to_float(row.get("confidence"))
        alias_confidence = _confidence_from_alias(match["matched_alias"])
        effective_confidence = max(row_confidence, alias_confidence)
        if effective_confidence < confidence_floor:
            continue

        standard_pairs = [
            {"system": col, "value": row.get(col, "")}
            for col in STANDARD_COLUMNS
            if row.get(col, "")
        ]
        candidate_rows.append(
            _format_result(
                row=row,
                alias_row=match["matched_alias"],
                score=match["score"],
                matched_standard=match["matched_standard"],
                effective_confidence=effective_confidence,
                source_lookup=source_lookup,
                standard_matches=standard_pairs,
            )
        )

    candidate_rows.sort(
        key=lambda item: (
            -item["score"],
            -item["confidence"],
            normalize(item["common_name"]),
        )
    )
    results = candidate_rows[:limit]
    for result in results:
        result.pop("score", None)

    return {
        "query": q,
        "normalized_query": norm_q,
        "results": results,
        "filters": {
            "family": family or "",
            "standard": standard or "",
            "min_confidence": min_confidence or "",
        },
    }


def _format_result(
    row: dict,
    alias_row: dict | None,
    score: int,
    matched_standard: str,
    effective_confidence: float,
    source_lookup: dict[str, dict],
    standard_matches: list[dict],
) -> dict:
    source_ids = [s.strip() for s in str(row.get("source_ids", "")).split(";") if s.strip()]
    return {
        "material_id": row.get("material_id", ""),
        "material_family": row.get("material_family", ""),
        "common_name": row.get("common_name", ""),
        "matched_alias": alias_row.get("alias", "") if alias_row else "",
        "matched_standard": matched_standard,
        "score": score,
        "confidence": round(effective_confidence, 2),
        "confidence_label": _confidence_label(effective_confidence),
        "review_status": row.get("review_status", "needs_review"),
        "standards": {
            "ISO": row.get("ISO", ""),
            "EN": row.get("EN", ""),
            "DIN": row.get("DIN", ""),
            "ANSI_AA_USA": row.get("ANSI_AA_USA", ""),
            "SAE_AISI": row.get("SAE_AISI", ""),
            "UNS": row.get("UNS", ""),
            "JIS_JP": row.get("JIS_JP", ""),
            "GB_CN": row.get("GB_CN", ""),
            "BS_GB": row.get("BS_GB", ""),
            "AFNOR_FR": row.get("AFNOR_FR", ""),
            "UNE_ES": row.get("UNE_ES", ""),
            "UNI_IT": row.get("UNI_IT", ""),
            "CSA_CA": row.get("CSA_CA", ""),
            "SIS_SE": row.get("SIS_SE", ""),
            "WNr": row.get("WNr", ""),
        },
        "standard_matches": standard_matches,
        "notes": row.get("notes", ""),
        "source_ids": source_ids,
        "sources": [source_lookup.get(s, {"source_id": s, "title": s}) for s in source_ids],
        "equivalence_disclaimer": "Equivalent designations are reference mappings. Confirm final material requirements with engineering review.",
    }
