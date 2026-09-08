"""add participant checkin address fields

Revision ID: 20260903_0013
Revises: 20260810_0012
Create Date: 2026-09-03
"""

from alembic import op
import sqlalchemy as sa


revision = "20260903_0013"
down_revision = "20260810_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activity_participants", sa.Column("checkin_location_name", sa.String(length=255), nullable=True))
    op.add_column("activity_participants", sa.Column("checkin_address", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("activity_participants", "checkin_address")
    op.drop_column("activity_participants", "checkin_location_name")
