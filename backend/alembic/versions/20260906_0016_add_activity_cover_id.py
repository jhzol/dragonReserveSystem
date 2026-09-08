"""add activity cover id

Revision ID: 20260906_0016
Revises: 20260906_0015
Create Date: 2026-09-06
"""

import sqlalchemy as sa
from alembic import op


revision = "20260906_0016"
down_revision = "20260906_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("activity_cover_id", sa.String(length=96), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "activity_cover_id")
