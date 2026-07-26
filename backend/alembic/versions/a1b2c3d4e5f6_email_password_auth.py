"""email/password auth: password_hash, email_verified_at, nullable google_sub

Revision ID: a1b2c3d4e5f6
Revises: a9c3f1e6b722
Create Date: 2026-07-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'a9c3f1e6b722'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter rebuilds the table on SQLite so google_sub can become
    # nullable; the unique index is preserved (SQLite permits multiple NULLs).
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('password_hash', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.alter_column('google_sub', existing_type=sa.String(length=64), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('google_sub', existing_type=sa.String(length=64), nullable=False)
        batch_op.drop_column('email_verified_at')
        batch_op.drop_column('password_hash')
