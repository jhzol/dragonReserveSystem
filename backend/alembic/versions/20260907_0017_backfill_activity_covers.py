"""backfill activity covers and require them

Revision ID: 20260907_0017
Revises: 20260906_0016
Create Date: 2026-09-07
"""

import sqlalchemy as sa
from alembic import op


revision = "20260907_0017"
down_revision = "20260906_0016"
branch_labels = None
depends_on = None


DEFAULT_ACTIVITY_COVER_ID = "aleksey-rico-001"


def upgrade() -> None:
    # 0016 was already deployed to the shared test database while the new field
    # was still nullable. Keep this repair in a new revision so every previously
    # upgraded environment receives the same deterministic data migration.
    op.execute(
        "UPDATE activities SET activity_cover_id = 'aleksey-rico-001' "
        "WHERE activity_cover_id IS NULL OR activity_cover_id = ''"
    )
    op.alter_column(
        "activities",
        "activity_cover_id",
        existing_type=sa.String(length=96),
        nullable=False,
        server_default=DEFAULT_ACTIVITY_COVER_ID,
    )


def downgrade() -> None:
    op.alter_column(
        "activities",
        "activity_cover_id",
        existing_type=sa.String(length=96),
        nullable=True,
        server_default=None,
    )
