# Outline Edit Function Format

## Edit Operations

There are two types of edit operations for outline elements:

### Replace Operation (`replace_*`)
Use for **full content replacement**:
- Short fields (names, titles)
- Complete rewrites
- New content creation

### Patch Operation (`patch_*`)
Use for **targeted search-and-replace edits**:
- Changing specific phrases in descriptions
- When most of the original content remains unchanged
- Multiple small changes in a single field

## Patch Format (Search & Replace)

The patch operation uses a simple search-and-replace approach:

```json
{
  "replacements": [
    { "field": "description", "old": "text to find", "new": "replacement text" }
  ]
}
```

**Important Rules:**
- The `old` string must be **unique** in the field - include enough context to ensure uniqueness
- If multiple matches exist, add more surrounding text to `old` to make it unique
- For multiple changes, use multiple replacement objects in the array

## Available Functions

### Outline CRUD Operations
- `create_outline` - Create a new outline (for parallel storylines)
- `delete_outline` - Delete an outline and all its acts/chapters
- `create_outline_act` - Create an act within an outline (requires outlineId)
- `delete_outline_act` - Delete an act and all its chapters
- `create_outline_chapter` - Create a chapter within an act (requires actId)
- `delete_outline_chapter` - Delete a chapter

### Outline Replace Operations
- `replace_outline` - Replace outline fields (name, description)
- `replace_outline_act` - Replace act fields (name, description, order)
- `replace_outline_chapter` - Replace chapter fields (name, description, actId, order)

### Outline Patch Operations
- `patch_outline` - Patch outline using search-replace
- `patch_outline_act` - Patch act using search-replace (can also change order)
- `patch_outline_chapter` - Patch chapter using search-replace (can also change order/actId)

## Ordering

Both replace and patch operations for acts and chapters support an `order` field:
- Use 1-based positioning (order: 1 = first, order: 2 = second, etc.)
- When you change an element's order, siblings are automatically reordered
- Example: `{ "function": "replace_outline_act", "id": "act-123", "order": 2 }`

## Moving Chapters Between Acts

Use `replace_outline_chapter` with `actId` to move a chapter to a different act:
```json
{
  "function": "replace_outline_chapter",
  "id": "chapter-123",
  "actId": "new-act-id",
  "order": 1
}
```

## Guidelines

- Use `replace_*` when changing most of the content or for short fields
- Use `patch_*` for targeted changes in long descriptions
- For patch operations, ensure the `old` string is unique in the field
- Omit fields you don't need to change
- Use `order` to reposition acts within outline or chapters within act
- Use `actId` to move chapters between acts
