## Native Tool Call Output

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
