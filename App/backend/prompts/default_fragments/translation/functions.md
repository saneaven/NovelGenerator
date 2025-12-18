# Translation Function Format

## Available Functions

### Set Functions (Full Translation - New or Replace)
Use these when there is no existing translation OR when the existing translation needs a complete rewrite:

| Function | Use Case | Required Fields |
|----------|----------|-----------------|
| `set_basic_info_translation` | Basic info (title, logline, genre) | id, title, logline, genre |
| `set_object_translation` | Story objects | id, type, name, description |
| `set_chapter_translation` | Acts and chapters | id, type, name, description |
| `set_manuscript_translation` | Manuscript content | id, content |

### Patch Functions (Search-Replace Edits)
Use these when the existing translation only needs minor corrections or refinements:

| Function | Use Case | Required Fields |
|----------|----------|-----------------|
| `patch_basic_info_translation` | Fix basic info | id, replacements[] |
| `patch_object_translation` | Fix story objects | id, type, replacements[] |
| `patch_chapter_translation` | Fix acts/chapters | id, type, replacements[] |
| `patch_manuscript_translation` | Fix manuscript | id, replacements[] |

### Patch Replacement Format

For patch functions, the `replacements` array contains search-replace operations:

```json
{
  "id": "object-id",
  "type": "character",
  "replacements": [
    {"field": "name", "old": "Text to find", "new": "Replacement text"},
    {"field": "description", "old": "Another text", "new": "Its replacement"}
  ]
}
```

For manuscript patches (no field needed):
```json
{
  "id": "manuscript-id",
  "replacements": [
    {"old": "Text to find", "new": "Replacement text"},
    {"old": "Another text", "new": "Its replacement"}
  ]
}
```

## Decision Guide

For each object to translate:

1. **No existing translation** → Use `set_*` function
2. **Existing translation needs complete rewrite** → Use `set_*` function
3. **Existing translation needs only minor fixes** → Use `patch_*` function
