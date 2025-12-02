"""add_imagePrompt_defaults

Revision ID: 014
Revises: 013
Create Date: 2025-12-01

Add imagePrompt default prompts for existing users.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from datetime import datetime
import uuid
from pathlib import Path

revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def load_prompt_file(relative_path: str) -> str:
    """Load a prompt template file."""
    templates_dir = Path(__file__).parent.parent.parent / 'prompts' / 'templates'
    with open(templates_dir / relative_path, 'r', encoding='utf-8') as f:
        return f.read()


def upgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)

    # Load templates
    system_prompt = load_prompt_file('systemPrompts/ImagePromptGenSystemPrompt.md')
    user_prompt = load_prompt_file('userPrompts/ImagePromptGenUserPrompt.md')

    # Get all existing users
    result = session.execute(sa.text("SELECT id FROM users"))
    users = result.fetchall()

    for (user_id,) in users:
        # Skip if already exists
        existing = session.execute(
            sa.text("SELECT id FROM prompt_versions WHERE user_id = :user_id AND function_type = 'imagePrompt'"),
            {"user_id": user_id}
        ).fetchone()
        if existing:
            continue

        # Insert system prompt
        session.execute(sa.text("""
            INSERT INTO prompt_versions (id, user_id, function_type, prompt_category, content, version_number, is_active, is_default, note, created_at)
            VALUES (:id, :user_id, 'imagePrompt', 'systemPrompt', :content, 1, true, true, 'System default', :created_at)
        """), {"id": str(uuid.uuid4()), "user_id": user_id, "content": system_prompt, "created_at": datetime.utcnow()})

        # Insert user prompt
        session.execute(sa.text("""
            INSERT INTO prompt_versions (id, user_id, function_type, prompt_category, content, version_number, is_active, is_default, note, created_at)
            VALUES (:id, :user_id, 'imagePrompt', 'userPrompt', :content, 1, true, true, 'System default', :created_at)
        """), {"id": str(uuid.uuid4()), "user_id": user_id, "content": user_prompt, "created_at": datetime.utcnow()})

    session.commit()


def downgrade() -> None:
    op.execute("DELETE FROM prompt_versions WHERE function_type = 'imagePrompt'")
