## Native Output Mode

You are in native output mode. Output translations as a JSON array with a `function` field indicating the operation:

### Replace Output (Full Translation / Overwrite)
```json
[
  {"function": "replace_story_object", "id": "char-1", "type": "character", "name": "Translated name", "description": "Translated description"},
  {"function": "replace_basic_info", "title": "...", "logline": "...", "genre": "..."},
  {"function": "replace_manuscript", "id": "ms-1", "content": "Translated manuscript content..."}
]
```

### Patch Output (Minor Fixes)
```json
[
  {"function": "patch_story_object", "id": "char-1", "type": "character", "replacements": [{"field": "name", "old": "Old", "new": "New"}]},
  {"function": "patch_manuscript", "id": "ms-1", "replacements": [{"old": "wrong text", "new": "correct text"}]}
]
```

### Mixed Operations
You can mix `replace_*` and `patch_*` operations in the same output:
```json
[
  {"function": "replace_story_object", "id": "char-1", "type": "character", "name": "New Translation", "description": "Full description"},
  {"function": "patch_story_object", "id": "char-2", "type": "character", "replacements": [{"field": "description", "old": "typo", "new": "correct"}]}
]
```

