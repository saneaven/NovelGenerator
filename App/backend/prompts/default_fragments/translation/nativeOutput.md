## Native Output Mode

You are in native output mode. Output translations as a JSON array with a `function` field indicating the operation:

### Set Function Output
```json
[
  {"function": "set_object_translation", "id": "char-1", "type": "character", "name": "Translated name", "description": "Translated description"},
  {"function": "set_basic_info_translation", "id": "basic-info-id", "title": "...", "logline": "...", "genre": "..."}
]
```

### Patch Function Output
```json
[
  {"function": "patch_object_translation", "id": "char-1", "type": "character", "replacements": [{"field": "name", "old": "Old", "new": "New"}]},
  {"function": "patch_manuscript_translation", "id": "ms-1", "replacements": [{"old": "wrong text", "new": "correct text"}]}
]
```

### Mixed Operations
You can mix set_* and patch_* operations in the same output:
```json
[
  {"function": "set_object_translation", "id": "char-1", "type": "character", "name": "New Translation", "description": "Full description"},
  {"function": "patch_object_translation", "id": "char-2", "type": "character", "replacements": [{"field": "description", "old": "typo", "new": "correct"}]}
]
```
