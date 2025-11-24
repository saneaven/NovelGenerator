"""Rename reasoning to thinking in configs and content parts

Revision ID: 008
Revises: 007
Create Date: 2025-11-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import json

# revision identifiers, used by Alembic.
revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def _migrate_function_configs(conn):
    res = conn.execute(sa.text("SELECT id, function_configs FROM user_settings"))
    updates = []
    for row in res:
        fc = row['function_configs']
        if not isinstance(fc, dict):
            continue
        changed = False
        for cfg in fc.values():
            adv = cfg.get('advanced') if isinstance(cfg, dict) else None
            if not isinstance(adv, dict):
                continue
            if 'reasoningConfig' in adv:
                # Move reasoningConfig -> thinkingConfig
                adv.setdefault('thinkingConfig', adv.pop('reasoningConfig'))
                # Clean up any leftover key
                adv.pop('reasoningConfig', None)
                changed = True
        if changed:
            updates.append({'id': row['id'], 'function_configs': json.dumps(fc)})

    for upd in updates:
        conn.execute(
            sa.text("UPDATE user_settings SET function_configs = :fc WHERE id = :id"),
            {"fc": upd['function_configs'], "id": upd['id']}
        )


def _migrate_chat_messages(conn):
    res = conn.execute(sa.text("SELECT id, data FROM chat_messages"))
    updates = []
    for row in res:
        data = row['data']
        if not isinstance(data, dict):
            continue
        changed = False
        for lang_val in data.values():
            if not isinstance(lang_val, dict):
                continue
            parts = lang_val.get('contentParts')
            if not isinstance(parts, list):
                continue
            for part in parts:
                if isinstance(part, dict) and part.get('type') == 'reasoning':
                    part['type'] = 'thinking'
                    changed = True
        if changed:
            updates.append({'id': row['id'], 'data': json.dumps(data)})

    for upd in updates:
        conn.execute(
            sa.text("UPDATE chat_messages SET data = :data WHERE id = :id"),
            {"data": upd['data'], "id": upd['id']}
        )


def upgrade() -> None:
    conn = op.get_bind()
    _migrate_function_configs(conn)
    _migrate_chat_messages(conn)


def downgrade() -> None:
    conn = op.get_bind()

    # Reverse function_configs change: thinkingConfig -> reasoningConfig if missing
    res = conn.execute(sa.text("SELECT id, function_configs FROM user_settings"))
    updates = []
    for row in res:
        fc = row['function_configs']
        if not isinstance(fc, dict):
            continue
        changed = False
        for cfg in fc.values():
            adv = cfg.get('advanced') if isinstance(cfg, dict) else None
            if not isinstance(adv, dict):
                continue
            if 'thinkingConfig' in adv and 'reasoningConfig' not in adv:
                adv['reasoningConfig'] = adv.get('thinkingConfig')
                changed = True
        if changed:
            updates.append({'id': row['id'], 'function_configs': json.dumps(fc)})

    for upd in updates:
        conn.execute(
            sa.text("UPDATE user_settings SET function_configs = :fc WHERE id = :id"),
            {"fc": upd['function_configs'], "id": upd['id']}
        )

    # Reverse chat_messages change: thinking -> reasoning
    res = conn.execute(sa.text("SELECT id, data FROM chat_messages"))
    updates = []
    for row in res:
        data = row['data']
        if not isinstance(data, dict):
            continue
        changed = False
        for lang_val in data.values():
            if not isinstance(lang_val, dict):
                continue
            parts = lang_val.get('contentParts')
            if not isinstance(parts, list):
                continue
            for part in parts:
                if isinstance(part, dict) and part.get('type') == 'thinking':
                    part['type'] = 'reasoning'
                    changed = True
        if changed:
            updates.append({'id': row['id'], 'data': json.dumps(data)})

    for upd in updates:
        conn.execute(
            sa.text("UPDATE chat_messages SET data = :data WHERE id = :id"),
            {"data": upd['data'], "id": upd['id']}
        )
