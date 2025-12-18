## Native Output Mode

You are in native output mode.

### For targeted edits (preferred for long content):
```json
{
  "function": "patch_manuscript",
  "id": "manuscript-123",
  "replacements": [
    { "old": "She walked slowly", "new": "She ran desperately" }
  ]
}
```

### For complete replacement:
```json
{
  "function": "replace_manuscript",
  "id": "manuscript-123",
  "content": "The full chapter content here..."
}
```

**Important:** Prefer `patch_manuscript` for targeted edits to avoid regenerating unchanged content.
