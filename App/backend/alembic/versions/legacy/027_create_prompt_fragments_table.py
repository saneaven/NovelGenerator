"""create_prompt_fragments_table

Revision ID: 027
Revises: 026
Create Date: 2025-12-16

Create prompt_fragments table for reusable prompt fragments organized in folders.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid
from datetime import datetime
from pathlib import Path

# revision identifiers, used by Alembic.
revision = '027'
down_revision = '026'
branch_labels = None
depends_on = None


def load_default_fragments():
    """Load default fragments from md files in default_fragments directory."""
    fragments = {}

    # Get the default_fragments directory path
    current_file = Path(__file__).resolve()
    backend_dir = current_file.parent.parent.parent  # alembic/versions -> alembic -> backend
    fragments_dir = backend_dir / 'prompts' / 'default_fragments'

    if not fragments_dir.exists():
        return fragments

    # Find all .md files recursively
    for md_file in fragments_dir.rglob('*.md'):
        # Get relative path from fragments_dir
        rel_path = md_file.relative_to(fragments_dir)

        # Convert to fragment path (remove .md extension)
        # e.g., common/projectContext/full.md -> common/projectContext/full
        fragment_path = str(rel_path.with_suffix('')).replace('\\', '/')

        # Read content
        content = md_file.read_text(encoding='utf-8')
        fragments[fragment_path] = content

    return fragments


def upgrade() -> None:
    """
    Create prompt_fragments table for storing reusable prompt fragments.
    """

    # Create prompt_fragments table
    op.create_table(
        'prompt_fragments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),

        # Fragment identification
        sa.Column('folder_path', sa.String(200), nullable=True),  # e.g., 'common', 'thinking/custom', null for root
        sa.Column('fragment_name', sa.String(100), nullable=False),

        # Content
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('description', sa.Text, nullable=True),

        # Flags
        sa.Column('is_system_default', sa.Boolean, default=False, nullable=False),

        # Version control (same pattern as PromptVersion)
        sa.Column('version_number', sa.Integer, nullable=False),
        sa.Column('is_active', sa.Boolean, default=False, nullable=False),
        sa.Column('note', sa.Text, nullable=True),

        # Timestamps
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Create index for user + folder + name lookup
    op.create_index(
        'idx_fragment_user_path',
        'prompt_fragments',
        ['user_id', 'folder_path', 'fragment_name']
    )

    # Create index for active fragments
    op.create_index(
        'idx_fragment_active',
        'prompt_fragments',
        ['user_id', 'is_active']
    )

    # Create unique constraint for version numbers per fragment
    op.create_index(
        'idx_fragment_unique_version',
        'prompt_fragments',
        ['user_id', 'folder_path', 'fragment_name', 'version_number'],
        unique=True
    )

    # Load default fragments from md files
    default_fragments = load_default_fragments()

    # Insert default fragments for all existing users
    connection = op.get_bind()
    users = connection.execute(sa.text("SELECT id FROM users")).fetchall()
    now = datetime.utcnow()

    for user_row in users:
        user_id = user_row[0]
        for path, content in default_fragments.items():
            # Parse path into folder_path and fragment_name
            if '/' in path:
                parts = path.rsplit('/', 1)
                folder_path = parts[0]
                fragment_name = parts[1]
            else:
                folder_path = None
                fragment_name = path

            connection.execute(
                sa.text("""
                    INSERT INTO prompt_fragments
                    (id, user_id, folder_path, fragment_name, content, description, is_system_default, version_number, is_active, note, created_at, updated_at)
                    VALUES (:id, :user_id, :folder_path, :fragment_name, :content, NULL, TRUE, 1, TRUE, 'System default', :created_at, :updated_at)
                """),
                {
                    'id': str(uuid.uuid4()),
                    'user_id': str(user_id),
                    'folder_path': folder_path,
                    'fragment_name': fragment_name,
                    'content': content,
                    'created_at': now,
                    'updated_at': now
                }
            )


def downgrade() -> None:
    """
    Drop prompt_fragments table.
    """

    # Drop indexes
    op.drop_index('idx_fragment_unique_version', 'prompt_fragments')
    op.drop_index('idx_fragment_active', 'prompt_fragments')
    op.drop_index('idx_fragment_user_path', 'prompt_fragments')

    # Drop table
    op.drop_table('prompt_fragments')
