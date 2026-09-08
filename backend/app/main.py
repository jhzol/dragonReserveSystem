"""FastAPI application entrypoint."""

from pathlib import Path

from fastapi import HTTPException, Request
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import api_router
from app.api.v2 import api_router as api_v2_router
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.logging import error_summary, logger, request_context
from app.middleware import RequestContextMiddleware


settings = get_settings()
media_root = Path(settings.media_root).resolve()
media_root.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount(settings.media_url_prefix, StaticFiles(directory=media_root), name="media")
activity_cover_assets = Path(__file__).resolve().parent / "assets" / "activity-covers"
app.mount(
    "/activity-cover-assets",
    StaticFiles(directory=activity_cover_assets),
    name="activity-cover-assets",
)


@app.exception_handler(AppError)
def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Render application errors with a stable response shape."""

    context = request_context(request)
    logger.warning(
        "app_error method=%s path=%s duration_ms=%s trace_id=%s code=%s summary=%s",
        context["method"],
        context["path"],
        context["duration_ms"],
        context["trace_id"],
        exc.code,
        exc.message,
    )
    response = JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "request_id": context["trace_id"]},
    )
    response.headers["X-Request-Id"] = context["trace_id"]
    return response


@app.exception_handler(RequestValidationError)
def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Render request validation errors in the common error shape."""

    first_error = exc.errors()[0] if exc.errors() else None
    message = first_error.get("msg", "Invalid request") if first_error else "Invalid request"
    context = request_context(request)
    logger.warning(
        "validation_error method=%s path=%s duration_ms=%s trace_id=%s summary=%s",
        context["method"],
        context["path"],
        context["duration_ms"],
        context["trace_id"],
        message,
    )
    response = JSONResponse(
        status_code=422,
        content={"code": "REQUEST_VALIDATION_ERROR", "message": message, "request_id": context["trace_id"]},
    )
    response.headers["X-Request-Id"] = context["trace_id"]
    return response


@app.exception_handler(HTTPException)
def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Normalize fallback HTTP errors."""

    message = exc.detail if isinstance(exc.detail, str) else "Request failed"
    context = request_context(request)
    logger.warning(
        "http_error method=%s path=%s duration_ms=%s trace_id=%s summary=%s",
        context["method"],
        context["path"],
        context["duration_ms"],
        context["trace_id"],
        message,
    )
    response = JSONResponse(
        status_code=exc.status_code,
        content={"code": "HTTP_ERROR", "message": message, "request_id": context["trace_id"]},
    )
    response.headers["X-Request-Id"] = context["trace_id"]
    return response


@app.exception_handler(Exception)
def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    context = request_context(request)
    logger.exception(
        "unhandled_error method=%s path=%s duration_ms=%s trace_id=%s summary=%s",
        context["method"],
        context["path"],
        context["duration_ms"],
        context["trace_id"],
        error_summary(exc),
    )
    response = JSONResponse(
        status_code=500,
        content={"code": "INTERNAL_SERVER_ERROR", "message": "Internal server error", "request_id": context["trace_id"]},
    )
    response.headers["X-Request-Id"] = context["trace_id"]
    return response


app.include_router(api_router, prefix=settings.api_v1_prefix)
app.include_router(api_v2_router, prefix=settings.api_v2_prefix)
