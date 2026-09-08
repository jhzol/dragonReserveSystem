"""Cover-aware activity endpoints for the new client."""

import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_optional_current_user,
    require_admin,
    require_activity_create_permission,
    require_activity_signup_permission,
)
from app.core.database import get_db
from app.core.exceptions import PermissionDeniedError
from app.core.config import get_settings
from app.core.logging import logger
from app.models import Activity, ActivityParticipant, User
from app.schemas.activity import (
    ActivityCheckinRequest,
    ActivitySharePreviewResponse,
    ActivitySignupResponse,
)
from app.schemas.activity_v2 import (
    ActivityCoverArtistResponse,
    ActivityCreateV2Request,
    ActivityDetailV2Response,
    ActivityUpdateV2Request,
    ActivityV2Response,
)
from app.services.activity_cover_service import get_activity_cover, list_activity_cover_artists
from app.services.activity_card_glass_service import (
    ActivityCardGlassNotFoundError,
    get_or_create_activity_cover_card_glass,
)
from app.services.activity_service import (
    _app_now,
    _sync_activity_status,
    admin_cancel_checkin_participant,
    admin_checkin_participant,
    cancel_activity,
    checkin_activity,
    delete_activity,
    get_activity_by_id,
    list_activities,
    list_my_activities,
    remove_participant,
    signup_activity,
    update_activity,
)
from app.services.activity_share_preview_service import get_or_create_activity_share_preview
from app.services.activity_weather_service import ensure_weather_snapshot, get_activity_weather_snapshot


router = APIRouter(tags=["activities-v2"])
settings = get_settings()


def _base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def _absolute_media_url(request: Request, image_url: str | None) -> str | None:
    if not image_url:
        return None
    if image_url.startswith("http://") or image_url.startswith("https://"):
        return image_url
    base_url = (settings.public_base_url or str(request.base_url)).rstrip("/")
    return f"{base_url}{image_url}"


def _response(activity: Activity, request: Request) -> ActivityV2Response:
    payload = ActivityV2Response.model_validate(activity, from_attributes=True).model_dump()
    payload["activity_cover"] = get_activity_cover(activity.activity_cover_id, _base_url(request))
    return ActivityV2Response(**payload)


def _require_activity_manager(activity: Activity, user: User) -> None:
    if user.role == "admin" or activity.created_by == user.id:
        return
    raise PermissionDeniedError("You can only manage activities you created")


@router.get("/activity-covers", response_model=list[ActivityCoverArtistResponse])
def get_activity_covers(
    request: Request,
    _: User | None = Depends(get_optional_current_user),
) -> list[ActivityCoverArtistResponse]:
    return [
        ActivityCoverArtistResponse.model_validate(item)
        for item in list_activity_cover_artists(_base_url(request))
    ]


@router.get(
    "/activity-covers/{cover_id}/glass-image",
    response_class=FileResponse,
    summary="Get a pre-rendered large-card glass image for a v2 cover",
)
def get_activity_cover_glass_image(
    cover_id: str,
    _: User | None = Depends(get_optional_current_user),
) -> FileResponse:
    try:
        image_path = get_or_create_activity_cover_card_glass(cover_id)
    except ActivityCardGlassNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        image_path,
        media_type=mimetypes.guess_type(image_path.name)[0] or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )


