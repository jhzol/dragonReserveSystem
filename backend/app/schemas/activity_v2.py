from __future__ import annotations

"""Version-2 activity schemas with an explicit cover instead of activity type."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.activity import (
    ActivityParticipantResponse,
    ActivityWeatherResponse,
    MAX_ACTIVITY_NAME_LENGTH,
    MAX_ACTIVITY_REMARK_LENGTH,
    _validate_required_text,
)
from app.services.activity_cover_service import require_activity_cover_id


class ActivityCoverArtworkResponse(BaseModel):
    id: str
    artist_slug: str
    artist_name: str
    artist_avatar_url: str
    width: int
    height: int
    thumbnail_url: str
    image_url: str
    large_card_glass_image_url: str


class ActivityCoverArtistResponse(BaseModel):
    slug: str
    display_name: str
    avatar_url: str
    artworks: list[ActivityCoverArtworkResponse]


class ActivityV2Response(BaseModel):
    """Activity payload for the cover-based client."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: str
    remark: str
    max_participants: Optional[int]
    start_time: datetime
    end_time: datetime
    signup_deadline: Optional[datetime]
    signup_enabled: bool
    location_name: str
    location_address: str
    location_latitude: Optional[float]
    location_longitude: Optional[float]
    created_by: int
    created_at: datetime
    updated_at: datetime
    participants: list[ActivityParticipantResponse]
    activity_cover_id: str
    activity_cover: Optional[ActivityCoverArtworkResponse] = None


class ActivityDetailV2Response(ActivityV2Response):
    weather: ActivityWeatherResponse


class ActivityCreateV2Request(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_ACTIVITY_NAME_LENGTH)
    remark: str = Field(min_length=1, max_length=MAX_ACTIVITY_REMARK_LENGTH)
    max_participants: Optional[int] = Field(default=None, ge=1, le=999)
    start_time: datetime
    end_time: datetime
    signup_deadline: Optional[datetime] = None
    signup_enabled: bool = Field(default=True)
    activity_cover_id: str = Field(min_length=1, max_length=96)
    location_name: str = Field(default="", max_length=255)
    location_address: str = Field(default="", max_length=255)
    location_latitude: Optional[float] = None
    location_longitude: Optional[float] = None

    @field_validator("name", "remark", mode="before")
    @classmethod
    def validate_required_text(cls, value: object, info) -> object:
        return _validate_required_text(value, info.field_name)

    @field_validator("activity_cover_id")
    @classmethod
    def validate_cover(cls, value: str) -> str:
        return require_activity_cover_id(value)

    @field_validator("end_time")
    @classmethod
    def validate_end_time(cls, value: datetime, info) -> datetime:
        start_time = info.data.get("start_time")
        if start_time and value <= start_time:
            raise ValueError("end_time must be later than start_time")
        return value

    @field_validator("signup_deadline")
    @classmethod
    def validate_signup_deadline(cls, value: Optional[datetime], info) -> Optional[datetime]:
        start_time = info.data.get("start_time")
        if value and start_time and value > start_time:
            raise ValueError("signup_deadline must be earlier than or equal to start_time")
        return value

class ActivityUpdateV2Request(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ACTIVITY_NAME_LENGTH)
    remark: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ACTIVITY_REMARK_LENGTH)
    max_participants: Optional[int] = Field(default=None, ge=1, le=999)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    signup_deadline: Optional[datetime] = None
    signup_enabled: Optional[bool] = None
    activity_cover_id: Optional[str] = Field(default=None, min_length=1, max_length=96)
    location_name: Optional[str] = Field(default=None, max_length=255)
    location_address: Optional[str] = Field(default=None, max_length=255)
    location_latitude: Optional[float] = None
    location_longitude: Optional[float] = None

    @field_validator("name", "remark", mode="before")
    @classmethod
    def validate_required_text(cls, value: object, info) -> object:
        return _validate_required_text(value, info.field_name)

    @field_validator("activity_cover_id", mode="before")
    @classmethod
    def validate_cover(cls, value: object) -> str:
        if value is None:
            raise ValueError("activity_cover_id cannot be cleared")
        return require_activity_cover_id(str(value))
