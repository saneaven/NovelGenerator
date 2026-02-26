## Native Tool Call Output

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
