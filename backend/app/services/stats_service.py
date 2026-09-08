from __future__ import annotations

"""Statistics use cases."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Activity, ActivityParticipant
from app.schemas.stats import (
    ActivityHeatmapDayResponse,
    ActivityRankingResponse,
    PigeonRankingResponse,
    PigeonStatResponse,
)

# 小程序端对无 Z 后缀的 ISO 时间按设备本地时区解析；国内用户即东八区。
# 库内 naive datetime 与 utcnow() 直接比较会把「本地日历日」误判为未来，导致已结束活动未计入鸽子榜。
try:
    _APP_LOCAL_TZ = ZoneInfo("Asia/Shanghai")
except (ZoneInfoNotFoundError, ModuleNotFoundError):  # 未安装 tzdata 等，见 PEP 615
    _APP_LOCAL_TZ = timezone(timedelta(hours=8))  # 中国大陆无夏令时，与东八区一致

_EXCLUDED_ACTIVITY_STATUSES = ("已取消", "已流局")


def _now_local_naive() -> datetime:
    return datetime.now(_APP_LOCAL_TZ).replace(tzinfo=None)


def _to_local_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(_APP_LOCAL_TZ).replace(tzinfo=None)


def _heatmap_level(hours: float) -> int:
    if hours <= 0:
        return 0
    if hours <= 2:
        return 1
    if hours <= 4:
        return 2
    if hours <= 6:
        return 3
    return 4


def _heatmap_window(today: date) -> tuple[date, date]:
    """Return Monday of the first week and the exclusive end of 12 calendar weeks."""

    current_week_monday = today - timedelta(days=today.weekday())
    start = current_week_monday - timedelta(weeks=11)
    return start, start + timedelta(weeks=12)


def _split_activity_hours_by_day(
    start_time: datetime,
    end_time: datetime,
    window_start: date,
    window_end: date,
) -> dict[date, float]:
    start = _to_local_naive(start_time)
    end = _to_local_naive(end_time)
    if end <= start:
        return {}

    range_start = max(start, datetime.combine(window_start, time.min))
    range_end = min(end, datetime.combine(window_end, time.min))
    if range_end <= range_start:
        return {}

    result: dict[date, float] = {}
    cursor = range_start
    while cursor < range_end:
        next_day = datetime.combine(cursor.date() + timedelta(days=1), time.min)
        segment_end = min(next_day, range_end)
        result[cursor.date()] = result.get(cursor.date(), 0.0) + (
            segment_end - cursor
        ).total_seconds() / 3600
        cursor = segment_end
    return result


def _ended_participant_rows(db: Session, now_local_naive: datetime):
    return db.execute(
        select(
            ActivityParticipant.user_id,
            ActivityParticipant.display_nickname,
            ActivityParticipant.display_avatar_url,
            ActivityParticipant.checked_in_at,
            Activity.start_time,
            Activity.end_time,
        )
        .join(Activity, Activity.id == ActivityParticipant.activity_id)
        .where(Activity.status.not_in(_EXCLUDED_ACTIVITY_STATUSES))
        .where(or_(Activity.end_time <= now_local_naive, Activity.status == "已结束"))
    ).all()


def get_pigeon_ranking(db: Session) -> list[PigeonRankingResponse]:
    """Compute the new pigeon board ordered by pigeon count."""

    rows = _ended_participant_rows(db, _now_local_naive())
    member_map: dict[int, dict[str, int | str]] = {}
    for user_id, nickname, avatar_url, checked_in_at, _, _ in rows:
        stat = member_map.setdefault(
            user_id,
            {
                "nickname": nickname,
                "avatar_url": avatar_url or "",
                "signup_count": 0,
                "checkin_count": 0,
            },
        )
        stat["nickname"] = nickname or stat["nickname"]
        stat["avatar_url"] = avatar_url or stat["avatar_url"]
        stat["signup_count"] += 1
        if checked_in_at is not None:
            stat["checkin_count"] += 1

    result: list[PigeonRankingResponse] = []
    for user_id, stat in member_map.items():
        signup_count = int(stat["signup_count"])
        checkin_count = int(stat["checkin_count"])
        pigeon_count = signup_count - checkin_count
        pigeon_rate = round((pigeon_count / signup_count) * 100, 1) if signup_count else 0.0
        result.append(
            PigeonRankingResponse(
                user_id=user_id,
                nickname=str(stat["nickname"]),
                avatar_url=str(stat["avatar_url"]),
                signup_count=signup_count,
                checkin_count=checkin_count,
                pigeon_count=pigeon_count,
                pigeon_rate=pigeon_rate,
            )
        )

    return sorted(
        result,
        key=lambda item: (item.pigeon_count, item.pigeon_rate, item.signup_count, -item.user_id),
        reverse=True,
    )

def get_activity_ranking(
    db: Session,
    *,
    today: date | None = None,
) -> list[ActivityRankingResponse]:
    """Rank checked-in users and build a duration-based 12-week heatmap."""

    now_local_naive = _now_local_naive()
    current_day = today or now_local_naive.date()
    window_start, window_end = _heatmap_window(current_day)
    rows = _ended_participant_rows(db, now_local_naive)

    member_map: dict[int, dict[str, object]] = {}
    for user_id, nickname, avatar_url, checked_in_at, start_time, end_time in rows:
        if checked_in_at is None:
            continue
        stat = member_map.setdefault(
            user_id,
            {
                "nickname": nickname,
                "avatar_url": avatar_url or "",
                "checkin_count": 0,
                "daily_hours": {},
            },
        )
        stat["nickname"] = nickname or stat["nickname"]
        stat["avatar_url"] = avatar_url or stat["avatar_url"]
        stat["checkin_count"] = int(stat["checkin_count"]) + 1
        daily_hours = stat["daily_hours"]
        for activity_date, hours in _split_activity_hours_by_day(
            start_time, end_time, window_start, window_end
        ).items():
            daily_hours[activity_date] = daily_hours.get(activity_date, 0.0) + hours

    result: list[ActivityRankingResponse] = []
    for user_id, stat in member_map.items():
        daily_hours = stat["daily_hours"]
        heatmap: list[ActivityHeatmapDayResponse] = []
        cursor = window_start
        while cursor < window_end:
            hours = round(float(daily_hours.get(cursor, 0.0)), 2)
            heatmap.append(
                ActivityHeatmapDayResponse(
                    date=cursor,
                    duration_hours=hours,
                    level=_heatmap_level(hours),
                )
            )
            cursor += timedelta(days=1)
        result.append(
            ActivityRankingResponse(
                user_id=user_id,
                nickname=str(stat["nickname"]),
                avatar_url=str(stat["avatar_url"]),
                checkin_count=int(stat["checkin_count"]),
                attendance_days=sum(1 for hours in daily_hours.values() if hours > 0),
                heatmap=heatmap,
            )
        )

    return sorted(
        result,
        key=lambda item: (item.checkin_count, item.attendance_days, -item.user_id),
        reverse=True,
    )


def get_pigeon_stats(db: Session) -> list[PigeonStatResponse]:
    """Compute signup/checkin ranking for ended activities."""

    now_local_naive = datetime.now(_APP_LOCAL_TZ).replace(tzinfo=None)
    rows = db.execute(
        select(
            ActivityParticipant.user_id,
            ActivityParticipant.display_nickname,
            ActivityParticipant.checked_in_at,
        )
        .join(Activity, Activity.id == ActivityParticipant.activity_id)
        .where(Activity.status.not_in(("已取消", "已流局", "已删除")))
        .where(or_(Activity.end_time <= now_local_naive, Activity.status == "已结束"))
    ).all()

    member_map: dict[int, dict[str, int | str]] = {}
    for user_id, display_nickname, checked_in_at in rows:
        stat = member_map.setdefault(
            user_id,
            {
                "nickname": display_nickname,
                "signup_count": 0,
                "checkin_count": 0,
            },
        )
        stat["signup_count"] += 1
        if checked_in_at is not None:
            stat["checkin_count"] += 1

    result = []
    for user_id, stat in member_map.items():
        signup_count = int(stat["signup_count"])
        checkin_count = int(stat["checkin_count"])
        pigeon_count = signup_count - checkin_count
        pigeon_rate = round((pigeon_count / signup_count) * 100, 1) if signup_count else 0.0
        result.append(
            PigeonStatResponse(
                user_id=user_id,
                nickname=str(stat["nickname"]),
                signup_count=signup_count,
                checkin_count=checkin_count,
                pigeon_count=pigeon_count,
                pigeon_rate=pigeon_rate,
            )
        )

    # 排序规则：
    # 1. 按鸽子率从高到低
    # 2. 鸽子率相同按报名次数从高到低
    return sorted(
        result,
        key=lambda item: (item.pigeon_rate, item.signup_count),
        reverse=True,
    )


def get_ended_activity_count(db: Session) -> int:
    """Return the history-page activity count without fetching the activity list."""

    now_local_naive = datetime.now(_APP_LOCAL_TZ).replace(tzinfo=None)
    count = db.scalar(
        select(func.count(Activity.id))
        .where(Activity.status.not_in(("已取消", "已流局", "已删除")))
        .where(Activity.end_time <= now_local_naive)
    )
    return int(count or 0)
