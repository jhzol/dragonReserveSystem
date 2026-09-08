"""add activity weather snapshots

Revision ID: 20260904_0014
Revises: 20260903_0013
Create Date: 2026-09-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260904_0014"
down_revision = "20260903_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_weather_snapshots",
        sa.Column("activity_id", sa.Integer(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("location_key", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("source_latitude", sa.Float(), nullable=True),
        sa.Column("source_longitude", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("temperature_min", sa.Float(), nullable=True),
        sa.Column("temperature_max", sa.Float(), nullable=True),
        sa.Column("condition", sa.String(length=64), nullable=True),
        sa.Column("icon_code", sa.String(length=16), nullable=True),
        sa.Column("humidity", sa.Float(), nullable=True),
        sa.Column("wind_direction", sa.String(length=32), nullable=True),
        sa.Column("wind_scale", sa.String(length=32), nullable=True),
        sa.Column("air_quality", sa.String(length=64), nullable=True),
        sa.Column("attribution", sa.String(length=128), nullable=False, server_default="天气服务驱动 by QWeather"),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_refresh_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("activity_id"),
    )
    op.create_index("ix_activity_weather_next_refresh_at", "activity_weather_snapshots", ["next_refresh_at"])
    op.create_index("ix_activity_weather_location_key", "activity_weather_snapshots", ["location_key"])
    op.create_index("ix_activity_weather_status", "activity_weather_snapshots", ["status"])


def downgrade() -> None:
    op.drop_index("ix_activity_weather_status", table_name="activity_weather_snapshots")
    op.drop_index("ix_activity_weather_location_key", table_name="activity_weather_snapshots")
    op.drop_index("ix_activity_weather_next_refresh_at", table_name="activity_weather_snapshots")
    op.drop_table("activity_weather_snapshots")