@router.get("/activities", response_model=list[ActivityV2Response])
def get_activities_v2(
    request: Request,
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> list[ActivityV2Response]:
    return [_response(activity, request) for activity in list_activities(db)]


@router.get("/activities/me/signed-up", response_model=list[ActivityV2Response])
def get_my_activities_v2(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ActivityV2Response]:
    return [_response(activity, request) for activity in list_my_activities(db, current_user)]


@router.get("/activities/{activity_id}", response_model=ActivityDetailV2Response)
def get_activity_v2(
    activity_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> ActivityDetailV2Response:
    activity = get_activity_by_id(db, activity_id)
    payload = _response(activity, request).model_dump()
    return ActivityDetailV2Response(
        **payload,
        weather=get_activity_weather_snapshot(db, activity.id),
    )


@router.post("/activities", response_model=ActivityV2Response, status_code=status.HTTP_201_CREATED)
def post_activity_v2(
    payload: ActivityCreateV2Request,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_activity_create_permission),
) -> ActivityV2Response:
    activity = Activity(
        **payload.model_dump(),
        status="未开始",
        activity_type=None,
        activity_style_key=None,
        created_by=current_user.id,
    )
    db.add(activity)
    db.flush()
    _sync_activity_status(activity, _app_now())
    db.add(
        ActivityParticipant(
            activity_id=activity.id,
            user_id=current_user.id,
            display_nickname=current_user.nickname,
            display_avatar_url=current_user.avatar_url,
        )
    )
    ensure_weather_snapshot(db, activity)
    db.commit()
    return _response(get_activity_by_id(db, activity.id), request)


@router.post("/activities/{activity_id}/cancel", response_model=ActivityV2Response)
def post_cancel_activity_v2(
    activity_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActivityV2Response:
    activity = get_activity_by_id(db, activity_id)
    _require_activity_manager(activity, current_user)
    return _response(cancel_activity(db, activity), request)


@router.delete("/activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity_v2(
    activity_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    activity = get_activity_by_id(db, activity_id)
    delete_activity(db, activity)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/activities/{activity_id}/signup", response_model=ActivitySignupResponse)
def post_signup_v2(
    activity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_activity_signup_permission),
) -> ActivitySignupResponse:
    activity = get_activity_by_id(db, activity_id)
    participant = signup_activity(db, activity, current_user)
    return ActivitySignupResponse(
        activity_id=activity.id,
        participant_id=participant.id,
        status="signed_up",
    )


@router.post("/activities/{activity_id}/checkin", response_model=ActivitySignupResponse)
def post_checkin_v2(
    activity_id: int,
    payload: ActivityCheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActivitySignupResponse:
    activity = get_activity_by_id(db, activity_id)
    participant = checkin_activity(db, activity, current_user, payload)
    return ActivitySignupResponse(
        activity_id=activity.id,
        participant_id=participant.id,
        status="checked_in",
    )


@router.get(
    "/activities/{activity_id}/share-preview",
    response_model=ActivitySharePreviewResponse,
)
def get_activity_share_preview_v2(
    activity_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> ActivitySharePreviewResponse:
    activity = get_activity_by_id(db, activity_id)
    try:
        result = get_or_create_activity_share_preview(activity)
    except Exception as exc:
        logger.exception(
            "activity_share_preview_failed activity_id=%s summary=%s",
            activity_id,
            str(exc) or exc.__class__.__name__,
        )
        return ActivitySharePreviewResponse(status="failed", image_url=None)
    return ActivitySharePreviewResponse(
        status=result.status,
        image_url=_absolute_media_url(request, result.image_url),
    )


@router.patch("/activities/{activity_id}", response_model=ActivityV2Response)
def patch_activity_v2(
    activity_id: int,
    payload: ActivityUpdateV2Request,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActivityV2Response:
    activity = get_activity_by_id(db, activity_id)
    _require_activity_manager(activity, current_user)
    return _response(update_activity(db, activity, payload), request)


@router.delete(
    "/activities/{activity_id}/participants/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_participant_v2(
    activity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    activity = get_activity_by_id(db, activity_id)
    participant = next((item for item in activity.participants if item.id == participant_id), None)
    if participant is None:
        # Let the service return the canonical not-found response.
        remove_participant(db, activity, participant_id, current_user, allow_activity_owner=True)
    elif participant.user_id != current_user.id:
        _require_activity_manager(activity, current_user)
    remove_participant(db, activity, participant_id, current_user, allow_activity_owner=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/activities/{activity_id}/participants/{participant_id}/admin-checkin",
    response_model=ActivitySignupResponse,
)
def post_manager_checkin_participant_v2(
    activity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ActivitySignupResponse:
    activity = get_activity_by_id(db, activity_id)
    participant = admin_checkin_participant(
        db,
        activity,
        participant_id,
        current_user,
    )
    return ActivitySignupResponse(
        activity_id=activity.id,
        participant_id=participant.id,
        status="checked_in",
    )


@router.delete(
    "/activities/{activity_id}/participants/{participant_id}/admin-checkin",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_manager_checkin_participant_v2(
    activity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    activity = get_activity_by_id(db, activity_id)
    admin_cancel_checkin_participant(
        db,
        activity,
        participant_id,
        current_user,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
