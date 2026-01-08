## Native Manuscript Output

You are in native function call mode.

### Example: Targeted edit (preferred for long content)
```xml
<function_calls>
  <function_call>{"function":"patch_manuscript","id":"manuscript-123","replacements":[{"old":"She walked slowly","new":"She ran desperately"}]}</function_call>
</function_calls>
```

### Example: Complete replacement
```xml
<function_calls>
  <function_call>{"function":"replace_manuscript","id":"manuscript-123","content":"The full chapter content here..."}</function_call>
</function_calls>
```

### Manuscript Operations

**replace_manuscript** (full content replacement)
```json
{ "function": "replace_manuscript", "id": "manuscript-123", "content": "The complete chapter content..." }
```

**patch_manuscript** (targeted search-replace edits)
```json
{ "function": "patch_manuscript", "id": "manuscript-123", "replacements": [{ "old": "text to find", "new": "replacement text" }] }
```

**Important:** Prefer `patch_manuscript` for targeted edits to avoid regenerating unchanged content.
