# Edit Function Format

## Edit Operations

There are two types of edit operations:

### Replace Operation (`replace_*`)
Use for **full content replacement**:
- Short fields (names, titles)
- Complete rewrites
- New content creation

### Patch Operation (`patch_*`)
Use for **targeted search-and-replace edits**:
- Changing specific phrases in long text
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

### Example: Changing a phrase in a description

Original text:
```
A brave warrior with a scarred face. He fights alone in the mountains. His sword gleams in the moonlight.
```

To change "fights alone" to "leads a small band":
```json
{
  "id": "char-123",
  "type": "character",
  "replacements": [
    { "field": "description", "old": "He fights alone in the mountains", "new": "He leads a small band in the mountains" }
  ]
}
```

## Available Functions

### CRUD Operations
- `create_story_object` - Create a new story object (character, location, item, event, act, other)
- `delete_story_object` - Delete a story object
- `create_chapter` - Create a new chapter
- `delete_chapter` - Delete a chapter

### Replace Operations
- `replace_basic_info` - Replace basic info fields (title, logline, genre)
- `replace_story_object` - Replace story object fields
- `replace_chapter_outline` - Replace chapter outline fields (name, description, actId, order)

### Patch Operations
- `patch_basic_info` - Patch basic info using search-replace
- `patch_story_object` - Patch story object using search-replace
- `patch_chapter_outline` - Patch chapter outline using search-replace (can also change order)

## Chapter Ordering

Both `replace_chapter_outline` and `patch_chapter_outline` support an `order` field:
- Use 1-based positioning (order: 1 = first chapter, order: 2 = second, etc.)
- When you change a chapter's order, sibling chapters are automatically reordered
- Example: `{ "function": "replace_chapter_outline", "id": "ch-123", "order": 2 }`

## Guidelines

- Use `replace_*` when changing most of the content or for short fields
- Use `patch_*` for targeted changes in long descriptions
- For patch operations, ensure the `old` string is unique in the field
- Omit fields you don't need to change
- Use `order` to reposition chapters within their act
