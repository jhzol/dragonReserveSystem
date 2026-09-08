"""Shared API dependencies."""

import logging
from typing import Annotated

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.core.security import TokenPayload, decode_access_token
from app.models import User
from app.services.user_service import get_user_by_id

logger = logging.getLogger(__name__)


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def get_current_token_payload(token: str = Depends(oauth2_scheme)) -> TokenPayload:
    """Return the decoded token payload for the current request."""

    try:
        return decode_access_token(token)
    except Exception as exc:  # pragma: no cover - tightened after auth is wired
        raise AuthenticationError("Invalid or expired token") from exc


def get_current_user(
    payload: TokenPayload = Depends(get_current_token_payload),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the current authenticated user from the access token."""

    try:
        user_id = int(payload.sub)
    except ValueError as exc:  # pragma: no cover - token generation owns shape
        raise AuthenticationError("Invalid token subject") from exc
    return get_user_by_id(db, user_id)


def get_optional_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme_optional)],
    db: Session = Depends(get_db),
) -> User | None:
    """Resolve current user when token exists; otherwise allow anonymous access."""

    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id = int(payload.sub)
    except Exception as exc:
        logger.debug("get_optional_current_user: token decode failed – %s", exc)
        return None
    try:
        return get_user_by_id(db, user_id)
    except Exception as exc:
        logger.warning(
            "get_optional_current_user: DB lookup failed for user_id=%s – %s",
            user_id,
            exc,
        )
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Ensure the current user has admin privileges."""

    if user.role != "admin":
        raise PermissionDeniedError("Admin permission required")
    return user


def require_activity_create_permission(user: User = Depends(get_current_user)) -> User:
    """Allow authenticated ordinary users and admins to create v2 activities."""

    if user.role not in {"user", "admin"}:
        raise PermissionDeniedError("Activity creation permission required")
    return user


def require_activity_signup_permission(user: User = Depends(get_current_user)) -> User:
    """Allow members and admins to sign up, but reject guests and unknown roles."""

    if user.role not in {"user", "admin"}:
        raise PermissionDeniedError("Activity signup permission required")
    return user
