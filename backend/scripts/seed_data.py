from __future__ import annotations

import sys
from pathlib import Path

from werkzeug.security import generate_password_hash

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import DATA_DIR, SessionLocal, init_db
from models import AdminUser, ExchangeRate, Material, QuantityTier, SizeCost, SurfaceTreatment, ToleranceGrade


def seed() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_db()

    session = SessionLocal()
    try:
        admin = session.query(AdminUser).filter_by(username="admin").one_or_none()
        if admin is None:
            session.add(
                AdminUser(
                    username="admin",
                    password_hash=generate_password_hash("change-me-before-production"),
                )
            )

        rates = [
            ("USD", "USD", 1.0),
            ("USD", "CNY", 7.20),
            ("USD", "EUR", 0.92),
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
            ("Aluminum 6061-T6", 2.70, 6.50, "Aluminum"),
            ("Stainless Steel 304", 7.93, 5.80, "Stainless Steel"),
            ("Carbon Steel AISI 1045", 7.85, 3.20, "Carbon Steel"),
            ("Brass C360", 8.50, 8.40, "Copper Alloy"),
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
            ("IT6", 1.35, "IT6 - high precision machining"),
            ("IT7", 1.18, "IT7 - precision machining"),
            ("IT8", 1.00, "IT8 - standard machining"),
            ("IT9", 0.92, "IT9 - general machining"),
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
            ("Clear anodizing", 1.20),
            ("Black anodizing", 1.45),
            ("Bead blasting", 0.85),
            ("Passivation", 1.10),
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
    finally:
        session.close()
        SessionLocal.remove()


if __name__ == "__main__":
    seed()
    print("seed data applied: admin, exchange rates, materials, quote factors")
