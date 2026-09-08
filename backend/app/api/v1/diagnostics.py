"""Endpoints for ingesting client-side diagnostic logs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, require_admin
from app.models import User
from app.schemas.diagnostic import (
    ClientDiagnosticLogBatchRequest,
    ClientDiagnosticLogRequest,
    ClientDiagnosticLogResponse,
)
from app.services.diagnostic_service import append_client_diagnostic_log, read_recent_client_diagnostic_logs


router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.post("/client-logs", response_model=ClientDiagnosticLogResponse, summary="Ingest client diagnostic log")
def post_client_diagnostic_log(
    payload: ClientDiagnosticLogRequest,
    current_user: User = Depends(get_current_user),
) -> ClientDiagnosticLogResponse:
    """Persist a client diagnostic event for later investigation."""

    append_client_diagnostic_log(
        {
            "user_id": current_user.id,
            "user_role": current_user.role,
            "event": payload.event,
            "trace_id": payload.trace_id,
            "session_id": payload.session_id,
            "page": payload.page,
            "level": payload.level,
            "client_version": payload.client_version,
            "base_lib_version": payload.base_lib_version,
            "system_type": payload.system_type,
            "payload": payload.payload,
        }
    )
    return ClientDiagnosticLogResponse()


@router.post("/client-logs/batch", response_model=ClientDiagnosticLogResponse, summary="Ingest a batch of client diagnostic logs")
def post_client_diagnostic_log_batch(
    payload: ClientDiagnosticLogBatchRequest,
    current_user: User = Depends(get_current_user),
) -> ClientDiagnosticLogResponse:
    """Persist a bounded batch without making one request per event."""

    for event in payload.events:
        append_client_diagnostic_log(
            {
                "user_id": current_user.id,
                "user_role": current_user.role,
                "event": event.event,
                "trace_id": event.trace_id,
                "session_id": event.session_id,
                "page": event.page,
                "level": event.level,
                "client_version": event.client_version,
                "base_lib_version": event.base_lib_version,
                "system_type": event.system_type,
                "payload": event.payload,
            }
        )
    return ClientDiagnosticLogResponse(stored=bool(payload.events))


@router.get("/client-logs", summary="List recent client diagnostic logs")
def get_client_diagnostic_logs(
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_admin),
) -> list[dict]:
    """Return recent client diagnostic events for debugging."""

    return read_recent_client_diagnostic_logs(limit=limit)
