"""Version-2 API router.

V2 is deliberately registered from its own route modules.  Reusing services is
fine; mounting the V1 router under ``/api/v2`` is not, because that silently
exposes legacy contracts to the new client.
"""

from fastapi import APIRouter

from app.api.v2.activities import router as activities_v2_router


api_router = APIRouter()
api_router.include_router(activities_v2_router)
