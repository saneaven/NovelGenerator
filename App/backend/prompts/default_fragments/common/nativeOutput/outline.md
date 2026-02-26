## Native Outline Output

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
