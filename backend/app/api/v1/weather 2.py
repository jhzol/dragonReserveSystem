"""Legacy weather compatibility endpoint backed only by persisted snapshots."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.activity_weather_service import get_snapshot_by_location_and_date

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("/activity")
def get_activity_weather(
    longitude: float = Query(ge=-180, le=180),
    latitude: float = Query(ge=-90, le=90),
    target_date: date = Query(alias="date"),
    db: Session = Depends(get_db),
) -> dict:
    """Read a cached weather snapshot; this route never calls QWeather."""

    return get_snapshot_by_location_and_date(
        db, longitude=longitude, latitude=latitude, target_date=target_date
    )
