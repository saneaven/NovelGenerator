"""add_order_to_story_objects

Revision ID: 033
Revises: 032
Create Date: 2025-12-29

Adds order column to story object tables (characters, organizations, locations, lorebook_entries).
This enables user-defined ordering within each type group.
"""
from alembic import op
import sqlalchemy as sa

revision = '033'
down_revision = '032'
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = ['characters', 'organizations', 'locations', 'lorebook_entries']

    for table in tables:
        op.add_column(
            table,
            sa.Column('order', sa.Integer, nullable=True, server_default='0')
        )
        # Create composite index for efficient ordering queries
        op.create_index(f'idx_{table}_project_order', table, ['project_id', 'order'])


def downgrade() -> None:
    tables = ['characters', 'organizations', 'locations', 'lorebook_entries']

    for table in tables:
        op.drop_index(f'idx_{table}_project_order', table_name=table)
        op.drop_column(table, 'order')
