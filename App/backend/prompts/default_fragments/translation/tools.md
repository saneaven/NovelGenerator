# Translation Tool Format

## Available Tools

### Translate Tools (Full Translation / Overwrite)
Use these when there is no existing translation OR when the existing translation needs a complete rewrite.
These overwrite the target-language fields for the object.

| Tool | Use Case | Notes |
|------|----------|-------|
| `translate_basic_info` | Project basic info (title, logline, genre) | No `id` needed; updates/creates the project's basic info |
| `translate_guidelines` | Project guidelines (author note) | Requires `id` |
| `translate_story_object` | Story objects (character/location/organization/lorebook) | Requires `id` and `type` |
| `translate_outline` | Outline root | Requires `id` |
| `translate_outline_act` | Outline act | Requires `id` |
| `translate_outline_chapter` | Outline chapter | Requires `id` (optionally `actId` to move) |
| `translate_manuscript` | Manuscript content | Requires `id` and `content` |

### Patch Tools (Search-Replace Edits)
Use these when the existing translation only needs minor corrections/refinements.
Each patch call applies a single search-replace operation.

| Tool | Use Case | Notes |
|------|----------|-------|
| `translate_patch_basic_info` | Fix basic info via search-replace | Requires `field` (title/logline/genre), `old`, `new` |
| `translate_patch_guidelines` | Fix guidelines via search-replace | Requires `id`, `field` (authorNote), `old`, `new` |
| `translate_patch_story_object` | Fix story objects via search-replace | Requires `id`, `type`, `field`, `old`, `new` |
| `translate_patch_outline` | Fix outline root via search-replace | Requires `id`, `field`, `old`, `new` |
| `translate_patch_outline_act` | Fix act via search-replace | Requires `id`, `field`, `old`, `new` |
| `translate_patch_outline_chapter` | Fix chapter via search-replace | Requires `id`, `field`, `old`, `new` |
| `translate_patch_manuscript` | Fix manuscript via search-replace | Requires `id`, `old`, `new` (no `field` needed) |

### Patch Format

For object/basic/outline patches (single targeted edit):

```json
{
  "id": "object-id",
  "type": "character",
  "field": "content",
  "old": "Text to find",
  "new": "Replacement text"
}
```

For manuscript patches (no `field` needed):

```json
{
  "id": "manuscript-id",
  "old": "Text to find",
  "new": "Replacement text"
}
```

For multiple edits, make multiple patch calls:

```json
// First patch call
{ "id": "char-123", "type": "character", "field": "name", "old": "Old Name", "new": "New Name" }

// Second patch call
{ "id": "char-123", "type": "character", "field": "content", "old": "old text", "new": "new text" }
```

## Decision Guide

For each object to translate:

1. **No existing translation** → Use `translate_*`
2. **Existing translation needs a full rewrite** → Use `translate_*`
3. **Existing translation needs only small fixes** → Use `translate_patch_*` (multiple calls for multiple fixes)
