"""Legacy compatibility façade. Activity pages must use persisted snapshots instead."""

from __future__ import annotations

from datetime import date
from functools import lru_cache
from typing import Any

from app.services.qweather_client import QWeatherClient
from app.services.qweather_parser import extract_air_quality, extract_daily_weather

ATTRIBUTION = "天气服务驱动 by QWeather"


class QWeatherService:
    """Deprecated direct client retained only for isolated compatibility callers/tests."""

    def __init__(self) -> None:
        self.client = QWeatherClient()

    def get_activity_weather(self, *, longitude: float, latitude: float, target_date: date) -> dict[str, Any]:
        if not self.client.is_configured():
            return {"available": False, "reason": "service_unconfigured", "attribution": ATTRIBUTION}
        try:
            daily = extract_daily_weather(self.client.get_daily_weather(longitude=longitude, latitude=latitude), target_date)
            if daily is None:
                return {"available": False, "reason": "forecast_out_of_range", "attribution": ATTRIBUTION}
            try:
                air_quality = extract_air_quality(
                    self.client.get_daily_air_quality(longitude=longitude, latitude=latitude), target_date
                )
            except Exception:
                air_quality = None
            return {"available": True, "date": target_date, **daily, "air_quality": air_quality, "attribution": ATTRIBUTION}
        except Exception:
            return {"available": False, "reason": "upstream_unavailable", "attribution": ATTRIBUTION}


@lru_cache
def get_qweather_service() -> QWeatherService:
    return QWeatherService()
