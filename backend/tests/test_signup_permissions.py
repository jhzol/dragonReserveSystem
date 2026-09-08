"""Signup permissions must match for legacy and cover-aware clients."""
import pytest

from app.models import ActivityParticipant


@pytest.mark.parametrize("version", ["v1", "v2"])
@pytest.mark.parametrize("role", ["user", "admin", "guest", "unknown"])
def test_signup_role_matrix(client, db_session, sample_activity, normal_user, user_headers, version, role):
    # Change the persisted role after login: authorization must use current DB state.
    normal_user.role = role
    db_session.commit()
    response = client.post(f"/api/{version}/activities/{sample_activity.id}/signup", headers=user_headers)
    allowed = role in {"user", "admin"}
    assert response.status_code == (200 if allowed else 403)
    if allowed:
        assert response.json()["status"] == "signed_up"
    else:
        assert response.json()["code"] == "PERMISSION_DENIED"
    assert db_session.query(ActivityParticipant).filter_by(
        activity_id=sample_activity.id, user_id=normal_user.id
    ).count() == (1 if allowed else 0)


@pytest.mark.parametrize("version", ["v1", "v2"])
def test_signup_requires_login(client, db_session, sample_activity, version):
    response = client.post(f"/api/{version}/activities/{sample_activity.id}/signup")
    assert response.status_code == 401
    assert db_session.query(ActivityParticipant).count() == 0
