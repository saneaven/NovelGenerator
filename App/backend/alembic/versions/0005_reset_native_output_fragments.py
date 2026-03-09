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

FRAGMENT_CONTENTS = {
    (("common", "nativeOutput"), "full"): """## Native Tool Call Output

You are in native tool call mode.

Output one or more `<tool_call>` entries directly.
Each `<tool_call>` MUST contain exactly one JSON object (no markdown code fences).

### Example: Multiple edits
```xml
<tool_call>{"tool":"replace_story_object","id":"char-123","type":"character","name":"Alexander the Bold"}</tool_call>
<tool_call>{"tool":"patch_story_object","id":"char-456","type":"character","field":"content","old":"fights alone","new":"leads a rebellion"}</tool_call>
<tool_call>{"tool":"create_outline_chapter","actId":"act-1","name":"The Awakening","description":"The hero discovers their power","content":"Detailed chapter content..."}</tool_call>
```

### Example: Single edit
```xml
<tool_call>{"tool":"replace_basic_info","title":"The New Title","genre":"Fantasy Adventure"}</tool_call>
```

---

## Story Object Operations

### CRUD Operations

**create_story_object**
```json
{ "tool": "create_story_object", "type": "character", "name": "Name", "description": "One-line summary", "content": "Full content" }
```

**delete_story_object**
```json
{ "tool": "delete_story_object", "id": "obj-123", "type": "character" }
```

### Replace Operations

**replace_basic_info** (only include fields to change)
```json
{ "tool": "replace_basic_info", "title": "New Title", "logline": "New logline", "genre": "New genre" }
```

**replace_story_object** (only include fields to change)
```json
{ "tool": "replace_story_object", "id": "obj-123", "type": "character", "name": "New Name", "description": "New summary", "content": "New content" }
```

### Patch Operations

**patch_basic_info** (single targeted edit)
```json
{ "tool": "patch_basic_info", "field": "logline", "old": "text to find", "new": "replacement" }
```

**patch_story_object** (single targeted edit)
```json
{ "tool": "patch_story_object", "id": "obj-123", "type": "character", "field": "content", "old": "text to find", "new": "replacement" }
```

---

## Outline Operations

**create_outline**
```json
{ "tool": "create_outline", "name": "Main Story", "description": "One-line summary", "content": "The primary storyline" }
```

**delete_outline**
```json
{ "tool": "delete_outline", "id": "outline-123" }
```

**replace_outline** (only include fields to change)
```json
{ "tool": "replace_outline", "id": "outline-123", "name": "New Name", "description": "New summary", "content": "New content" }
```

**patch_outline** (single targeted edit)
```json
{ "tool": "patch_outline", "id": "outline-123", "field": "content", "old": "text to find", "new": "replacement" }
```

---

## Act Operations

**create_outline_act**
```json
{ "tool": "create_outline_act", "outlineId": "outline-123", "name": "Act I", "description": "One-line summary", "content": "Setup and introduction" }
```

**delete_outline_act**
```json
{ "tool": "delete_outline_act", "id": "act-123" }
```

**replace_outline_act** (only include fields to change)
```json
{ "tool": "replace_outline_act", "id": "act-123", "name": "New Name", "description": "New summary", "content": "New content", "order": 2 }
```

**patch_outline_act** (single targeted edit, can also change order)
```json
{ "tool": "patch_outline_act", "id": "act-123", "field": "content", "old": "text to find", "new": "replacement", "order": 3 }
```

---

## Chapter Operations

**create_outline_chapter**
```json
{ "tool": "create_outline_chapter", "actId": "act-123", "name": "Chapter Name", "description": "One-line summary", "content": "Chapter content" }
```

**delete_outline_chapter**
```json
{ "tool": "delete_outline_chapter", "id": "ch-123" }
```

**replace_outline_chapter** (only include fields to change)
```json
{ "tool": "replace_outline_chapter", "id": "ch-123", "name": "New Name", "description": "New summary", "content": "New content", "actId": "act-456", "order": 2 }
```

**patch_outline_chapter** (single targeted edit, can also change order/actId)
```json
{ "tool": "patch_outline_chapter", "id": "ch-123", "field": "content", "old": "text to find", "new": "replacement", "actId": "act-456", "order": 3 }
```

---

## Manuscript Operations

**replace_manuscript** (full content replacement)
```json
{ "tool": "replace_manuscript", "id": "manuscript-123", "content": "The complete chapter content..." }
```

**patch_manuscript** (single targeted search-replace edit)
```json
{ "tool": "patch_manuscript", "id": "manuscript-123", "old": "text to find", "new": "replacement text" }
```

**Important:** Prefer `patch_manuscript` for targeted edits to avoid regenerating unchanged content.

---

## Important Notes

- Use exactly one `<tool_call>...</tool_call>` per tool call
- Each `<tool_call>` must contain exactly one JSON object
- Include the correct `id` for items you are editing
- Omit fields that should not change in replace operations
- Use `patch_*` for targeted edits, `replace_*` for full replacements
- For multiple patch edits, use multiple `patch_*` calls
- Valid story object types: `character`, `location`, `organization`, `lorebook`
""",
    (("common", "nativeOutput"), "manuscript"): """## Native Manuscript Output

You are in native tool call mode.

### Example: Targeted edit (preferred for long content)
```xml
<tool_call>{"tool":"patch_manuscript","id":"manuscript-123","old":"She walked slowly","new":"She ran desperately"}</tool_call>
```

### Example: Multiple targeted edits
```xml
<tool_call>{"tool":"patch_manuscript","id":"manuscript-123","old":"She walked slowly","new":"She ran desperately"}</tool_call>
<tool_call>{"tool":"patch_manuscript","id":"manuscript-123","old":"The shadows deepened","new":"Darkness fell"}</tool_call>
```

### Example: Complete replacement
```xml
<tool_call>{"tool":"replace_manuscript","id":"manuscript-123","content":"The full chapter content here..."}</tool_call>
```

### Manuscript Operations

**replace_manuscript** (full content replacement)
```json
{ "tool": "replace_manuscript", "id": "manuscript-123", "content": "The complete chapter content..." }
```

**patch_manuscript** (single targeted search-replace edit)
```json
{ "tool": "patch_manuscript", "id": "manuscript-123", "old": "text to find", "new": "replacement text" }
```

**Important:**
- Prefer `patch_manuscript` for targeted edits to avoid regenerating unchanged content.
- For multiple edits, use multiple `patch_manuscript` calls.
""",
    (("common", "nativeOutput"), "outline"): """## Native Outline Output

You are in native tool call mode.

### Example: Outline structure changes
```xml
<tool_call>{"tool":"create_outline_act","outlineId":"outline-1","name":"Act II","description":"The confrontation begins","content":"Full act content..."}</tool_call>
<tool_call>{"tool":"replace_outline_act","id":"act-123","name":"Rising Action","order":2}</tool_call>
```

### Example: Multiple patch edits
```xml
<tool_call>{"tool":"patch_outline_act","id":"act-123","field":"description","old":"the hero fails","new":"the hero succeeds"}</tool_call>
<tool_call>{"tool":"patch_outline_chapter","id":"ch-456","field":"name","old":"Chapter One","new":"The Beginning"}</tool_call>
```

### Outline Operations

**create_outline**
```json
{ "tool": "create_outline", "name": "Main Story", "description": "One-line summary", "content": "The primary storyline" }
```

**delete_outline**
```json
{ "tool": "delete_outline", "id": "outline-123" }
```

**replace_outline** (only include fields to change)
```json
{ "tool": "replace_outline", "id": "outline-123", "name": "New Name", "description": "New summary", "content": "New content" }
```

**patch_outline** (single targeted edit)
```json
{ "tool": "patch_outline", "id": "outline-123", "field": "description", "old": "text to find", "new": "replacement" }
```

### Act Operations

**create_outline_act**
```json
{ "tool": "create_outline_act", "outlineId": "outline-123", "name": "Act I", "description": "One-line summary", "content": "Setup and introduction" }
```

**delete_outline_act**
```json
{ "tool": "delete_outline_act", "id": "act-123" }
```

**replace_outline_act** (only include fields to change)
```json
{ "tool": "replace_outline_act", "id": "act-123", "name": "New Name", "description": "New summary", "content": "New content", "order": 2 }
```

**patch_outline_act** (single targeted edit, can also change order)
```json
{ "tool": "patch_outline_act", "id": "act-123", "field": "description", "old": "text to find", "new": "replacement", "order": 3 }
```

### Chapter Operations

**create_outline_chapter**
```json
{ "tool": "create_outline_chapter", "actId": "act-123", "name": "Chapter Name", "description": "One-line summary", "content": "Full chapter content" }
```

**delete_outline_chapter**
```json
{ "tool": "delete_outline_chapter", "id": "ch-123" }
```

**replace_outline_chapter** (only include fields to change)
```json
{ "tool": "replace_outline_chapter", "id": "ch-123", "name": "New Name", "description": "New summary", "content": "New content", "actId": "act-456", "order": 2 }
```

**patch_outline_chapter** (single targeted edit, can also change order/actId)
```json
{ "tool": "patch_outline_chapter", "id": "ch-123", "field": "description", "old": "text to find", "new": "replacement", "actId": "act-456", "order": 3 }
```

**Important:**
- For multiple patch edits, use multiple `patch_*` calls
- Use `order` to reposition acts/chapters
- Use `actId` in chapter operations to move chapters between acts
""",
    (("common", "nativeOutput"), "storyObject"): """## Native Tool Call Output

You are in native tool call mode.

Output one or more `<tool_call>` entries directly.
Each `<tool_call>` MUST contain exactly one JSON object (no markdown code fences).

### Example: Multiple edits
```xml
<tool_call>{"tool":"replace_story_object","id":"char-123","type":"character","name":"Alexander the Bold"}</tool_call>
<tool_call>{"tool":"patch_story_object","id":"char-456","type":"character","field":"description","old":"fights alone","new":"leads a rebellion"}</tool_call>
<tool_call>{"tool":"create_outline_chapter","actId":"act-1","name":"The Awakening","description":"The hero discovers their power","content":"Detailed chapter content..."}</tool_call>
```

### Example: Single edit
```xml
<tool_call>{"tool":"replace_basic_info","title":"The New Title","genre":"Fantasy Adventure"}</tool_call>
```

### Tool Schemas

#### CRUD Operations

**create_story_object**
```json
{ "tool": "create_story_object", "type": "character", "name": "Name", "description": "One-line summary", "content": "Full content" }
```

**delete_story_object**
```json
{ "tool": "delete_story_object", "id": "obj-123", "type": "character" }
```

#### Replace Operations

**replace_basic_info** (only include fields to change)
```json
{ "tool": "replace_basic_info", "title": "New Title", "logline": "New logline", "genre": "New genre" }
```

**replace_story_object** (only include fields to change)
```json
{ "tool": "replace_story_object", "id": "obj-123", "type": "character", "name": "New Name", "description": "New summary", "content": "New content" }
```

**replace_outline_chapter** (only include fields to change)
```json
{ "tool": "replace_outline_chapter", "id": "ch-123", "name": "New Name", "description": "New summary", "content": "New content", "actId": "act-456", "order": 2 }
```

#### Patch Operations

**patch_basic_info** (single targeted edit)
```json
{ "tool": "patch_basic_info", "field": "logline", "old": "text to find", "new": "replacement" }
```

**patch_story_object** (single targeted edit)
```json
{ "tool": "patch_story_object", "id": "obj-123", "type": "character", "field": "description", "old": "text to find", "new": "replacement" }
```

**Important:**
- Use exactly one `<tool_call>...</tool_call>` per tool call
- Each `<tool_call>` must contain exactly one JSON object
- Include the correct `id` for items you are editing
- Omit fields that should not change in replace operations
- Use `patch_*` for targeted edits, `replace_*` for full replacements
- For multiple patch edits, use multiple `patch_*` calls
- Valid story object types: `character`, `location`, `organization`, `lorebook`
""",
    (("translation",), "nativeOutput"): """## Native Output Mode

You are in native tool call mode. Output translations using one `<tool_call>` per operation.

### Translate Output (Full Translation / Overwrite)
```xml
<tool_call>{"tool":"translate_story_object","id":"char-1","type":"character","name":"Translated name","description":"One-line summary","content":"Translated full content"}</tool_call>
<tool_call>{"tool":"translate_basic_info","title":"...","logline":"...","genre":"..."}</tool_call>
<tool_call>{"tool":"translate_guidelines","id":"guidelines-1","authorNote":"Translated author note..."}</tool_call>
<tool_call>{"tool":"translate_manuscript","id":"ms-1","content":"Translated manuscript content..."}</tool_call>
```

### Patch Output (Minor Fixes - One Edit Per Call)
```xml
<tool_call>{"tool":"translate_patch_story_object","id":"char-1","type":"character","field":"name","old":"Old","new":"New"}</tool_call>
<tool_call>{"tool":"translate_patch_story_object","id":"char-1","type":"character","field":"content","old":"wrong","new":"correct"}</tool_call>
<tool_call>{"tool":"translate_patch_guidelines","id":"guidelines-1","field":"authorNote","old":"wrong","new":"correct"}</tool_call>
<tool_call>{"tool":"translate_patch_manuscript","id":"ms-1","old":"wrong text","new":"correct text"}</tool_call>
```

### Mixed Operations
You can mix `translate_*` and `translate_patch_*` operations in the same output:
```xml
<tool_call>{"tool":"translate_story_object","id":"char-1","type":"character","name":"New Translation","description":"One-line summary","content":"Full translated content"}</tool_call>
<tool_call>{"tool":"translate_patch_story_object","id":"char-2","type":"character","field":"content","old":"typo","new":"correct"}</tool_call>
```

**Note:** For multiple patch edits on the same object, use multiple `translate_patch_*` calls (one per edit).
""",
}


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
        new_contents[(tuple(segments), name)] = FRAGMENT_CONTENTS[(tuple(segments), name)]

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
