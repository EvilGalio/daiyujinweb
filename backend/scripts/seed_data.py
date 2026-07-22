from __future__ import annotations

import os
import sys
from pathlib import Path

from werkzeug.security import generate_password_hash

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import DATA_DIR, SessionLocal, init_db
from models import (AdminUser, ExchangeRate, FreightRuleConfig, FreightSurchargeConfig,
                         Material, QuantityTier, SizeCost, SurfaceTreatment, ToleranceGrade)


def seed() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    initial_admin_password = os.environ.get(
        "PRECISION_TOOLS_ADMIN_PASSWORD", ""
    ).strip()
    if not initial_admin_password:
        if os.environ.get("PRECISION_TOOLS_ALLOW_INSECURE_DEV_SEED") == "1":
            initial_admin_password = "change-me-before-production"
        else:
            raise RuntimeError(
                "PRECISION_TOOLS_ADMIN_PASSWORD is required for database seeding"
            )

    session = SessionLocal()
    try:
        admin = session.query(AdminUser).filter_by(username="admin").one_or_none()
        if admin is None:
            session.add(
                AdminUser(
                    username="admin",
                    password_hash=generate_password_hash(initial_admin_password),
                )
            )

        rates = [
            ("USD", "USD", 1.0),
            ("CNY", "CNY", 1.0),
            ("EUR", "EUR", 1.0),
            ("USD", "CNY", 7.20),
            ("USD", "EUR", 0.92),
            ("CNY", "USD", 1 / 7.20),
            ("CNY", "EUR", 0.92 / 7.20),
            ("EUR", "CNY", 7.20 / 0.92),
            ("EUR", "USD", 1 / 0.92),
        ]
        for from_currency, to_currency, rate in rates:
            existing = (
                session.query(ExchangeRate)
                .filter_by(from_currency=from_currency, to_currency=to_currency)
                .one_or_none()
            )
            if existing is None:
                session.add(
                    ExchangeRate(
                        from_currency=from_currency,
                        to_currency=to_currency,
                        rate=rate,
                    )
                )
            else:
                existing.rate = rate

        materials = [
            ("Carbon Steel AISI 1045", 7.85, 2.50, "Carbon Steel"),
            ("Stainless Steel 304", 7.93, 8.00, "Stainless Steel"),
            ("Stainless Steel 316", 8.00, 12.00, "Stainless Steel"),
            ("Aluminum 6061-T6", 2.70, 6.50, "Aluminum"),
            ("Aluminum 7075-T6", 2.81, 9.00, "Aluminum"),
            ("Titanium Grade 5 (Ti-6Al-4V)", 4.43, 45.00, "Titanium"),
            ("Brass C360", 8.50, 10.00, "Copper Alloy"),
            ("Copper C110", 8.96, 14.00, "Copper Alloy"),
            ("POM (Delrin)", 1.41, 4.00, "Engineering Plastic"),
            ("PEEK", 1.32, 80.00, "Engineering Plastic"),
        ]
        for name, density, unit_price, category in materials:
            material = session.query(Material).filter_by(name=name).one_or_none()
            if material is None:
                session.add(
                    Material(
                        name=name,
                        density_gcm3=density,
                        unit_price_usd_kg=unit_price,
                        category=category,
                        is_active=True,
                    )
                )
            else:
                material.density_gcm3 = density
                material.unit_price_usd_kg = unit_price
                material.category = category
                material.is_active = True

        tolerance_grades = [
            ("IT5", 2.20, "IT5 \u2014 Precision grinding"),
            ("IT6", 1.50, "IT6 \u2014 Fine grinding / precision turning"),
            ("IT7", 1.25, "IT7 \u2014 Precision machining"),
            ("IT8", 1.00, "IT8 \u2014 Standard machining"),
            ("IT9", 0.90, "IT9 \u2014 General machining"),
            ("IT10", 0.80, "IT10 \u2014 Rough machining"),
            ("IT11", 0.70, "IT11 \u2014 Rough machining"),
        ]
        for grade, factor, label in tolerance_grades:
            row = session.query(ToleranceGrade).filter_by(grade=grade).one_or_none()
            if row is None:
                session.add(ToleranceGrade(grade=grade, factor=factor, label=label))
            else:
                row.factor = factor
                row.label = label

        treatments = [
            ("None", 0.00),
            ("Clear Anodizing", 5.00),
            ("Black Anodizing", 6.50),
            ("Hard Anodizing", 12.00),
            ("Sandblasting", 3.00),
            ("Polishing", 8.00),
            ("Zinc Plating", 4.00),
            ("Nickel Plating", 7.00),
            ("Passivation", 3.50),
            ("Heat Treatment", 15.00),
            ("Carburizing", 18.00),
        ]
        for name, cost in treatments:
            treatment = session.query(SurfaceTreatment).filter_by(name=name).one_or_none()
            if treatment is None:
                session.add(SurfaceTreatment(name=name, cost_usd=cost, is_active=True))
            else:
                treatment.cost_usd = cost
                treatment.is_active = True

        quantity_tiers = [
            (1, 9, 1.70),
            (10, 49, 1.35),
            (50, 199, 1.00),
            (200, 999, 0.82),
            (1000, None, 0.68),
        ]
        for min_qty, max_qty, factor in quantity_tiers:
            tier = session.query(QuantityTier).filter_by(min_qty=min_qty, max_qty=max_qty).one_or_none()
            if tier is None:
                session.add(QuantityTier(min_qty=min_qty, max_qty=max_qty, factor=factor))
            else:
                tier.factor = factor

        size_costs = [
            (25, 8.00),
            (50, 12.00),
            (100, 22.00),
            (200, 45.00),
            (400, 90.00),
            (800, 180.00),
            (1600, 360.00),
        ]
        for max_dim, base_cost in size_costs:
            size_cost = session.query(SizeCost).filter_by(max_dim_mm=max_dim).one_or_none()
            if size_cost is None:
                session.add(SizeCost(max_dim_mm=max_dim, base_cost_usd=base_cost))
            else:
                size_cost.base_cost_usd = base_cost

        session.commit()

        # ── Freight rule configs ──
        freight_rules = [
            ("default_display_currency", "USD", "string", "Default display currency for freight"),
            ("volumetric_divisor_default", "5000", "number", "Default volumetric weight divisor for DHL/FedEx"),
            ("dhl_heavy_threshold_kg", "30", "number", "DHL threshold to switch to heavy cargo pricing"),
            ("fedex_heavy_threshold_kg", "20.5", "number", "FedEx threshold to switch to heavy cargo pricing"),
            ("dhl_packaging_rules", '[{"max":33,"adjust":null},{"max":70,"adjust":7.5},{"max":300,"adjust":12.5},{"max":99999,"factor":1.0822}]', "json", "DHL packaging weight rules from Excel"),
            ("fedex_packaging_rules", '[{"max":21.9,"adjust":null},{"max":40,"adjust":4},{"max":70,"adjust":7.5},{"max":300,"adjust":12.5},{"max":99999,"factor":1.0822}]', "json", "FedEx packaging weight rules from Excel"),
            ("dhl_billing_weight_rules", '[{"max":5,"step":1.5},{"max":10,"step":2},{"max":20,"step":3},{"max":30,"cap":true}]', "json", "DHL billing weight rounding rules from Excel"),
        ]
        for key, value, value_type, desc in freight_rules:
            existing = session.query(FreightRuleConfig).filter_by(key=key).one_or_none()
            if existing is None:
                session.add(FreightRuleConfig(key=key, value=value, value_type=value_type, description=desc))

        # ── Freight surcharge configs (default 0, structure ready) ──
        for carrier in ["DHL", "FedEx"]:
            for stype in ["fuel", "infrastructure"]:
                key = f"{carrier}_{stype}"
                existing = session.query(FreightSurchargeConfig).filter_by(
                    carrier=carrier, surcharge_type=stype
                ).one_or_none()
                if existing is None:
                    session.add(FreightSurchargeConfig(
                        carrier=carrier,
                        surcharge_type=stype,
                        calculation_type="percentage",
                        rate=0,
                        applies_to="base_freight",
                        enabled=True,
                        source_note="Default seed: 0%. Update when actual rates are confirmed.",
                    ))

        session.commit()
    finally:
        session.close()
        SessionLocal.remove()


if __name__ == "__main__":
    seed()
    print("seed data applied: admin, exchange rates, materials, quote factors")
