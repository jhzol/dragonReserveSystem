"""Pure QWeather response parsing helpers."""

from __future__ import annotations

from datetime import date
from typing import Any


def as_number(value: Any) -> int | float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


def extract_daily_weather(payload: dict[str, Any], target_date: date) -> dict[str, Any] | None:
    target = target_date.isoformat()
    for item in payload.get("daily") or []:
        if str(item.get("fxDate") or item.get("date") or "") != target:
            continue
        temp_min = as_number(item.get("tempMin"))
        temp_max = as_number(item.get("tempMax"))
        return {
            "temperature": temp_max if temp_max is not None else temp_min,
            "temperature_min": temp_min,
            "temperature_max": temp_max,
            "condition": str(item.get("textDay") or item.get("textNight") or ""),
            "icon_code": str(item.get("iconDay") or item.get("iconNight") or ""),
            "humidity": as_number(item.get("humidity")),
            "wind_direction": str(item.get("windDirDay") or item.get("windDirNight") or ""),
            "wind_scale": str(item.get("windScaleDay") or item.get("windScaleNight") or ""),
        }
    return None


def extract_air_quality(payload: dict[str, Any], target_date: date) -> str | None:
    target = target_date.isoformat()
    for item in payload.get("days") or payload.get("daily") or []:
        item_date = str(item.get("forecastStartTime") or item.get("fxDate") or item.get("date") or "")[:10]
        if item_date != target:
            continue
        indexes = item.get("indexes") or item.get("indices") or []
        preferred = next(
            (index for index in indexes if str(index.get("code") or "").lower() in {"cn-mee-1h", "cn-mee"}),
            None,
        )
        index = preferred or (indexes[0] if indexes else None)
        if not index:
            return None
        category = str(index.get("category") or index.get("name") or "").strip()
        aqi = str(index.get("aqiDisplay") or index.get("aqi") or "").strip()
        return f"{category} {aqi}" if category and aqi and category != aqi else (category or aqi or None)
    return None
