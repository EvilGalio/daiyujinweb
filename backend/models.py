from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def local_now() -> datetime:
    return datetime.now().astimezone().replace(tzinfo=None)


class AdminUser(Base, TimestampMixin):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)


class Material(Base, TimestampMixin):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    density_gcm3: Mapped[float] = mapped_column(Float, nullable=False)
    unit_price_usd_kg: Mapped[float] = mapped_column(Float, nullable=False)
    category: Mapped[str | None] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ToleranceGrade(Base):
    __tablename__ = "tolerance_grades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    grade: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    factor: Mapped[float] = mapped_column(Float, nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)


class SurfaceTreatment(Base, TimestampMixin):
    __tablename__ = "surface_treatments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class QuantityTier(Base):
    __tablename__ = "quantity_tiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    min_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    max_qty: Mapped[int | None] = mapped_column(Integer)
    factor: Mapped[float] = mapped_column(Float, nullable=False)


class ExchangeRate(Base, TimestampMixin):
    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    to_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    rate: Mapped[float] = mapped_column(Float, nullable=False)


# ═══════════════════════════════════════════
# Freight v2 tables
# ═══════════════════════════════════════════


class FreightZone(Base):
    """Country → carrier zone/code mapping."""
    __tablename__ = "freight_zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    carrier: Mapped[str] = mapped_column(String(40), nullable=False)
    country: Mapped[str] = mapped_column(String(160), nullable=False)
    country_cn: Mapped[str | None] = mapped_column(String(160))
    zone_code: Mapped[str] = mapped_column(String(40), nullable=False)
    source_sheet: Mapped[str | None] = mapped_column(String(80))
    source_row: Mapped[int | None] = mapped_column(Integer)


class FreightRateCard(Base):
    """Unified rate card: small matrix, document, heavy per-kg."""
    __tablename__ = "freight_rate_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    carrier: Mapped[str] = mapped_column(String(40), nullable=False)
    cargo_type: Mapped[str] = mapped_column(String(20), default="package", nullable=False)
    pricing_mode: Mapped[str] = mapped_column(String(40), nullable=False)
    zone_code: Mapped[str] = mapped_column(String(40), nullable=False)
    weight_min: Mapped[float] = mapped_column(Float, nullable=False)
    weight_max: Mapped[float | None] = mapped_column(Float)
    charge_weight: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="CNY", nullable=False)
    price_type: Mapped[str] = mapped_column(String(10), default="fixed", nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    source_sheet: Mapped[str | None] = mapped_column(String(80))
    source_row: Mapped[int | None] = mapped_column(Integer)


class FreightRuleConfig(Base):
    """Tunable rules (thresholds, packaging, currency)."""
    __tablename__ = "freight_rule_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    value_type: Mapped[str] = mapped_column(String(20), default="string", nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))


class FreightSurchargeConfig(Base):
    """Fuel, infrastructure, and other surcharges."""
    __tablename__ = "freight_surcharge_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    carrier: Mapped[str] = mapped_column(String(40), nullable=False)
    surcharge_type: Mapped[str] = mapped_column(String(40), nullable=False)
    calculation_type: Mapped[str] = mapped_column(String(20), nullable=False)
    rate: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    fixed_amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="CNY")
    applies_to: Mapped[str] = mapped_column(String(40), default="base_freight", nullable=False)
    effective_from: Mapped[str | None] = mapped_column(String(20))
    effective_to: Mapped[str | None] = mapped_column(String(20))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_note: Mapped[str | None] = mapped_column(String(255))


# ═══════════════════════════════════════════
# DHL-only tables (A重量运费重制版.xlsx)
# ═══════════════════════════════════════════


class DhlZone(Base):
    __tablename__ = "dhl_zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    country: Mapped[str] = mapped_column(String(160), nullable=False)
    country_cn: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_code: Mapped[str] = mapped_column(String(10), nullable=False)


class DhlSmallRate(Base):
    __tablename__ = "dhl_small_rates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    country: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_code: Mapped[str] = mapped_column(String(10), nullable=False)
    charge_weight: Mapped[float] = mapped_column(Float, nullable=False)
    base_price_cny: Mapped[float] = mapped_column(Float, nullable=False)


class DhlHeavyRate(Base):
    __tablename__ = "dhl_heavy_rates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)
    zone_text: Mapped[str] = mapped_column(String(10), nullable=False)
    base_unit_price_cny: Mapped[float] = mapped_column(Float, nullable=False)


class DhlConfig(Base):
    __tablename__ = "dhl_configs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))


class FreightRate(Base, TimestampMixin):
    __tablename__ = "freight_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    carrier: Mapped[str] = mapped_column(String(40), nullable=False)
    country: Mapped[str] = mapped_column(String(160), nullable=False)
    country_cn: Mapped[str | None] = mapped_column(String(160))
    zone: Mapped[str | None] = mapped_column(String(40))
    currency: Mapped[str] = mapped_column(String(3), default="CNY", nullable=False)
    weight_min: Mapped[float] = mapped_column(Float, nullable=False)
    weight_max: Mapped[float | None] = mapped_column(Float)
    base_price: Mapped[float] = mapped_column(Float, nullable=False)
    unit_price: Mapped[float | None] = mapped_column(Float)
    first_weight: Mapped[float | None] = mapped_column(Float)
    est_transit_days: Mapped[str | None] = mapped_column(String(80))
    source_sheet: Mapped[str | None] = mapped_column(String(80))
    source_row: Mapped[int | None] = mapped_column(Integer)


class SizeCost(Base):
    __tablename__ = "size_costs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    max_dim_mm: Mapped[float] = mapped_column(Float, nullable=False)
    base_cost_usd: Mapped[float] = mapped_column(Float, nullable=False)


class Inquiry(Base):
    __tablename__ = "inquiries"

    part_name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=local_now)
    customer_name: Mapped[str | None] = mapped_column(String(120))
    customer_email: Mapped[str | None] = mapped_column(String(255))
    quantity: Mapped[int | None] = mapped_column(Integer)

    # ── business fields ──
    material_name: Mapped[str | None] = mapped_column(String(160))
    volume_mm3: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    max_dim_mm: Mapped[float | None] = mapped_column(Float)
    tolerance_grade: Mapped[str | None] = mapped_column(String(20))
    total_usd: Mapped[float | None] = mapped_column(Float)
    total_display: Mapped[str | None] = mapped_column(String(40))
    currency: Mapped[str | None] = mapped_column(String(3))
    batch_id: Mapped[str | None] = mapped_column(String(80))
    batch_item_id: Mapped[str | None] = mapped_column(String(80))
    batch_item_index: Mapped[int | None] = mapped_column(Integer)
    batch_item_count: Mapped[int | None] = mapped_column(Integer)

    # ── audit fields ──
    stp_filename: Mapped[str | None] = mapped_column(String(255))
    client_ip: Mapped[str | None] = mapped_column(String(80))
    user_agent: Mapped[str | None] = mapped_column(String(255))

    # ── raw snapshots (debug / replay) ──
    input_params: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    record_id: Mapped[int] = mapped_column(Integer, primary_key=True)


# ═══════════════════════════════════════════
# Admin Console tables
# ═══════════════════════════════════════════

class AppSetting(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(String(80), nullable=False, default="global")
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    value_type: Mapped[str] = mapped_column(String(20), nullable=False, default="string")
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str | None] = mapped_column(String(255))
    updated_by: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    admin_username: Mapped[str | None] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(80))
    target_key: Mapped[str | None] = mapped_column(String(180))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    client_ip: Mapped[str | None] = mapped_column(String(80))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
