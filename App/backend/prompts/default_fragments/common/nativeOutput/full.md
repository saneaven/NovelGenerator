## Native Function Call Output

You are in native function call mode.

Output a `<function_calls>` block containing one or more `<function_call>` entries.
Each `<function_call>` MUST contain exactly one JSON object (no markdown code fences).

### Example: Multiple edits
```xml
<function_calls>
  <function_call>{"function":"replace_story_object","id":"char-123","type":"character","name":"Alexander the Bold"}</function_call>
  <function_call>{"function":"patch_story_object","id":"char-456","type":"character","replacements":[{"field":"description","old":"fights alone","new":"leads a rebellion"}]}</function_call>
  <function_call>{"function":"create_outline_chapter","actId":"act-1","name":"The Awakening","description":"The hero discovers their power"}</function_call>
</function_calls>
```

### Example: Single edit
```xml
<function_calls>
  <function_call>{"function":"replace_basic_info","title":"The New Title","genre":"Fantasy Adventure"}</function_call>
</function_calls>
```

---

## Story Object Operations

### CRUD Operations

**create_story_object**
```json
{ "function": "create_story_object", "type": "character", "name": "Name", "description": "Description" }
```

**delete_story_object**
```json
{ "function": "delete_story_object", "id": "obj-123", "type": "character" }
```

### Replace Operations

**replace_basic_info** (only include fields to change)
```json
{ "function": "replace_basic_info", "title": "New Title", "logline": "New logline", "genre": "New genre" }
```

**replace_story_object** (only include fields to change)
```json
{ "function": "replace_story_object", "id": "obj-123", "type": "character", "name": "New Name", "description": "New description" }
```

### Patch Operations

**patch_basic_info**
```json
{ "function": "patch_basic_info", "replacements": [{ "field": "logline", "old": "text to find", "new": "replacement" }] }
```

**patch_story_object**
```json
{ "function": "patch_story_object", "id": "obj-123", "type": "character", "replacements": [{ "field": "description", "old": "text to find", "new": "replacement" }] }
```

---

## Outline Operations

**create_outline**
```json
{ "function": "create_outline", "name": "Main Story", "description": "The primary storyline" }
```

**delete_outline**
```json
{ "function": "delete_outline", "id": "outline-123" }
```

**replace_outline** (only include fields to change)
```json
{ "function": "replace_outline", "id": "outline-123", "name": "New Name", "description": "New description" }
```

**patch_outline**
```json
{ "function": "patch_outline", "id": "outline-123", "replacements": [{ "field": "description", "old": "text to find", "new": "replacement" }] }
```

---

## Act Operations

**create_outline_act**
```json
{ "function": "create_outline_act", "outlineId": "outline-123", "name": "Act I", "description": "Setup and introduction" }
```

**delete_outline_act**
```json
{ "function": "delete_outline_act", "id": "act-123" }
```

**replace_outline_act** (only include fields to change)
```json
{ "function": "replace_outline_act", "id": "act-123", "name": "New Name", "description": "New description", "order": 2 }
```

**patch_outline_act**
```json
{ "function": "patch_outline_act", "id": "act-123", "replacements": [{ "field": "description", "old": "text to find", "new": "replacement" }], "order": 3 }
```

---

## Chapter Operations

**create_outline_chapter**
```json
{ "function": "create_outline_chapter", "actId": "act-123", "name": "Chapter Name", "description": "Description" }
```

**delete_outline_chapter**
```json
{ "function": "delete_outline_chapter", "id": "ch-123" }
```

**replace_outline_chapter** (only include fields to change)
```json
{ "function": "replace_outline_chapter", "id": "ch-123", "name": "New Name", "description": "New description", "actId": "act-456", "order": 2 }
```

**patch_outline_chapter**
```json
{ "function": "patch_outline_chapter", "id": "ch-123", "replacements": [{ "field": "description", "old": "text to find", "new": "replacement" }], "actId": "act-456", "order": 3 }
```

---

## Manuscript Operations

**replace_manuscript** (full content replacement)
```json
{ "function": "replace_manuscript", "id": "manuscript-123", "content": "The complete chapter content..." }
```

**patch_manuscript** (targeted search-replace edits)
```json
{ "function": "patch_manuscript", "id": "manuscript-123", "replacements": [{ "old": "text to find", "new": "replacement text" }] }
```

**Important:** Prefer `patch_manuscript` for targeted edits to avoid regenerating unchanged content.

---

## Important Notes

- Always output a `<function_calls>` wrapper, even for a single function call
- Use exactly one `<function_call>...</function_call>` per function call
- Each `<function_call>` must contain exactly one JSON object
- Include the correct `id` for items you are editing
- Omit fields that should not change in replace operations
- Use `patch_*` for targeted edits, `replace_*` for full replacements
- Valid story object types: `character`, `location`, `organization`, `lorebook`
