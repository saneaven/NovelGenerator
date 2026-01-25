"""add_image_prompt_templates

Revision ID: 019
Revises: 018
Create Date: 2025-12-02

Adds new imagePrompt templates (object and scene) for existing users.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
import uuid

revision = '019'
down_revision = '018'
branch_labels = None
depends_on = None

# Load prompt templates
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent.parent.parent / 'prompts' / 'templates'

def _load_template(relative_path: str) -> str:
    """Load a prompt template file."""
    file_path = TEMPLATES_DIR / relative_path
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return f"# Default prompt (file not found: {relative_path})"


# New imagePrompt templates to add
NEW_PROMPTS = [
    # Object Image Prompts
    ('imagePrompt', 'systemPrompt', 'object', 'systemPrompts/ObjectImagePromptSystemPrompt.md'),
    ('imagePrompt', 'userPrompt', 'object', 'userPrompts/ObjectImagePromptUserPrompt.md'),
    ('imagePrompt', 'prefill', 'object', 'prefills/ObjectImagePromptPrefill.md'),
    # Scene Image Prompts
    ('imagePrompt', 'systemPrompt', 'scene', 'systemPrompts/SceneImagePromptSystemPrompt.md'),
    ('imagePrompt', 'userPrompt', 'scene', 'userPrompts/SceneImagePromptUserPrompt.md'),
    ('imagePrompt', 'prefill', 'scene', 'prefills/SceneImagePromptPrefill.md'),
]


def upgrade() -> None:
    """Add new imagePrompt templates for all existing users."""
    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        # Get all user IDs
        result = session.execute(text("SELECT id FROM users"))
        user_ids = [row[0] for row in result]

        for user_id in user_ids:
            for function_type, category, name, template_path in NEW_PROMPTS:
                # Check if this prompt already exists for this user
                existing = session.execute(
                    text("""
                        SELECT id FROM prompt_versions
                        WHERE user_id = :user_id
                        AND function_type = :function_type
                        AND prompt_category = :category
                        AND prompt_name = :name
                    """),
                    {
                        'user_id': user_id,
                        'function_type': function_type,
                        'category': category,
                        'name': name
                    }
                ).first()

                if existing:
                    continue  # Skip if already exists

                # Load template content
                content = _load_template(template_path)

                # Insert new prompt version
                session.execute(
                    text("""
                        INSERT INTO prompt_versions
                        (id, user_id, function_type, prompt_category, prompt_name, content, version_number, is_active, is_default, note, created_at)
                        VALUES (:id, :user_id, :function_type, :category, :name, :content, 1, true, true, 'System default', :created_at)
                    """),
                    {
                        'id': str(uuid.uuid4()),
                        'user_id': user_id,
                        'function_type': function_type,
                        'category': category,
                        'name': name,
                        'content': content,
                        'created_at': datetime.utcnow()
                    }
                )

        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()


def downgrade() -> None:
    """Remove the imagePrompt templates added by this migration."""
    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        # Delete all imagePrompt prompts with object/scene names
        session.execute(
            text("""
                DELETE FROM prompt_versions
                WHERE function_type = 'imagePrompt'
                AND prompt_name IN ('object', 'scene')
            """)
        )
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()
