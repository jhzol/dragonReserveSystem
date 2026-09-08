from datetime import datetime, timedelta

from app.core.security import get_password_hash
from app.models import ActivityParticipant, User


def _activity_payload(name: str = "普通用户创建的活动") -> dict:
    start_time = datetime.utcnow() + timedelta(days=2)
    return {
        "name": name,
        "remark": "验证 v2 创建人与权限隔离",
        "max_participants": 12,
        "start_time": start_time.isoformat(),
        "end_time": (start_time + timedelta(hours=2)).isoformat(),
        "signup_deadline": (start_time - timedelta(hours=1)).isoformat(),
        "location_name": "测试场地",
        "activity_cover_id": "aleksey-rico-001",
    }


def test_cover_catalog_exposes_all_prototype_artists_and_assets(client) -> None:
    response = client.get("/api/v2/activity-covers")

    assert response.status_code == 200
    artists = response.json()
    assert [artist["display_name"] for artist in artists] == [
        "米山舞",
        "Patryk Wojciechowicz",
        "Ardhira Putra",
        "Aleksey Rico",
        "LAM",
        "magoyama",
        "Benjamin Flouw",
        "venmen",
    ]
    assert sum(len(artist["artworks"]) for artist in artists) == 65
    first = next(artist for artist in artists if artist["slug"] == "aleksey-rico")["artworks"][0]
    assert first["id"] == "aleksey-rico-001"
    assert first["thumbnail_url"].endswith("/activity-cover-assets/aleksey-rico/thumbs/aleksey-rico-001.jpg")
    assert first["image_url"].endswith("/activity-cover-assets/aleksey-rico/images/aleksey-rico-001.jpg")
    assert first["large_card_glass_image_url"].endswith(
        "/api/v2/activity-covers/aleksey-rico-001/glass-image?v=2"
    )
    asset_response = client.get("/activity-cover-assets/aleksey-rico/thumbs/aleksey-rico-001.jpg")
    assert asset_response.status_code == 200
    assert asset_response.headers["content-type"] == "image/jpeg"


def test_cover_glass_route_returns_build_time_pre_rendered_image(client) -> None:
    response = client.get("/api/v2/activity-covers/aleksey-rico-001/glass-image?v=2")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "public, max-age=2592000, immutable"
    assert len(response.content) > 0


def test_cover_glass_route_rejects_unknown_cover(client) -> None:
    response = client.get("/api/v2/activity-covers/missing-cover/glass-image?v=2")

    assert response.status_code == 404
    assert response.json()["message"] == "activity cover not found"


def test_v2_does_not_expose_legacy_style_routes(client) -> None:
    type_styles = client.get("/api/v2/activities/type-styles")
    signature = client.get("/api/v2/activities/style-signature")

    assert type_styles.status_code != 200
    assert signature.status_code != 200


