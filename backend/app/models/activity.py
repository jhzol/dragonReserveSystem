from __future__ import annotations

"""Activity models."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Activity(Base):
    """Activity aggregate root."""

    __tablename__ = "activities"
    __table_args__ = (
        Index("ix_activities_status", "status"),
        Index("ix_activities_start_time", "start_time"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="进行中")
    remark: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    max_participants: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=None)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    signup_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    signup_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    activity_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, default=None)
    activity_style_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, default=None)
    activity_cover_id: Mapped[str] = mapped_column(
        String(96),
        nullable=False,
        server_default="aleksey-rico-001",
    )
    location_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    location_address: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    location_latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    location_longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    participants: Mapped[list["ActivityParticipant"]] = relationship(
        back_populates="activity",
        cascade="all, delete-orphan",
    )
    weather_snapshot: Mapped[Optional["ActivityWeatherSnapshot"]] = relationship(
        back_populates="activity",
        cascade="all, delete-orphan",
        uselist=False,
    )


class ActivityParticipant(Base):
    """Participant record for an activity."""

    __tablename__ = "activity_participants"
    __table_args__ = (
        UniqueConstraint("activity_id", "user_id", name="uq_activity_participants_activity_user"),
        Index("ix_activity_participants_activity_id", "activity_id"),
        Index("ix_activity_participants_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    display_nickname: Mapped[str] = mapped_column(String(64), nullable=False)
    display_avatar_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    checkin_method: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    checkin_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    checkin_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    checkin_location_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    checkin_address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    activity: Mapped[Activity] = relationship(back_populates="participants")
