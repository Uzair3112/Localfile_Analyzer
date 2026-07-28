"""add cancelled scan status

Revision ID: 3ef1837b4107
Revises: 18a95e2da077
Create Date: 2026-07-28 19:06:04.429534

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3ef1837b4107'
down_revision: Union[str, Sequence[str], None] = '18a95e2da077'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE scanstatus ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # PostgreSQL does not support removing values from an enum.
    # The value will remain in the type but will not be used.
    # A full type recreation would be needed to truly remove it.
    pass
