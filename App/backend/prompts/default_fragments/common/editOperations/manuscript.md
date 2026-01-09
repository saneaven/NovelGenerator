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

Each patch operation applies a single search-and-replace:

```json
{
  "id": "manuscript-123",
  "old": "text to find",
  "new": "replacement text"
}
```

**Important Rules:**
- The `old` string must be **unique** in the manuscript - include enough context to ensure uniqueness
- If multiple matches exist, add more surrounding text to `old` to make it unique
- For multiple changes, make multiple patch function calls

### Example: Changing a phrase

Original text:
```
She walked slowly through the forest. The shadows deepened around her.
```

To change "walked slowly" to "ran desperately":
```json
{
  "id": "manuscript-123",
  "old": "She walked slowly through the forest",
  "new": "She ran desperately through the forest"
}
```

### Example: Multiple changes

For multiple edits, call patch_manuscript multiple times:
```json
// First patch call
{ "id": "manuscript-123", "old": "walked slowly", "new": "ran desperately" }

// Second patch call
{ "id": "manuscript-123", "old": "The shadows deepened", "new": "Darkness fell" }
```

## Available Functions

### Replace Operations
- `replace_manuscript` - Replace manuscript content (full chapter rewrite)

### Patch Operations
- `patch_manuscript` - Patch manuscript using search-replace (single targeted edit per call)

## Guidelines

- Use `replace_manuscript` when changing most of the content or for short chapters
- Use `patch_manuscript` for targeted changes in long chapters
- For patch operations, ensure the `old` string is unique
- For multiple edits, make multiple patch calls
