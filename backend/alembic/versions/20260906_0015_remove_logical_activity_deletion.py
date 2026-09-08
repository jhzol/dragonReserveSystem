"""remove logical activity deletion

Revision ID: 20260906_0015
Revises: 20260904_0014
Create Date: 2026-09-06
"""

from alembic import op


revision = "20260906_0015"
down_revision = "20260904_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Physically remove rows previously hidden through status='已删除'."""

    op.execute(
        """
        DELETE FROM activity_weather_snapshots
        WHERE activity_id IN (
            SELECT id FROM activities WHERE HEX(status) = 'E5B7B2E588A0E999A4'
        )
        """
    )
    op.execute(
        """
        DELETE FROM activity_participants
        WHERE activity_id IN (
            SELECT id FROM activities WHERE HEX(status) = 'E5B7B2E588A0E999A4'
        )
        """
    )
    op.execute("DELETE FROM activities WHERE HEX(status) = 'E5B7B2E588A0E999A4'")


def downgrade() -> None:
    """Physical deletions cannot be reconstructed."""
