from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # ── business fields ──
    material_name: Mapped[str | None] = mapped_column(String(160))
    volume_mm3: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    max_dim_mm: Mapped[float | None] = mapped_column(Float)
    tolerance_grade: Mapped[str | None] = mapped_column(String(20))
    quantity: Mapped[int | None] = mapped_column(Integer)
    total_usd: Mapped[float | None] = mapped_column(Float)
    total_display: Mapped[str | None] = mapped_column(String(40))
    currency: Mapped[str | None] = mapped_column(String(3))

    # ── audit fields ──
    stp_filename: Mapped[str | None] = mapped_column(String(255))
    stp_file_path: Mapped[str | None] = mapped_column(String(500))
    client_ip: Mapped[str | None] = mapped_column(String(80))
    user_agent: Mapped[str | None] = mapped_column(String(255))

    # ── raw snapshots (debug / replay) ──
    input_params: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[str] = mapped_column(Text, nullable=False)
