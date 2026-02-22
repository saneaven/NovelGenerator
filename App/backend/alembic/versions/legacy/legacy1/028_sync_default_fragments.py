"""sync_default_fragments

Revision ID: 028
Revises: 027
Create Date: 2025-12-16

Sync default fragments for existing users:
- Add new fragments (translation/*, chat/characterProfile)
- Update unchanged system defaults
- Remove deleted/moved fragments (chat/characterGuideline, common/translation/*, common/translationContext/*)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid
from datetime import datetime
from pathlib import Path

# revision identifiers, used by Alembic.
revision = '028'
down_revision = '027'
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
        fragment_path = str(rel_path.with_suffix('')).replace('\\', '/')

        # Read content
        content = md_file.read_text(encoding='utf-8')
        fragments[fragment_path] = content

    return fragments


def parse_path(path: str):
    """Parse fragment path into folder_path and fragment_name."""
    if '/' in path:
        parts = path.rsplit('/', 1)
        return parts[0], parts[1]
    return None, path


def upgrade() -> None:
    """
    Sync default fragments for all existing users.
    """
    connection = op.get_bind()

    # Load current default fragments
    default_fragments = load_default_fragments()
    default_paths = set(default_fragments.keys())

    # Get all users
    users = connection.execute(sa.text("SELECT id FROM users")).fetchall()
    now = datetime.utcnow()

    for user_row in users:
        user_id = str(user_row[0])

        # Get user's current active fragments
        existing = connection.execute(
            sa.text("""
                SELECT folder_path, fragment_name, version_number, is_system_default
                FROM prompt_fragments
                WHERE user_id = :user_id AND is_active = TRUE
            """),
            {'user_id': user_id}
        ).fetchall()

        # Build set of existing fragment paths
        existing_map = {}
        for row in existing:
            folder_path = row[0]
            fragment_name = row[1]
            version_number = row[2]
            is_system_default = row[3]

            if folder_path:
                path = f"{folder_path}/{fragment_name}"
            else:
                path = fragment_name

            existing_map[path] = {
                'version_number': version_number,
                'is_system_default': is_system_default
            }

        existing_paths = set(existing_map.keys())

        # 1. Add new fragments
        new_paths = default_paths - existing_paths
        for path in new_paths:
            folder_path, fragment_name = parse_path(path)
            content = default_fragments[path]

            connection.execute(
                sa.text("""
                    INSERT INTO prompt_fragments
                    (id, user_id, folder_path, fragment_name, content, description,
                     is_system_default, version_number, is_active, note, created_at, updated_at)
                    VALUES (:id, :user_id, :folder_path, :fragment_name, :content, NULL,
                            TRUE, 1, TRUE, 'System default', :created_at, :updated_at)
                """),
                {
                    'id': str(uuid.uuid4()),
                    'user_id': user_id,
                    'folder_path': folder_path,
                    'fragment_name': fragment_name,
                    'content': content,
                    'created_at': now,
                    'updated_at': now
                }
            )

        # 2. Update existing system defaults that haven't been customized (version 1)
        for path in existing_paths & default_paths:
            info = existing_map[path]
            if info['is_system_default'] and info['version_number'] == 1:
                folder_path, fragment_name = parse_path(path)
                content = default_fragments[path]

                # Update content
                if folder_path is None:
                    connection.execute(
                        sa.text("""
                            UPDATE prompt_fragments
                            SET content = :content, updated_at = :updated_at
                            WHERE user_id = :user_id
                              AND folder_path IS NULL
                              AND fragment_name = :fragment_name
                              AND is_active = TRUE
                        """),
                        {
                            'user_id': user_id,
                            'fragment_name': fragment_name,
                            'content': content,
                            'updated_at': now
                        }
                    )
                else:
                    connection.execute(
                        sa.text("""
                            UPDATE prompt_fragments
                            SET content = :content, updated_at = :updated_at
                            WHERE user_id = :user_id
                              AND folder_path = :folder_path
                              AND fragment_name = :fragment_name
                              AND is_active = TRUE
                        """),
                        {
                            'user_id': user_id,
                            'folder_path': folder_path,
                            'fragment_name': fragment_name,
                            'content': content,
                            'updated_at': now
                        }
                    )

        # 3. Delete fragments that no longer exist in defaults
        # Only delete if user hasn't customized (is_system_default=True and version=1)
        deleted_paths = existing_paths - default_paths
        for path in deleted_paths:
            info = existing_map[path]
            if info['is_system_default'] and info['version_number'] == 1:
                folder_path, fragment_name = parse_path(path)

                if folder_path is None:
                    connection.execute(
                        sa.text("""
                            DELETE FROM prompt_fragments
                            WHERE user_id = :user_id
                              AND folder_path IS NULL
                              AND fragment_name = :fragment_name
                        """),
                        {
                            'user_id': user_id,
                            'fragment_name': fragment_name
                        }
                    )
                else:
                    connection.execute(
                        sa.text("""
                            DELETE FROM prompt_fragments
                            WHERE user_id = :user_id
                              AND folder_path = :folder_path
                              AND fragment_name = :fragment_name
                        """),
                        {
                            'user_id': user_id,
                            'folder_path': folder_path,
                            'fragment_name': fragment_name
                        }
                    )


def downgrade() -> None:
    """
    Cannot reliably downgrade fragment content changes.
    The 027 migration would need to be re-run to restore original state.
    """
    pass
