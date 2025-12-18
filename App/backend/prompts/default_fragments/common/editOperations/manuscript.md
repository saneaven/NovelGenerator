# Edit Function Format

## Edit Operations

There are two types of edit operations:

### Replace Operation (`replace_manuscript`)
Use for **full content replacement**:
- Writing new chapters from scratch
- Complete rewrites where most content changes
- Short chapters

### Patch Operation (`patch_manuscript`)
Use for **targeted search-and-replace edits**:
- Fixing typos, changing dialogue, adjusting descriptions
- Adding or removing specific paragraphs
- When most of the original content remains unchanged
- Long chapters where only parts need modification

## Patch Format (Search & Replace)

The patch operation uses a simple search-and-replace approach:

```json
{
  "id": "manuscript-123",
  "replacements": [
    { "old": "text to find", "new": "replacement text" }
  ]
}
```

**Important Rules:**
- The `old` string must be **unique** in the manuscript - include enough context to ensure uniqueness
- If multiple matches exist, add more surrounding text to `old` to make it unique
- For multiple changes, use multiple replacement objects in the array

### Example: Changing a phrase

Original text:
```
She walked slowly through the forest. The shadows deepened around her.
```

To change "walked slowly" to "ran desperately":
```json
{
  "id": "manuscript-123",
  "replacements": [
    { "old": "She walked slowly through the forest", "new": "She ran desperately through the forest" }
  ]
}
```

## Available Functions

### Replace Operations
- `replace_manuscript` - Replace manuscript content (full chapter rewrite)

### Patch Operations
- `patch_manuscript` - Patch manuscript using search-replace (targeted edits)

## Guidelines

- Use `replace_manuscript` when changing most of the content or for short chapters
- Use `patch_manuscript` for targeted changes in long chapters
- For patch operations, ensure the `old` string is unique
