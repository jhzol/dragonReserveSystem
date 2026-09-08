from __future__ import annotations

"""Statistics schemas."""

from datetime import date

from pydantic import BaseModel


class ActivityHeatmapDayResponse(BaseModel):
    """One day in the 12-week attendance heatmap."""

    date: date
    duration_hours: float
    level: int


class ActivityRankingResponse(BaseModel):
    """Attendance ranking and recent activity for one user."""

    user_id: int
    nickname: str
    avatar_url: str
    checkin_count: int
    attendance_days: int
    heatmap: list[ActivityHeatmapDayResponse]


class PigeonStatResponse(BaseModel):
    """Signup/checkin summary for one user."""

    user_id: int
    nickname: str
    signup_count: int
    checkin_count: int
    pigeon_count: int
    pigeon_rate: float


class PigeonRankingResponse(BaseModel):
    """Pigeon ranking item returned by the new ranking endpoint."""

    user_id: int
    nickname: str
    avatar_url: str
    signup_count: int
    checkin_count: int
    pigeon_count: int
    pigeon_rate: float


class HistorySummaryResponse(BaseModel):
    """Small summary displayed above the history ranking."""

    ended_activity_count: int
