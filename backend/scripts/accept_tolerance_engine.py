"""Acceptance checks for the tolerance engine.

This script is intentionally dependency-free. It is the gate used before
exposing a fit class in the public UI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.tolerance import calculate_fit, calculate_tolerance, get_tolerance_capabilities

DATA_DIR = BACKEND_ROOT / "services" / "tolerance_engine" / "data"


def _load_json(name: str) -> dict:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def _iter_fit_codes_from_preferred(data: dict) -> list[str]:
    codes: list[str] = []
    for group_name in ("hole_basis", "shaft_basis", "ansi_b4_1", "ansi_b4_2"):
        group = data.get(group_name)
        if isinstance(group, dict):
            for items in group.values():
                for item in items:
                    if isinstance(item, dict):
                        code = item.get("code") or item.get("combination")
                    else:
                        code = item
                    if code:
                        codes.append(str(code))
        elif isinstance(group, list):
            for item in group:
                if isinstance(item, dict):
                    code = item.get("code") or item.get("combination")
                else:
                    code = item
                if code:
                    codes.append(str(code))
    for code in data.get("legacy", []):
        codes.append(str(code))
    return sorted(set(codes))


def _iter_fit_codes_from_reference(data: dict) -> list[str]:
    codes: list[str] = []
    for group_name, group in data.get("groups", {}).items():
        if group_name == "ambiguous_excluded":
            continue
        for code in group:
            codes.append(str(code))
    return sorted(set(codes))


def _sample_sizes(primary_size_mm: float) -> list[float]:
    sizes = [primary_size_mm, 50.0, 100.0]
    result: list[float] = []
    for size in sizes:
        if size not in result:
            result.append(size)
    return result


def _check_fit_codes(codes: list[str], basic_size_mm: float) -> tuple[list[str], list[tuple[str, str]]]:
    ok: list[str] = []
    failed: list[tuple[str, str]] = []
    sample_sizes = _sample_sizes(basic_size_mm)
    for code in codes:
        messages: list[str] = []
        for size in sample_sizes:
            try:
                calculate_fit(size, code)
                ok.append(code)
                break
            except Exception as exc:  # noqa: BLE001 - acceptance script prints exact failures
                messages.append(f"{size:g} mm: {exc}")
        else:
            failed.append((code, "; ".join(messages)))
    return ok, failed


def _check_single_zones(basic_size_mm: float) -> list[tuple[str, str, str]]:
    failed: list[tuple[str, str, str]] = []
    caps = get_tolerance_capabilities()
    sample_sizes = _sample_sizes(basic_size_mm)
    for zone in caps.get("hole", {}).get("zones", []):
        messages: list[str] = []
        for size in sample_sizes:
            try:
                calculate_tolerance({
                    "basic_size_mm": size,
                    "mode": "hole",
                    "hole_zone": zone,
                    "hole_grade": 7,
                })
                break
            except Exception as exc:  # noqa: BLE001
                messages.append(f"{size:g} mm: {exc}")
        else:
            failed.append(("hole", zone, "; ".join(messages)))
    for zone in caps.get("shaft", {}).get("zones", []):
        messages = []
        for size in sample_sizes:
            try:
                calculate_tolerance({
                    "basic_size_mm": size,
                    "mode": "shaft",
                    "shaft_zone": zone,
                    "shaft_grade": 6,
                })
                break
            except Exception as exc:  # noqa: BLE001
                messages.append(f"{size:g} mm: {exc}")
        else:
            failed.append(("shaft", zone, "; ".join(messages)))
    return failed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--basic-size-mm", type=float, default=25.0)
    parser.add_argument(
        "--require-reference-complete",
        action="store_true",
        help="Fail if any curated reference fit is unsupported.",
    )
    args = parser.parse_args()

    preferred = _load_json("preferred_fits.json")
    reference = _load_json("reference_fit_catalog.json")

    public_codes = _iter_fit_codes_from_preferred(preferred)
    reference_codes = _iter_fit_codes_from_reference(reference)

    public_ok, public_failed = _check_fit_codes(public_codes, args.basic_size_mm)
    reference_ok, reference_failed = _check_fit_codes(reference_codes, args.basic_size_mm)
    single_failed = _check_single_zones(args.basic_size_mm)

    print(f"basic_size_mm={args.basic_size_mm:g}")
    print(f"public_preset_count={len(public_codes)}")
    print(f"public_preset_supported={len(public_ok)}")
    print(f"public_preset_failed={len(public_failed)}")
    print(f"reference_fit_count={len(reference_codes)}")
    print(f"reference_fit_supported={len(reference_ok)}")
    print(f"reference_fit_failed={len(reference_failed)}")
    print(f"single_zone_failed={len(single_failed)}")
    print(f"unsupported_count={len(public_failed) + len(single_failed)}")

    if public_failed:
        print("\nPUBLIC PRESET FAILURES")
        for code, message in public_failed:
            print(f"- {code}: {message}")

    if reference_failed:
        print("\nREFERENCE FAILURES")
        for code, message in reference_failed:
            print(f"- {code}: {message}")

    if single_failed:
        print("\nSINGLE ZONE FAILURES")
        for kind, zone, message in single_failed:
            print(f"- {kind} {zone}: {message}")

    if public_failed or single_failed:
        return 1
    if args.require_reference_complete and reference_failed:
        return 1

    if not reference_failed:
        print("all tolerance reference fits supported")
    else:
        print("public tolerance presets supported; reference catalog still has unsupported entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
