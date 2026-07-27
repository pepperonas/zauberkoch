"""generations.user_id nullable + SET NULL (usage log survives account deletion)

Deleting an account must remove the person, not rewrite the books. With the
previous ON DELETE CASCADE every past generation of that user vanished, so the
cost dashboard's historical months would shrink retroactively — money that was
really spent would stop being visible.

Detaching instead (user_id = NULL) keeps the aggregate accounting while
removing the personal reference: what stays is "one generation happened on this
day, cost this much", which is no longer personal data.

Revision ID: c3d4e5f6a7b8
Revises: b7c8d9e0f1a2
Create Date: 2026-07-27 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The existing foreign key is unnamed (SQLAlchemy emits a bare
# `FOREIGN KEY(user_id) REFERENCES users (id)`), so batch mode needs a naming
# convention to be able to address it at all.
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}
FK = "fk_generations_user_id_users"


def upgrade() -> None:
    # SQLite cannot alter a constraint in place — batch mode rebuilds the table.
    with op.batch_alter_table('generations', schema=None, naming_convention=NAMING) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.Integer(), nullable=True)
        batch_op.drop_constraint(FK, type_='foreignkey')
        batch_op.create_foreign_key(FK, 'users', ['user_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    # Rows detached by an account deletion have no user to point back to; they
    # would violate NOT NULL, so drop them before restoring the old shape.
    op.execute('DELETE FROM generations WHERE user_id IS NULL')
    with op.batch_alter_table('generations', schema=None, naming_convention=NAMING) as batch_op:
        batch_op.drop_constraint(FK, type_='foreignkey')
        batch_op.create_foreign_key(FK, 'users', ['user_id'], ['id'], ondelete='CASCADE')
        batch_op.alter_column('user_id', existing_type=sa.Integer(), nullable=False)
