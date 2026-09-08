"""Statistics routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_optional_current_user
from app.core.database import get_db
from app.models import User
from app.schemas.stats import (
    ActivityRankingResponse,
    HistorySummaryResponse,
    PigeonRankingResponse,
    PigeonStatResponse,
)
from app.services.stats_service import (
    get_activity_ranking,
    get_ended_activity_count,
    get_pigeon_ranking,
    get_pigeon_stats,
)


router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/history-summary", response_model=HistorySummaryResponse, summary="Get history summary")
def get_history_summary(
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> HistorySummaryResponse:
    """Return lightweight history-page counts without serializing all activities."""

    return HistorySummaryResponse(ended_activity_count=get_ended_activity_count(db))


@router.get("/history", response_model=list[PigeonStatResponse], summary="Get pigeon ranking")
def get_history_stats(
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> list[PigeonStatResponse]:
    """Return signup/checkin ranking stats."""

    return get_pigeon_stats(db)


@router.get(
    "/ranking/activity",
    response_model=list[ActivityRankingResponse],
    summary="Get activity ranking",
)
def get_activity_rankings(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=8, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> list[ActivityRankingResponse]:
    ranking = get_activity_ranking(db)
    return ranking[offset : offset + limit]


@router.get(
    "/ranking/pigeon",
    response_model=list[PigeonRankingResponse],
    summary="Get pigeon-count ranking",
)
def get_pigeon_rankings(
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> list[PigeonRankingResponse]:
    return [item for item in get_pigeon_ranking(db) if item.pigeon_count > 0][:8]
