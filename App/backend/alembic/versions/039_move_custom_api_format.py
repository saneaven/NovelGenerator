"""Move customApiFormat from thinkingConfig to advanced level

Revision ID: 039
Revises: 038
Create Date: 2025-01-02
"""
from alembic import op
import sqlalchemy as sa
import json

# revision identifiers, used by Alembic.
revision = '039'
down_revision = '038'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Move customApiFormat from advanced.thinkingConfig to advanced level."""
    conn = op.get_bind()
    res = conn.execute(sa.text("SELECT id, function_configs FROM user_settings"))
    updates = []

    for row in res:
        row_id, fc = row[0], row[1]
        if not isinstance(fc, dict):
            continue
        changed = False

        for cfg in fc.values():
            if not isinstance(cfg, dict):
                continue
            adv = cfg.get('advanced')
            if not isinstance(adv, dict):
                continue

            thinking_config = adv.get('thinkingConfig')
            if isinstance(thinking_config, dict) and 'customApiFormat' in thinking_config:
                # Move customApiFormat from thinkingConfig to advanced level
                custom_api_format = thinking_config.pop('customApiFormat')
                if custom_api_format:  # Only set if it has a value
                    adv['customApiFormat'] = custom_api_format
                changed = True

        if changed:
            updates.append({'id': row_id, 'function_configs': json.dumps(fc)})

    for upd in updates:
        conn.execute(
            sa.text("UPDATE user_settings SET function_configs = :fc WHERE id = :id"),
            {"fc": upd['function_configs'], "id": upd['id']}
        )


def downgrade() -> None:
    """Move customApiFormat back from advanced to thinkingConfig."""
    conn = op.get_bind()
    res = conn.execute(sa.text("SELECT id, function_configs FROM user_settings"))
    updates = []

    for row in res:
        row_id, fc = row[0], row[1]
        if not isinstance(fc, dict):
            continue
        changed = False

        for cfg in fc.values():
            if not isinstance(cfg, dict):
                continue
            adv = cfg.get('advanced')
            if not isinstance(adv, dict):
                continue

            if 'customApiFormat' in adv:
                custom_api_format = adv.pop('customApiFormat')
                # Ensure thinkingConfig exists
                if 'thinkingConfig' not in adv or not isinstance(adv.get('thinkingConfig'), dict):
                    adv['thinkingConfig'] = {}
                if custom_api_format:
                    adv['thinkingConfig']['customApiFormat'] = custom_api_format
                changed = True

        if changed:
            updates.append({'id': row_id, 'function_configs': json.dumps(fc)})

    for upd in updates:
        conn.execute(
            sa.text("UPDATE user_settings SET function_configs = :fc WHERE id = :id"),
            {"fc": upd['function_configs'], "id": upd['id']}
        )
