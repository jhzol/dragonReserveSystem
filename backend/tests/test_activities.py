from datetime import datetime, timedelta
from types import SimpleNamespace

from app.models import Activity, ActivityParticipant
from app.services.activity_service import APP_TIME_ZONE, _sync_activity_status


def _activity_for_status_sync(
    *,
    now: datetime,
    participant_count: int,
    signup_deadline: datetime | None,
    status: str = "未开始",
):
    return SimpleNamespace(
        status=status,
        start_time=now + timedelta(hours=1) if signup_deadline is not None else now,
        end_time=now + timedelta(hours=3),
        signup_deadline=signup_deadline,
        participants=[object() for _ in range(participant_count)],
    )


def test_activity_does_not_flow_before_signup_deadline() -> None:
    now = datetime(2026, 8, 20, 10, 0, 0)
    activity = _activity_for_status_sync(
        now=now,
        participant_count=2,
        signup_deadline=now + timedelta(seconds=1),
    )

    assert _sync_activity_status(activity, now) is False
    assert activity.status == "未开始"


def test_activity_flows_at_signup_deadline_when_fewer_than_three_people() -> None:
    now = datetime(2026, 8, 20, 10, 0, 0)
    activity = _activity_for_status_sync(
        now=now,
        participant_count=2,
        signup_deadline=now,
    )

    assert _sync_activity_status(activity, now) is True
    assert activity.status == "已流局"


def test_activity_does_not_flow_at_signup_deadline_with_three_people() -> None:
    now = datetime(2026, 8, 20, 10, 0, 0)
    activity = _activity_for_status_sync(
        now=now,
        participant_count=3,
        signup_deadline=now,
    )

    assert _sync_activity_status(activity, now) is False
    assert activity.status == "未开始"


def test_activity_without_signup_deadline_checks_at_start_time() -> None:
    now = datetime(2026, 8, 20, 10, 0, 0)
    activity = _activity_for_status_sync(
        now=now,
        participant_count=2,
        signup_deadline=None,
    )

    assert _sync_activity_status(activity, now) is True
    assert activity.status == "已流局"


def test_terminal_activity_status_is_not_overwritten() -> None:
    now = datetime(2026, 8, 20, 10, 0, 0)
    for status in ("已取消", "已流局"):
        activity = _activity_for_status_sync(
            now=now,
            participant_count=2,
            signup_deadline=now,
            status=status,
        )

        assert _sync_activity_status(activity, now) is False
        assert activity.status == status

def _create_signed_up_activity_for_checkin(db_session, admin_user, normal_user, second_user, start_time):
    end_time = start_time + timedelta(hours=2)
    activity = Activity(
        name="签到测试活动",
        status="进行中",
        remark="签到测试",
        max_participants=10,
        start_time=start_time,
        end_time=end_time,
        signup_deadline=start_time - timedelta(hours=1),
        signup_enabled=True,
        location_name="球馆",
        location_address="地址",
        location_latitude=39.9042,
        location_longitude=116.4074,
        created_by=admin_user.id,
    )
    db_session.add(activity)
    db_session.flush()

    for user in (normal_user, admin_user, second_user):
        db_session.add(ActivityParticipant(
            activity_id=activity.id,
            user_id=user.id,
            display_nickname=user.nickname,
            display_avatar_url=user.avatar_url,
        ))
    db_session.commit()
    return activity


def test_activity_list_allows_guest(client) -> None:
    response = client.get("/api/v1/activities")

    assert response.status_code == 200


