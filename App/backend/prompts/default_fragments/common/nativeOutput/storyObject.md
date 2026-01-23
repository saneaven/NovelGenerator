## Native Function Call Output

You are in native function call mode.

Output a `<function_calls>` block containing one or more `<function_call>` entries.
Each `<function_call>` MUST contain exactly one JSON object (no markdown code fences).

### Example: Multiple edits
```xml
<function_calls>
  <function_call>{"function":"replace_story_object","id":"char-123","type":"character","name":"Alexander the Bold"}</function_call>
  <function_call>{"function":"patch_story_object","id":"char-456","type":"character","field":"description","old":"fights alone","new":"leads a rebellion"}</function_call>
  <function_call>{"function":"create_outline_chapter","actId":"act-1","name":"The Awakening","description":"The hero discovers their power","content":"Detailed chapter content..."}</function_call>
</function_calls>
```

### Example: Single edit
```xml
<function_calls>
  <function_call>{"function":"replace_basic_info","title":"The New Title","genre":"Fantasy Adventure"}</function_call>
</function_calls>
```

### Function Schemas

#### CRUD Operations

**create_story_object**
```json
{ "function": "create_story_object", "type": "character", "name": "Name", "description": "One-line summary", "content": "Full content" }
```

**delete_story_object**
```json
{ "function": "delete_story_object", "id": "obj-123", "type": "character" }
```

#### Replace Operations

**replace_basic_info** (only include fields to change)
```json
{ "function": "replace_basic_info", "title": "New Title", "logline": "New logline", "genre": "New genre" }
```

**replace_story_object** (only include fields to change)
```json
{ "function": "replace_story_object", "id": "obj-123", "type": "character", "name": "New Name", "description": "New summary", "content": "New content" }
```

**replace_outline_chapter** (only include fields to change)
```json
{ "function": "replace_outline_chapter", "id": "ch-123", "name": "New Name", "description": "New summary", "content": "New content", "actId": "act-456", "order": 2 }
```

#### Patch Operations

**patch_basic_info** (single targeted edit)
```json
{ "function": "patch_basic_info", "field": "logline", "old": "text to find", "new": "replacement" }
```

**patch_story_object** (single targeted edit)
```json
{ "function": "patch_story_object", "id": "obj-123", "type": "character", "field": "description", "old": "text to find", "new": "replacement" }
```

**Important:**
- Always output a `<function_calls>` wrapper, even for a single function call
- Use exactly one `<function_call>...</function_call>` per function call
- Each `<function_call>` must contain exactly one JSON object
- Include the correct `id` for items you are editing
- Omit fields that should not change in replace operations
- Use `patch_*` for targeted edits, `replace_*` for full replacements
- For multiple patch edits, use multiple `patch_*` calls
- Valid story object types: `character`, `location`, `organization`, `lorebook`
