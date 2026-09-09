"""Logging helpers for request tracing."""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import Request

logger = logging.getLogger("dragon.reserve")


if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


_test_log_file = os.getenv("TEST_REQUEST_LOG_FILE", "").strip()
if _test_log_file:
    test_log_path = Path(_test_log_file).expanduser()
    test_log_path.parent.mkdir(parents=True, exist_ok=True)
    test_handler = logging.FileHandler(test_log_path, encoding="utf-8")
    test_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    logger.addHandler(test_handler)
    logger.setLevel(logging.INFO)


def ensure_trace_id(request: Request) -> str:
    """Get or create a trace id for the current request."""

    trace_id = getattr(request.state, "trace_id", "") or request.headers.get("x-request-id")
    if not isinstance(trace_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", trace_id):
        trace_id = uuid.uuid4().hex
    request.state.trace_id = trace_id
    return trace_id


def request_context(request: Request) -> dict[str, Any]:
    start_time = getattr(request.state, "request_started_at", None)
    duration_ms = round((time.perf_counter() - start_time) * 1000, 2) if start_time else None
    return {
        "method": request.method,
        "path": request.url.path,
        "query": str(request.url.query or ""),
        "trace_id": ensure_trace_id(request),
        "duration_ms": duration_ms,
    }


def error_summary(exc: Exception) -> str:
    return str(exc) or exc.__class__.__name__
