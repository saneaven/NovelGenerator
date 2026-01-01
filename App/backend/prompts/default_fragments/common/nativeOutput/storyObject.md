## Native Output Format

Output a JSON array containing all function calls. Each object in the array represents one function call.

### Example: Multiple edits
```json
[
  {
    "function": "replace_story_object",
    "id": "char-123",
    "type": "character",
    "name": "Alexander the Bold"
  },
  {
    "function": "patch_story_object",
    "id": "char-456",
    "type": "character",
    "replacements": [
      { "field": "description", "old": "fights alone", "new": "leads a rebellion" }
    ]
  },
  {
    "function": "create_chapter",
    "actId": "act-1",
    "name": "The Awakening",
    "description": "The hero discovers their power"
  }
]
```

### Example: Single edit
```json
[
  {
    "function": "replace_basic_info",
    "title": "The New Title",
    "genre": "Fantasy Adventure"
  }
]
```

### Function Schemas

#### CRUD Operations

**create_story_object**
```json
{ "function": "create_story_object", "type": "character", "name": "Name", "description": "Description" }
```

**delete_story_object**
```json
{ "function": "delete_story_object", "id": "obj-123", "type": "character" }
```

**create_chapter**
```json
{ "function": "create_chapter", "actId": "act-123", "name": "Chapter Name", "description": "Description" }
```

**delete_chapter**
```json
{ "function": "delete_chapter", "id": "ch-123" }
```

#### Replace Operations

**replace_basic_info** (only include fields to change)
```json
{ "function": "replace_basic_info", "title": "New Title", "logline": "New logline", "genre": "New genre" }
```

**replace_story_object** (only include fields to change)
```json
{ "function": "replace_story_object", "id": "obj-123", "type": "character", "name": "New Name", "description": "New description" }
```

**replace_chapter_outline** (only include fields to change)
```json
{ "function": "replace_chapter_outline", "id": "ch-123", "name": "New Name", "description": "New description", "actId": "act-456", "order": 2 }
```

#### Patch Operations

**patch_basic_info**
```json
{ "function": "patch_basic_info", "replacements": [{ "field": "logline", "old": "text to find", "new": "replacement" }] }
```

**patch_story_object**
```json
{ "function": "patch_story_object", "id": "obj-123", "type": "character", "replacements": [{ "field": "description", "old": "text to find", "new": "replacement" }] }
```

**patch_chapter_outline**
```json
{ "function": "patch_chapter_outline", "id": "ch-123", "replacements": [{ "field": "description", "old": "text to find", "new": "replacement" }], "order": 3 } // order is 1 oriented
```

**Important:**
- Always output a JSON array, even for a single function call
- Include the correct `id` for items you are editing
- Omit fields that should not change in replace operations
- Use `patch_*` for targeted edits, `replace_*` for full replacements
- Valid story object types: `character`, `location`, `organization`, `lorebook`