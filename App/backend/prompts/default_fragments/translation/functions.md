# Translation Function Format

## Available Functions

### Replace Functions (Full Translation / Overwrite)
Use these when there is no existing translation OR when the existing translation needs a complete rewrite.
These overwrite the target-language fields for the object.

| Function | Use Case | Notes |
|----------|----------|-------|
| `replace_basic_info` | Project basic info (title, logline, genre) | No `id` needed; updates/creates the project's basic info |
| `replace_story_object` | Story objects (character/location/organization/lorebook) | Requires `id` and `type` |
| `replace_outline` | Outline root | Requires `id` |
| `replace_outline_act` | Outline act | Requires `id` |
| `replace_outline_chapter` | Outline chapter | Requires `id` (optionally `actId` to move) |
| `replace_manuscript` | Manuscript content | Requires `id` and `content` |

### Patch Functions (Search-Replace Edits)
Use these when the existing translation only needs minor corrections/refinements.

| Function | Use Case | Notes |
|----------|----------|-------|
| `patch_basic_info` | Fix basic info via replacements | `replacements[]` targets `title` / `logline` / `genre` |
| `patch_story_object` | Fix story objects via replacements | Requires `id` and `type` |
| `patch_outline` | Fix outline root via replacements | Requires `id` |
| `patch_outline_act` | Fix act via replacements | Requires `id` |
| `patch_outline_chapter` | Fix chapter via replacements | Requires `id` |
| `patch_manuscript` | Fix manuscript via replacements | No `field` needed in replacements |

### Patch Replacement Format

For object/basic/outline patches, the `replacements` array contains search-replace operations:

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

For manuscript patches (no `field` needed):

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

1. **No existing translation** → Use `replace_*`
2. **Existing translation needs a full rewrite** → Use `replace_*`
3. **Existing translation needs only small fixes** → Use `patch_*`

