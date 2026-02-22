"""add_reference_objects_column

Revision ID: 018
Revises: 017
Create Date: 2025-12-02

Adds column to store story objects referenced during image generation:
- generation_reference_objects - JSONB column storing array of referenced objects
  Format: [{"id": "uuid", "type": "character", "name": "John"}]
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '018'
down_revision = '017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add reference objects column to store which story objects were used during generation
    op.add_column(
        'assets',
        sa.Column('generation_reference_objects', postgresql.JSONB, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('assets', 'generation_reference_objects')
