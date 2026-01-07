## Native Output Mode

You are in native function call mode.

### For targeted edits (preferred for long content):
```xml
<function_calls>
  <function_call>{"function":"patch_manuscript","id":"manuscript-123","replacements":[{"old":"She walked slowly","new":"She ran desperately"}]}</function_call>
</function_calls>
```

### For complete replacement:
```xml
<function_calls>
  <function_call>{"function":"replace_manuscript","id":"manuscript-123","content":"The full chapter content here..."}</function_call>
</function_calls>
```

**Important:** Prefer `patch_manuscript` for targeted edits to avoid regenerating unchanged content.
