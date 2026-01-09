## Native Manuscript Output

You are in native function call mode.

### Example: Targeted edit (preferred for long content)
```xml
<function_calls>
  <function_call>{"function":"patch_manuscript","id":"manuscript-123","old":"She walked slowly","new":"She ran desperately"}</function_call>
</function_calls>
```

### Example: Multiple targeted edits
```xml
<function_calls>
  <function_call>{"function":"patch_manuscript","id":"manuscript-123","old":"She walked slowly","new":"She ran desperately"}</function_call>
  <function_call>{"function":"patch_manuscript","id":"manuscript-123","old":"The shadows deepened","new":"Darkness fell"}</function_call>
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

**patch_manuscript** (single targeted search-replace edit)
```json
{ "function": "patch_manuscript", "id": "manuscript-123", "old": "text to find", "new": "replacement text" }
```

**Important:**
- Prefer `patch_manuscript` for targeted edits to avoid regenerating unchanged content.
- For multiple edits, use multiple `patch_manuscript` calls.
