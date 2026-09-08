"""Activity routes."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_optional_current_user, require_admin, require_activity_signup_permission
from app.core.config import get_settings
from app.core.database import get_db
from app.core.logging import logger
from app.models import User
from app.schemas.activity import (
    ActivityCheckinRequest,
    ActivityCreateRequest,
    ActivityDetailResponse,
    ActivityResponse,
    ActivitySharePreviewResponse,
    ActivitySignupResponse,
    ActivityStyleSignatureResponse,
    ActivityTypeStyleResponse,
    ActivityUpdateRequest,
)
from app.services.activity_card_glass_service import (
    ActivityCardGlassNotFoundError,
    get_or_create_activity_card_glass,
)
from app.services.activity_type_style_service import list_activity_type_styles
from app.services.activity_weather_service import get_activity_weather_snapshot
from app.services.activity_share_preview_service import get_or_create_activity_share_preview
from app.services.activity_service import (
    admin_cancel_checkin_participant,
    admin_checkin_participant,
    cancel_signup,
    checkin_activity,
    create_activity,
    delete_activity,
    get_activity_by_id,
    get_activity_style_signature,
    list_activities,
    list_my_activities,
    remove_participant,
    signup_activity,
    update_activity,
)


router = APIRouter(prefix="/activities", tags=["activities"])
settings = get_settings()


def _absolute_media_url(request: Request, image_url: str | None) -> str | None:
    if not image_url:
        return None
    if image_url.startswith("http://") or image_url.startswith("https://"):
        return image_url
    base_url = (settings.public_base_url or str(request.base_url)).rstrip("/")
    return f"{base_url}{image_url}"


@router.get("", response_model=list[ActivityResponse], summary="List activities")
def get_activities(db: Session = Depends(get_db), _: User | None = Depends(get_optional_current_user)) -> list[ActivityResponse]:
    """Return all activities."""

    activities = list_activities(db)
    return [ActivityResponse.model_validate(activity, from_attributes=True) for activity in activities]


@router.get("/type-styles", response_model=list[ActivityTypeStyleResponse], summary="List activity type styles")
def get_activity_type_styles(_: User | None = Depends(get_optional_current_user)) -> list[ActivityTypeStyleResponse]:
    """Return backend-driven activity type/style config for the client."""

    return [ActivityTypeStyleResponse.model_validate(item) for item in list_activity_type_styles()]


@router.get(
    "/type-styles/{activity_type}/{style_key}/glass-image",
    response_class=FileResponse,
    summary="Get pre-rendered large-card glass image",
)
def get_activity_type_style_glass_image(
    activity_type: str,
    style_key: str,
    _: User | None = Depends(get_optional_current_user),
) -> FileResponse:
    """Return a server-rendered blur so clients do not run a live CSS filter."""

    try:
        image_path = get_or_create_activity_card_glass(activity_type, style_key)
    except ActivityCardGlassNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "activity_card_glass_failed activity_type=%s style_key=%s summary=%s",
            activity_type,
            style_key,
            str(exc) or exc.__class__.__name__,
        )
        raise HTTPException(status_code=502, detail="card glass image generation failed") from exc

    return FileResponse(
        image_path,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )


@router.get("/style-signature", response_model=ActivityStyleSignatureResponse, summary="Get activity style signature")
def get_style_signature(
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> ActivityStyleSignatureResponse:
    """Return global signature used by clients to decide style-resource refresh."""

    signature, count = get_activity_style_signature(db)
    return ActivityStyleSignatureResponse(signature=signature, activity_count=count)


@router.get("/me/signed-up", response_model=list[ActivityResponse], summary="List my signed-up activities")
@router.get("/mine", response_model=list[ActivityResponse], summary="List my signed-up activities")
def get_my_activities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ActivityResponse]:
    """Return activities the current user has signed up for."""

    activities = list_my_activities(db, current_user)
    return [ActivityResponse.model_validate(activity, from_attributes=True) for activity in activities]


@router.get("/{activity_id}", response_model=ActivityDetailResponse, summary="Get activity detail")
def get_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> ActivityDetailResponse:
    """Return one activity together with its persisted weather snapshot only."""

    activity = get_activity_by_id(db, activity_id)
    payload = ActivityResponse.model_validate(activity, from_attributes=True).model_dump()
    return ActivityDetailResponse(**payload, weather=get_activity_weather_snapshot(db, activity.id))


@router.get(
    "/{activity_id}/share-preview",
    response_model=ActivitySharePreviewResponse,
    summary="Get activity share preview",
)
def get_activity_share_preview(
    activity_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _: User | None = Depends(get_optional_current_user),
) -> ActivitySharePreviewResponse:
    """Generate or return the activity share preview image."""

    activity = get_activity_by_id(db, activity_id)
    try:
        result = get_or_create_activity_share_preview(activity)
    except Exception as exc:
        logger.exception("activity_share_preview_failed activity_id=%s summary=%s", activity_id, str(exc) or exc.__class__.__name__)
        result = ActivitySharePreviewResponse(status="failed", image_url=None)
        return result
    return ActivitySharePreviewResponse(
        status=result.status,
        image_url=_absolute_media_url(request, result.image_url),
    )


@router.post("", response_model=ActivityResponse, status_code=status.HTTP_201_CREATED, summary="Create activity")
def post_activity(
    payload: ActivityCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ActivityResponse:
    """Create an activity."""

    activity = create_activity(db, payload, current_user)
    return ActivityResponse.model_validate(activity, from_attributes=True)


@router.patch("/{activity_id}", response_model=ActivityResponse, summary="Update activity")
def patch_activity(
    activity_id: int,
    payload: ActivityUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> ActivityResponse:
    """Update an activity."""

    activity = get_activity_by_id(db, activity_id)
    updated = update_activity(db, activity, payload)
    return ActivityResponse.model_validate(updated, from_attributes=True)


@router.delete("/{activity_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete activity")
def remove_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    """Delete an activity."""

    activity = get_activity_by_id(db, activity_id)
    delete_activity(db, activity)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{activity_id}/signup", response_model=ActivitySignupResponse, summary="Sign up for activity")
def post_signup(
    activity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_activity_signup_permission),
) -> ActivitySignupResponse:
    """Sign the current member or admin up for an activity."""

    activity = get_activity_by_id(db, activity_id)
    participant = signup_activity(db, activity, current_user)
    return ActivitySignupResponse(activity_id=activity.id, participant_id=participant.id, status="signed_up")


@router.delete(
    "/{activity_id}/participants/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove participant",
)
def delete_participant(
    activity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Remove a participant from an activity."""

    activity = get_activity_by_id(db, activity_id)
    remove_participant(db, activity, participant_id, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{activity_id}/checkin", response_model=ActivitySignupResponse, summary="Check in to activity")
def post_checkin(
    activity_id: int,
    payload: ActivityCheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActivitySignupResponse:
    """Check the current user in to an activity."""

    activity = get_activity_by_id(db, activity_id)
    participant = checkin_activity(db, activity, current_user, payload)
    return ActivitySignupResponse(activity_id=activity.id, participant_id=participant.id, status="checked_in")


@router.post(
    "/{activity_id}/participants/{participant_id}/admin-checkin",
    response_model=ActivitySignupResponse,
    summary="Admin retroactive checkin for a participant",
)
def post_admin_checkin_participant(
    activity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ActivitySignupResponse:
    """Retroactively check a participant in to an activity (admin only)."""

    activity = get_activity_by_id(db, activity_id)
    participant = admin_checkin_participant(db, activity, participant_id, current_user)
    return ActivitySignupResponse(activity_id=activity.id, participant_id=participant.id, status="checked_in")


@router.delete(
    "/{activity_id}/participants/{participant_id}/admin-checkin",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Admin cancel checkin for a participant",
)
def delete_admin_checkin_participant(
    activity_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    """Cancel a participant's checkin (admin only)."""

    activity = get_activity_by_id(db, activity_id)
    admin_cancel_checkin_participant(db, activity, participant_id, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{activity_id}/signup", status_code=status.HTTP_204_NO_CONTENT, summary="Cancel signup")
def delete_signup(
    activity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Cancel the current user's signup."""

    activity = get_activity_by_id(db, activity_id)
    cancel_signup(db, activity, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
