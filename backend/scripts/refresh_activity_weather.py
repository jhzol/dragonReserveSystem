#!/usr/bin/env python3
"""Run one safe, deduplicated weather-snapshot refresh pass."""

from __future__ import annotations

import time

from app.core.database import SessionLocal
from app.core.logging import logger
from app.services.activity_weather_service import ActivityWeatherRefreshService


def main() -> int:
    started = time.monotonic()
    with SessionLocal() as db:
        service = ActivityWeatherRefreshService(db)
        stats = service.refresh_due()
        service.client.close()
    stats["duration_ms"] = round((time.monotonic() - started) * 1000)
    logger.info("weather_refresh_summary %s", " ".join(f"{key}={value}" for key, value in sorted(stats.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
