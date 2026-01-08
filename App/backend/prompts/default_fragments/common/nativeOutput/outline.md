## Native Outline Output

You are in native function call mode.

### Example: Outline structure changes
```xml
<function_calls>
  <function_call>{"function":"create_outline_act","outlineId":"outline-1","name":"Act II","description":"The confrontation begins"}</function_call>
  <function_call>{"function":"replace_outline_act","id":"act-123","name":"Rising Action","order":2}</function_call>
</function_calls>
```

### Outline Operations

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

### Act Operations

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
