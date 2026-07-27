"""BYOK: encrypted per-user Anthropic key + byok flag on generations

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a7b8
Create Date: 2026-07-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        # Ciphertext only (AES-256-GCM, services/secretbox.py) — the plaintext
        # key never touches the database.
        batch_op.add_column(sa.Column('anthropic_key_enc', sa.Text(), nullable=True))
        # Last 4 characters, so the UI can show WHICH key is stored.
        batch_op.add_column(
            sa.Column('anthropic_key_hint', sa.String(length=8), nullable=False, server_default='')
        )
        batch_op.add_column(
            sa.Column('anthropic_key_set_at', sa.DateTime(timezone=True), nullable=True)
        )

    with op.batch_alter_table('generations', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('byok', sa.Boolean(), nullable=False, server_default='0')
        )


def downgrade() -> None:
    with op.batch_alter_table('generations', schema=None) as batch_op:
        batch_op.drop_column('byok')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('anthropic_key_set_at')
        batch_op.drop_column('anthropic_key_hint')
        batch_op.drop_column('anthropic_key_enc')