def test_v2_create_and_update_persist_cover_without_activity_type(client, admin_headers) -> None:
    start_time = datetime.utcnow() + timedelta(days=2)
    payload = {
        "name": "封面活动",
        "remark": "验证活动封面",
        "max_participants": 12,
        "start_time": start_time.isoformat(),
        "end_time": (start_time + timedelta(hours=2)).isoformat(),
        "signup_deadline": (start_time - timedelta(hours=1)).isoformat(),
        "location_name": "测试场地",
        "activity_cover_id": "aleksey-rico-001",
    }

    create_response = client.post("/api/v2/activities", headers=admin_headers, json=payload)
    assert create_response.status_code == 201
    activity = create_response.json()
    assert activity["activity_cover_id"] == "aleksey-rico-001"
    assert activity["activity_cover"]["artist_name"] == "Aleksey Rico"
    assert "activity_type" not in activity
    assert "activity_style_key" not in activity

    detail_response = client.get(f"/api/v2/activities/{activity['id']}", headers=admin_headers)
    assert detail_response.status_code == 200
    assert "weather" in detail_response.json()

    update_response = client.patch(
        f"/api/v2/activities/{activity['id']}",
        headers=admin_headers,
        json={"activity_cover_id": "lam-001"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["activity_cover_id"] == "lam-001"
    assert update_response.json()["activity_cover"]["artist_name"] == "LAM"


def test_v2_rejects_unknown_cover(client, admin_headers) -> None:
    start_time = datetime.utcnow() + timedelta(days=2)
    response = client.post(
        "/api/v2/activities",
        headers=admin_headers,
        json={
            "name": "无效封面",
            "remark": "应被拒绝",
            "start_time": start_time.isoformat(),
            "end_time": (start_time + timedelta(hours=1)).isoformat(),
            "activity_cover_id": "missing-cover",
        },
    )
    assert response.status_code == 422


def test_v2_rejects_client_controlled_status(client, admin_headers) -> None:
    create_payload = _activity_payload("禁止指定状态")
    create_payload["status"] = "已结束"
    create_response = client.post("/api/v2/activities", headers=admin_headers, json=create_payload)

    valid_payload = _activity_payload("服务端状态")
    created = client.post("/api/v2/activities", headers=admin_headers, json=valid_payload).json()
    patch_response = client.patch(
        f"/api/v2/activities/{created['id']}",
        headers=admin_headers,
        json={"status": "已取消"},
    )

    assert create_response.status_code == 422
    assert patch_response.status_code == 422


def test_v2_cancel_is_an_explicit_terminal_transition(client, user_headers) -> None:
    created = client.post("/api/v2/activities", headers=user_headers, json=_activity_payload()).json()

    cancelled = client.post(
        f"/api/v2/activities/{created['id']}/cancel",
        headers=user_headers,
    )
    edit_after_cancel = client.patch(
        f"/api/v2/activities/{created['id']}",
        headers=user_headers,
        json={"remark": "终态不可编辑"},
    )

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "已取消"
    assert edit_after_cancel.status_code == 422


def test_v2_allows_ordinary_users_to_create_and_records_the_creator(
    client,
    user_headers,
    normal_user,
) -> None:
    response = client.post("/api/v2/activities", headers=user_headers, json=_activity_payload())

    assert response.status_code == 201
    payload = response.json()
    assert payload["created_by"] == normal_user.id
    assert any(item["user_id"] == normal_user.id for item in payload["participants"])


def test_v2_guest_and_unauthenticated_users_cannot_create(client, db_session) -> None:
    guest = User(
        username="guest-create",
        password_hash=get_password_hash("guest123456"),
        nickname="Guest",
        avatar_url="",
        role="guest",
    )
    db_session.add(guest)
    db_session.commit()
    token = client.post(
        "/api/v1/auth/login",
        json={"username": "guest-create", "password": "guest123456"},
    ).json()["access_token"]

    unauthenticated = client.post("/api/v2/activities", json=_activity_payload("未登录活动"))
    guest_response = client.post(
        "/api/v2/activities",
        headers={"Authorization": f"Bearer {token}"},
        json=_activity_payload("游客活动"),
    )

    assert unauthenticated.status_code == 401
    assert guest_response.status_code == 403


def test_v2_owner_can_update_own_activity_but_not_another_users_activity(
    client,
    user_headers,
    second_user_headers,
    admin_headers,
) -> None:
    created = client.post(
        "/api/v2/activities",
        headers=user_headers,
        json=_activity_payload(),
    ).json()
    activity_url = f"/api/v2/activities/{created['id']}"

    owner_update = client.patch(activity_url, headers=user_headers, json={"remark": "创建人可以编辑"})
    other_update = client.patch(activity_url, headers=second_user_headers, json={"remark": "越权编辑"})
    admin_update = client.patch(activity_url, headers=admin_headers, json={"remark": "管理员可以编辑"})

    assert owner_update.status_code == 200
    assert owner_update.json()["remark"] == "创建人可以编辑"
    assert other_update.status_code == 403
    assert admin_update.status_code == 200
    assert admin_update.json()["remark"] == "管理员可以编辑"


def test_v2_owner_can_remove_participants_but_cannot_manage_checkin(
    client,
    db_session,
    admin_headers,
    user_headers,
    second_user_headers,
    second_user,
) -> None:
    created = client.post(
        "/api/v2/activities",
        headers=user_headers,
        json=_activity_payload(),
    ).json()
    participant = ActivityParticipant(
        activity_id=created["id"],
        user_id=second_user.id,
        display_nickname=second_user.nickname,
        display_avatar_url=second_user.avatar_url,
    )
    db_session.add(participant)
    db_session.commit()
    db_session.refresh(participant)
    base_url = f"/api/v2/activities/{created['id']}/participants/{participant.id}"

    owner_checkin_response = client.post(f"{base_url}/admin-checkin", headers=user_headers)
    owner_cancel_response = client.delete(f"{base_url}/admin-checkin", headers=user_headers)
    admin_checkin_response = client.post(f"{base_url}/admin-checkin", headers=admin_headers)
    admin_cancel_response = client.delete(f"{base_url}/admin-checkin", headers=admin_headers)
    remove_response = client.delete(base_url, headers=user_headers)

    assert owner_checkin_response.status_code == 403
    assert owner_cancel_response.status_code == 403
    assert admin_checkin_response.status_code == 200
    assert admin_cancel_response.status_code == 204
    assert remove_response.status_code == 204

    creator_participant_id = next(
        item["id"] for item in created["participants"] if item["user_id"] == created["created_by"]
    )
    forbidden = client.delete(
        f"/api/v2/activities/{created['id']}/participants/{creator_participant_id}",
        headers=second_user_headers,
    )
    assert forbidden.status_code == 403
