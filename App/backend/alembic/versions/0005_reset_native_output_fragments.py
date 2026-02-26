"""Reset nativeOutput fragments to updated defaults (flat <tool_call> format).

The native tool call format changed from nested <tool_calls><tool_call>...</tool_call></tool_calls>
to flat top-level <tool_call>...</tool_call> tags. This migration creates a new version
of each affected fragment with the updated content from the filesystem defaults.

Affected fragments:
  - common/nativeOutput/full
  - common/nativeOutput/manuscript
  - common/nativeOutput/outline
  - common/nativeOutput/storyObject
  - translation/nativeOutput
"""

from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from alembic import op
import sqlalchemy as sa


revision = "0005_reset_native_output_fragments"
down_revision = "0004_remove_prefill"
branch_labels = None
depends_on = None

# Fragment paths to reset: (folder_path_segments, fragment_name)
TARGETS = [
    (["common", "nativeOutput"], "full"),
    (["common", "nativeOutput"], "manuscript"),
    (["common", "nativeOutput"], "outline"),
    (["common", "nativeOutput"], "storyObject"),
    (["translation"], "nativeOutput"),
]

FRAGMENTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "default_fragments"


def _load_fragment(folder_segments: list[str], name: str) -> str:
    """Load a fragment .md file from the default_fragments directory."""
    path = FRAGMENTS_DIR / "/".join(folder_segments) / f"{name}.md"
    return path.read_text(encoding="utf-8")


def _resolve_folder_id(conn, preset_id, folder_segments: list[str]):
    """Walk down the folder hierarchy to resolve a folder_id for a preset."""
    parent_id = None
    for segment in folder_segments:
        if parent_id is None:
            row = conn.execute(
                sa.text(
                    "SELECT id FROM prompt_folders "
                    "WHERE preset_id = :pid AND name = :name AND parent_id IS NULL"
                ),
                {"pid": str(preset_id), "name": segment},
            ).first()
        else:
            row = conn.execute(
                sa.text(
                    "SELECT id FROM prompt_folders "
                    "WHERE preset_id = :pid AND name = :name AND parent_id = :parent"
                ),
                {"pid": str(preset_id), "name": segment, "parent": str(parent_id)},
            ).first()
        if row is None:
            return None
        parent_id = row[0]
    return parent_id


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.utcnow().isoformat()

    # Load updated content for each target fragment
    new_contents: dict[tuple, str] = {}
    for segments, name in TARGETS:
        new_contents[(tuple(segments), name)] = _load_fragment(segments, name)

    # Get all preset IDs
    presets = conn.execute(sa.text("SELECT id FROM prompt_presets")).fetchall()

    for (preset_row,) in presets:
        preset_id = preset_row

        for segments, frag_name in TARGETS:
            folder_id = _resolve_folder_id(conn, preset_id, segments)
            if folder_id is None:
                continue

            # Find latest version of this fragment
            latest = conn.execute(
                sa.text(
                    "SELECT user_id, MAX(version_number) as max_ver "
                    "FROM prompt_fragments "
                    "WHERE preset_id = :pid AND folder_id = :fid AND fragment_name = :fname "
                    "GROUP BY user_id"
                ),
                {"pid": str(preset_id), "fid": str(folder_id), "fname": frag_name},
            ).fetchall()

            if not latest:
                continue

            content = new_contents[(tuple(segments), frag_name)]

            for user_id, max_ver in latest:
                conn.execute(
                    sa.text(
                        "INSERT INTO prompt_fragments "
                        "(id, user_id, preset_id, folder_id, fragment_name, content, "
                        " version_number, note, created_at, updated_at) "
                        "VALUES (:id, :uid, :pid, :fid, :fname, :content, "
                        " :ver, :note, :created, :updated)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "uid": str(user_id),
                        "pid": str(preset_id),
                        "fid": str(folder_id),
                        "fname": frag_name,
                        "content": content,
                        "ver": max_ver + 1,
                        "note": "Migration: update to flat <tool_call> format",
                        "created": now,
                        "updated": now,
                    },
                )


def downgrade() -> None:
    raise NotImplementedError("Destructive migration — cannot downgrade")
