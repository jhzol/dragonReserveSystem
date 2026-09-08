"""Persistent weather snapshots attached to activities."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ActivityWeatherSnapshot(Base):
    """One server-generated weather snapshot per activity."""

    __tablename__ = "activity_weather_snapshots"
    __table_args__ = (
        Index("ix_activity_weather_next_refresh_at", "next_refresh_at"),
        Index("ix_activity_weather_location_key", "location_key"),
        Index("ix_activity_weather_status", "status"),
    )

    activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True
    )
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    location_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    source_latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    source_longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    temperature_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    temperature_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    condition: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    icon_code: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    humidity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    wind_direction: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    wind_scale: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    air_quality: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    attribution: Mapped[str] = mapped_column(String(128), nullable=False, default="天气服务驱动 by QWeather")
    fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_refresh_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    activity = relationship("Activity", back_populates="weather_snapshot")