def test_admin_can_create_list_get_update_delete_activity(client, admin_headers) -> None:
    start_time = datetime.utcnow() + timedelta(days=2)
    end_time = start_time + timedelta(hours=2)

    create_response = client.post(
        "/api/v1/activities",
        headers=admin_headers,
        json={
            "name": "羽毛球活动",
            "status": "进行中",
            "remark": "周末开打",
            "max_participants": 12,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "signup_deadline": (start_time - timedelta(hours=3)).isoformat(),
            "location_name": "球馆 A",
            "location_address": "测试地址 A",
            "location_latitude": 39.9042,
            "location_longitude": 116.4074,
            "activity_type": "badminton",
        },
    )
    assert create_response.status_code == 201
    activity = create_response.json()
    activity_id = activity["id"]
    assert activity["name"] == "羽毛球活动"
    assert activity["activity_type"] == "badminton"
    # 默认允许报名
    assert activity["signup_enabled"] is True

    list_response = client.get("/api/v1/activities", headers=admin_headers)
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    detail_response = client.get(f"/api/v1/activities/{activity_id}", headers=admin_headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == activity_id

    update_response = client.patch(
        f"/api/v1/activities/{activity_id}",
        headers=admin_headers,
        json={"remark": "已修改", "max_participants": 16, "activity_type": "boardgame"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["remark"] == "已修改"
    assert update_response.json()["max_participants"] == 16
    assert update_response.json()["activity_type"] == "boardgame"

    logical_delete_response = client.patch(
        f"/api/v1/activities/{activity_id}",
        headers=admin_headers,
        json={"status": "已删除"},
    )
    assert logical_delete_response.status_code == 422

    delete_response = client.delete(f"/api/v1/activities/{activity_id}", headers=admin_headers)
    assert delete_response.status_code == 204

    list_after_delete = client.get("/api/v1/activities", headers=admin_headers)
    assert list_after_delete.status_code == 200
    assert list_after_delete.json() == []


def test_admin_can_physically_delete_terminal_activities(client, admin_headers, db_session) -> None:
    now = datetime.utcnow()
    cases = (
        ("删除已取消", "已取消", now + timedelta(days=2), now + timedelta(days=2, hours=1)),
        ("删除已流局", "已流局", now + timedelta(days=3), now + timedelta(days=3, hours=1)),
        ("删除已结束", "已结束", now - timedelta(hours=2), now - timedelta(hours=1)),
    )

    for name, status, start_time, end_time in cases:
        create_response = client.post(
            "/api/v1/activities",
            headers=admin_headers,
            json={
                "name": name,
                "status": status,
                "remark": "物理删除测试",
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "signup_deadline": start_time.isoformat(),
            },
        )
        assert create_response.status_code == 201
        activity_id = create_response.json()["id"]

        delete_response = client.delete(f"/api/v1/activities/{activity_id}", headers=admin_headers)
        assert delete_response.status_code == 204
        assert client.get(f"/api/v1/activities/{activity_id}").status_code == 404
        assert db_session.get(Activity, activity_id) is None
        assert (
            db_session.query(ActivityParticipant)
            .filter(ActivityParticipant.activity_id == activity_id)
            .count()
            == 0
        )


def test_activity_name_and_remark_constraints(client, admin_headers) -> None:
    start_time = datetime.utcnow() + timedelta(days=2)
    end_time = start_time + timedelta(hours=2)
    base_payload = {
        "name": "一二三四五六七八九十",
        "remark": "活动说明",
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
    }

    valid_response = client.post("/api/v1/activities", headers=admin_headers, json=base_payload)
    assert valid_response.status_code == 201
    activity_id = valid_response.json()["id"]

    too_long_name = client.post(
        "/api/v1/activities",
        headers=admin_headers,
        json={**base_payload, "name": "一二三四五六七八九十甲"},
    )
    assert too_long_name.status_code == 422

    missing_remark = client.post(
        "/api/v1/activities",
        headers=admin_headers,
        json={key: value for key, value in base_payload.items() if key != "remark"},
    )
    assert missing_remark.status_code == 422

    blank_remark = client.post(
        "/api/v1/activities",
        headers=admin_headers,
        json={**base_payload, "remark": "   "},
    )
    assert blank_remark.status_code == 422

    max_length_remark = client.post(
        "/api/v1/activities",
        headers=admin_headers,
        json={**base_payload, "remark": "备" * 120},
    )
    assert max_length_remark.status_code == 201

    too_long_remark = client.post(
        "/api/v1/activities",
        headers=admin_headers,
        json={**base_payload, "remark": "备" * 121},
    )
    assert too_long_remark.status_code == 422

    update_too_long_name = client.patch(
        f"/api/v1/activities/{activity_id}",
        headers=admin_headers,
        json={"name": "一二三四五六七八九十甲"},
    )
    assert update_too_long_name.status_code == 422

    update_blank_remark = client.patch(
        f"/api/v1/activities/{activity_id}",
        headers=admin_headers,
        json={"remark": "   "},
    )
    assert update_blank_remark.status_code == 422

    update_too_long_remark = client.patch(
        f"/api/v1/activities/{activity_id}",
        headers=admin_headers,
        json={"remark": "备" * 121},
    )
    assert update_too_long_remark.status_code == 422

    partial_update = client.patch(
        f"/api/v1/activities/{activity_id}",
        headers=admin_headers,
        json={"max_participants": 20},
    )
    assert partial_update.status_code == 200


def test_my_activities_requires_auth(client) -> None:
    response = client.get("/api/v1/activities/me/signed-up")

    assert response.status_code == 401


def test_my_activities_returns_only_current_user_signups_sorted(
    client,
    db_session,
    admin_user,
    normal_user,
    second_user,
    user_headers,
    second_user_headers,
) -> None:
    from app.models import Activity, ActivityParticipant

    now = datetime.utcnow()

    def create_activity(name: str, status: str, start_offset_hours: int) -> Activity:
        start_time = now + timedelta(hours=start_offset_hours)
        activity = Activity(
            name=name,
            status=status,
            remark=name,
            max_participants=None,
            start_time=start_time,
            end_time=start_time + timedelta(hours=1),
            signup_deadline=start_time - timedelta(hours=1),
            signup_enabled=True,
            location_name="测试地点",
            location_address="测试地址",
            created_by=admin_user.id,
        )
        db_session.add(activity)
        db_session.flush()
        return activity

    later = create_activity("我的较晚活动", "未开始", 48)
    earlier = create_activity("我的较早活动", "进行中", 24)
    ended = create_activity("我的已结束活动", "已结束", 72)
    cancelled = create_activity("我的已取消活动", "已取消", 96)
    other_user_activity = create_activity("他人活动", "未开始", 36)

    for activity in [later, earlier, ended, cancelled]:
        db_session.add(
            ActivityParticipant(
                activity_id=activity.id,
                user_id=normal_user.id,
                display_nickname=normal_user.nickname,
                display_avatar_url=normal_user.avatar_url,
            )
        )
    db_session.add(
        ActivityParticipant(
            activity_id=other_user_activity.id,
            user_id=second_user.id,
            display_nickname=second_user.nickname,
            display_avatar_url=second_user.avatar_url,
        )
    )
    db_session.commit()

    response = client.get("/api/v1/activities/me/signed-up", headers=user_headers)

    assert response.status_code == 200
    data = response.json()
    assert [item["name"] for item in data] == [
        "我的较早活动",
        "我的较晚活动",
        "我的已结束活动",
        "我的已取消活动",
    ]
    assert "他人活动" not in [item["name"] for item in data]
    assert all(any(p["user_id"] == normal_user.id for p in item["participants"]) for item in data)

    second_response = client.get("/api/v1/activities/me/signed-up", headers=second_user_headers)

    assert second_response.status_code == 200
    assert [item["name"] for item in second_response.json()] == ["他人活动"]


def test_non_admin_cannot_create_activity(client, user_headers) -> None:
    start_time = datetime.utcnow() + timedelta(days=1)
    end_time = start_time + timedelta(hours=1)
    response = client.post(
        "/api/v1/activities",
        headers=user_headers,
        json={
            "name": "普通用户建活动",
            "remark": "权限测试",
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
        },
    )

    assert response.status_code == 403
    assert response.json()["code"] == "PERMISSION_DENIED"


def test_admin_can_signup(client, sample_activity, admin_headers) -> None:
    signup_response = client.post(f"/api/v1/activities/{sample_activity.id}/signup", headers=admin_headers)
    assert signup_response.status_code == 200
    assert signup_response.json()["status"] == "signed_up"


def test_legacy_activity_aliases_remain_available(client) -> None:
    paths = client.app.openapi()["paths"]

    assert "/api/v1/activities/mine" in paths
    assert "delete" in paths["/api/v1/activities/{activity_id}/signup"]


def test_normal_user_can_signup(client, sample_activity, user_headers) -> None:
    response = client.post(f"/api/v1/activities/{sample_activity.id}/signup", headers=user_headers)

    assert response.status_code == 200
    assert response.json()["status"] == "signed_up"


def test_creator_auto_signed_up_on_create(client, admin_headers) -> None:
    start_time = datetime.utcnow() + timedelta(days=1)
    end_time = start_time + timedelta(hours=2)

    create_response = client.post(
        "/api/v1/activities",
        headers=admin_headers,
        json={
            "name": "自动报名活动",
            "remark": "自动报名测试",
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
        },
    )
    assert create_response.status_code == 201
    activity = create_response.json()

    # 创建者应已在参与者列表中
    assert len(activity["participants"]) == 1


def test_unlimited_capacity_allows_admin_signup(client, db_session, admin_user, admin_headers) -> None:
    from app.models import Activity

    start_time = datetime.now(APP_TIME_ZONE).replace(tzinfo=None) + timedelta(hours=1)
    end_time = start_time + timedelta(hours=2)

    activity = Activity(
        name="不限人数活动",
        status="进行中",
        remark="不限人数",
        max_participants=None,
        start_time=start_time,
        end_time=end_time,
        signup_deadline=start_time - timedelta(minutes=30),
        signup_enabled=True,
        location_name="球馆",
        location_address="地址",
        location_latitude=39.9042,
        location_longitude=116.4074,
        created_by=admin_user.id,
    )
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # 先报名一次
    response1 = client.post(f"/api/v1/activities/{activity.id}/signup", headers=admin_headers)
    assert response1.status_code == 200

    # 伪造另一个用户报名，验证不会触发人数上限（这里只是覆盖逻辑，不检查重复用户）
    # 这里直接修改 max_participants 为 1，仍应允许之前的报名保持且不报错
    activity.max_participants = 1
    db_session.add(activity)
    db_session.commit()


def test_signup_disabled_returns_validation_error(client, db_session, admin_user, normal_user, admin_headers) -> None:
    from app.models import Activity

    start_time = datetime.utcnow() + timedelta(hours=1)
    end_time = start_time + timedelta(hours=2)
    activity = Activity(
        name="报名关闭活动",
        status="进行中",
        remark="报名关闭",
        max_participants=10,
        start_time=start_time,
        end_time=end_time,
        signup_deadline=start_time,
        signup_enabled=False,
        location_name="球馆",
        location_address="地址",
        location_latitude=39.9042,
        location_longitude=116.4074,
        created_by=admin_user.id,
    )
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    response = client.post(f"/api/v1/activities/{activity.id}/signup", headers=admin_headers)
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_checkin_before_start_time_returns_validation_error(
    client,
    db_session,
    admin_user,
    normal_user,
    second_user,
    user_headers,
) -> None:
    activity = _create_signed_up_activity_for_checkin(
        db_session=db_session,
        admin_user=admin_user,
        normal_user=normal_user,
        second_user=second_user,
        start_time=datetime.now() + timedelta(hours=2),
    )

    response = client.post(
        f"/api/v1/activities/{activity.id}/checkin",
        headers=user_headers,
        json={"lat": 39.9042, "lng": 116.4074},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_checkin_within_30_minutes_before_start_still_returns_validation_error(
    client,
    db_session,
    admin_user,
    normal_user,
    second_user,
    user_headers,
) -> None:
    activity = _create_signed_up_activity_for_checkin(
        db_session=db_session,
        admin_user=admin_user,
        normal_user=normal_user,
        second_user=second_user,
        start_time=datetime.now() + timedelta(minutes=20),
    )

    response = client.post(
        f"/api/v1/activities/{activity.id}/checkin",
        headers=user_headers,
        json={"lat": 39.9042, "lng": 116.4074},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_self_checkin_after_activity_ends_returns_validation_error(
    client,
    db_session,
    admin_user,
    normal_user,
    second_user,
    user_headers,
) -> None:
    activity = _create_signed_up_activity_for_checkin(
        db_session=db_session,
        admin_user=admin_user,
        normal_user=normal_user,
        second_user=second_user,
        start_time=datetime.now() - timedelta(hours=3),
    )

    response = client.post(
        f"/api/v1/activities/{activity.id}/checkin",
        headers=user_headers,
        json={"lat": 39.9042, "lng": 116.4074},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_admin_can_remove_participant(client, signed_up_activity, admin_headers, db_session, normal_user) -> None:
    detail_response = client.get(f"/api/v1/activities/{signed_up_activity.id}", headers=admin_headers)
    participant_id = detail_response.json()["participants"][0]["id"]

    response = client.delete(
        f"/api/v1/activities/{signed_up_activity.id}/participants/{participant_id}",
        headers=admin_headers,
    )

    assert response.status_code == 204


def test_admin_can_retro_checkin_participant(
    client,
    db_session,
    admin_user,
    normal_user,
    admin_headers,
) -> None:
    from app.models import Activity, ActivityParticipant

    start_time = datetime.utcnow() - timedelta(hours=2)
    end_time = start_time + timedelta(hours=2)
    activity = Activity(
        name="已结束补签活动",
        status="已结束",
        remark="已结束补签",
        max_participants=None,
        start_time=start_time,
        end_time=end_time,
        signup_deadline=start_time - timedelta(hours=1),
        signup_enabled=True,
        location_name="球馆",
        location_address="地址",
        location_latitude=39.9042,
        location_longitude=116.4074,
        created_by=admin_user.id,
    )
    db_session.add(activity)
    db_session.flush()

    participant = ActivityParticipant(
        activity_id=activity.id,
        user_id=normal_user.id,
        display_nickname=normal_user.nickname,
        display_avatar_url=normal_user.avatar_url,
    )
    db_session.add(participant)
    db_session.commit()
    db_session.refresh(participant)

    response = client.post(
        f"/api/v1/activities/{activity.id}/participants/{participant.id}/admin-checkin",
        headers=admin_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["activity_id"] == activity.id
    assert data["participant_id"] == participant.id
    assert data["status"] == "checked_in"

    db_session.refresh(participant)
    assert participant.checked_in_at is not None


def test_admin_can_cancel_checkin_participant(
    client,
    db_session,
    admin_user,
    normal_user,
    admin_headers,
) -> None:
    from app.models import Activity, ActivityParticipant

    start_time = datetime.utcnow() - timedelta(hours=2)
    end_time = start_time + timedelta(hours=2)
    activity = Activity(
        name="已结束取消签到活动",
        status="已结束",
        remark="已结束取消签到",
        max_participants=None,
        start_time=start_time,
        end_time=end_time,
        signup_deadline=start_time - timedelta(hours=1),
        signup_enabled=True,
        location_name="球馆",
        location_address="地址",
        location_latitude=39.9042,
        location_longitude=116.4074,
        created_by=admin_user.id,
    )
    db_session.add(activity)
    db_session.flush()

    participant = ActivityParticipant(
        activity_id=activity.id,
        user_id=normal_user.id,
        display_nickname=normal_user.nickname,
        display_avatar_url=normal_user.avatar_url,
        checked_in_at=datetime.utcnow(),
    )
    db_session.add(participant)
    db_session.commit()
    db_session.refresh(participant)

    response = client.delete(
        f"/api/v1/activities/{activity.id}/participants/{participant.id}/admin-checkin",
        headers=admin_headers,
    )

    assert response.status_code == 204
    db_session.refresh(participant)
    assert participant.checked_in_at is None


def test_user_cannot_remove_other_participant(
    client,
    db_session,
    sample_activity,
    second_user,
    user_headers,
) -> None:
    from app.models import ActivityParticipant

    participant = ActivityParticipant(
        activity_id=sample_activity.id,
        user_id=second_user.id,
        display_nickname=second_user.nickname,
        display_avatar_url=second_user.avatar_url,
    )
    db_session.add(participant)
    db_session.commit()

    response = client.delete(
        f"/api/v1/activities/{sample_activity.id}/participants/{participant.id}",
        headers=user_headers,
    )

    assert response.status_code == 422


def test_duplicate_admin_signup_returns_conflict(client, db_session, sample_activity, admin_user, admin_headers) -> None:
    db_session.add(ActivityParticipant(
        activity_id=sample_activity.id,
        user_id=admin_user.id,
        display_nickname=admin_user.nickname,
        display_avatar_url=admin_user.avatar_url,
    ))
    db_session.commit()

    response = client.post(f"/api/v1/activities/{sample_activity.id}/signup", headers=admin_headers)

    assert response.status_code == 409
    assert response.json()["code"] == "CONFLICT"


def test_checkin_success(client, db_session, admin_user, normal_user, second_user, user_headers) -> None:
    activity = _create_signed_up_activity_for_checkin(
        db_session=db_session,
        admin_user=admin_user,
        normal_user=normal_user,
        second_user=second_user,
        start_time=datetime.now() - timedelta(minutes=5),
    )

    response = client.post(
        f"/api/v1/activities/{activity.id}/checkin",
        headers=user_headers,
        json={"lat": 39.9042, "lng": 116.4074},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "checked_in"


def test_checkin_outside_radius_returns_validation_error(
    client, db_session, admin_user, normal_user, second_user, user_headers
) -> None:
    activity = _create_signed_up_activity_for_checkin(
        db_session=db_session,
        admin_user=admin_user,
        normal_user=normal_user,
        second_user=second_user,
        start_time=datetime.now() - timedelta(minutes=5),
    )

    response = client.post(
        f"/api/v1/activities/{activity.id}/checkin",
        headers=user_headers,
        json={"lat": 31.2304, "lng": 121.4737},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_signup_after_deadline_returns_validation_error(client, db_session, admin_user, normal_user, admin_headers) -> None:
    start_time = datetime.utcnow() - timedelta(hours=1)
    end_time = start_time + timedelta(hours=2)
    from app.models import Activity

    activity = Activity(
        name="已截止活动",
        status="进行中",
        remark="已截止",
        max_participants=10,
        start_time=start_time,
        end_time=end_time,
        signup_deadline=start_time - timedelta(hours=1),
        location_name="球馆",
        location_address="地址",
        location_latitude=39.9042,
        location_longitude=116.4074,
        created_by=admin_user.id,
    )
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    response = client.post(f"/api/v1/activities/{activity.id}/signup", headers=admin_headers)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
