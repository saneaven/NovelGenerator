## Native Manuscript Output

You are in native tool call mode.

### Example: Targeted edit (preferred for long content)
```xml
<tool_calls>
  <tool_call>{"tool":"patch_manuscript","id":"manuscript-123","old":"She walked slowly","new":"She ran desperately"}</tool_call>
</tool_calls>
```

### Example: Multiple targeted edits
```xml
<tool_calls>
  <tool_call>{"tool":"patch_manuscript","id":"manuscript-123","old":"She walked slowly","new":"She ran desperately"}</tool_call>
  <tool_call>{"tool":"patch_manuscript","id":"manuscript-123","old":"The shadows deepened","new":"Darkness fell"}</tool_call>
</tool_calls>
```

### Example: Complete replacement
```xml
<tool_calls>
  <tool_call>{"tool":"replace_manuscript","id":"manuscript-123","content":"The full chapter content here..."}</tool_call>
</tool_calls>
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
