"""Top-level router for API v1."""

from fastapi import APIRouter

from app.api.v1.activities import router as activities_router
from app.api.v1.auth import router as auth_router
from app.api.v1.client_config import router as client_config_router
from app.api.v1.diagnostics import router as diagnostics_router
from app.api.v1.health import router as health_router
from app.api.v1.stats import router as stats_router
from app.api.v1.users import router as users_router
from app.api.v1.weather import router as weather_router


api_router = APIRouter()
api_router.include_router(activities_router)
api_router.include_router(auth_router)
api_router.include_router(client_config_router)
api_router.include_router(diagnostics_router)
api_router.include_router(health_router)
api_router.include_router(stats_router)
api_router.include_router(users_router)
api_router.include_router(weather_router)
