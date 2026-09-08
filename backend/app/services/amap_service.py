"""Amap (Gaode) reverse-geocoding integration for check-in locations."""

from __future__ import annotations

from dataclasses import dataclass
import logging
import math
from typing import Any

import httpx

from app.core.config import get_settings


logger = logging.getLogger("dragon.reserve")


@dataclass(frozen=True)
class ReverseGeocodeResult:
    """Persistable location fields resolved from a GCJ-02 coordinate."""

    location_name: str | None = None
    address: str | None = None


def _text(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _distance(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def _closest_location_name(regeocode: dict[str, Any]) -> str | None:
    """Pick the nearest usable POI/AOI name, preferring AOI only when distance is absent."""

    with_distance: list[tuple[float, int, str]] = []
    aois_without_distance: list[str] = []
    pois_without_distance: list[str] = []

    for source_priority, (kind, entries) in enumerate(
        (("aoi", regeocode.get("aois")), ("poi", regeocode.get("pois")))
    ):
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            name = _text(entry.get("name"))
            if not name:
                continue
            distance = _distance(entry.get("distance"))
            if distance is not None:
                with_distance.append((distance, source_priority, name))
            elif kind == "aoi":
                aois_without_distance.append(name)
            else:
                pois_without_distance.append(name)

    if with_distance:
        return min(with_distance, key=lambda item: (item[0], item[1]))[2]
    if aois_without_distance:
        return aois_without_distance[0]
    if pois_without_distance:
        return pois_without_distance[0]
    return None


def parse_reverse_geocode_payload(payload: object) -> ReverseGeocodeResult:
    """Extract only the two nullable fields the application persists."""

    if not isinstance(payload, dict) or str(payload.get("status")) != "1":
        return ReverseGeocodeResult()
    regeocode = payload.get("regeocode")
    if not isinstance(regeocode, dict):
        return ReverseGeocodeResult()
    return ReverseGeocodeResult(
        location_name=_closest_location_name(regeocode),
        address=_text(regeocode.get("formatted_address")),
    )


def reverse_geocode(*, lat: float, lng: float) -> ReverseGeocodeResult:
    """Resolve GCJ-02 latitude/longitude without ever exposing the Web-service key."""

    settings = get_settings()
    key = str(settings.amap_web_service_key or "").strip()
    if not key:
        return ReverseGeocodeResult()

    coordinates = (lat, lng)
    if not all(isinstance(value, (int, float)) and math.isfinite(float(value)) for value in coordinates):
        return ReverseGeocodeResult()

    timeout_seconds = max(0.1, float(settings.amap_timeout_seconds or 5))
    try:
        response = httpx.get(
            settings.amap_regeocode_url,
            params={
                "key": key,
                "location": f"{lng},{lat}",
                "extensions": "all",
                "radius": 1000,
            },
            timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 3.0)),
        )
        response.raise_for_status()
        return parse_reverse_geocode_payload(response.json())
    except (httpx.HTTPError, ValueError, TypeError):
        logger.warning(
            "Amap reverse geocode unavailable",
            extra={"lat": lat, "lng": lng},
        )
        return ReverseGeocodeResult()
