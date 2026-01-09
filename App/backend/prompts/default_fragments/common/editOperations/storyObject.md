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

## Patch Format (Search & Replace)

Each patch operation applies a single search-and-replace:

```json
{
  "id": "char-123",
  "type": "character",
  "field": "description",
  "old": "text to find",
  "new": "replacement text"
}
```

**Important Rules:**
- The `old` string must be **unique** in the field - include enough context to ensure uniqueness
- If multiple matches exist, add more surrounding text to `old` to make it unique
- For multiple changes, make multiple patch function calls

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
  "field": "description",
  "old": "He fights alone in the mountains",
  "new": "He leads a small band in the mountains"
}
```

### Example: Multiple changes

For multiple edits, call patch_story_object multiple times:
```json
// First patch call
{ "id": "char-123", "type": "character", "field": "description", "old": "fights alone", "new": "leads a small band" }

// Second patch call
{ "id": "char-123", "type": "character", "field": "description", "old": "His sword gleams", "new": "His banner waves" }
```

## Available Functions

### CRUD Operations
- `create_story_object` - Create a new story object (character, location, organization, lorebook)
- `delete_story_object` - Delete a story object

### Replace Operations
- `replace_basic_info` - Replace basic info fields (title, logline, genre)
- `replace_story_object` - Replace story object fields (name, description)

### Patch Operations
- `patch_basic_info` - Patch basic info using search-replace (single edit per call)
- `patch_story_object` - Patch story object using search-replace (single edit per call)

## Guidelines

- Use `replace_*` when changing most of the content or for short fields
- Use `patch_*` for targeted changes in long descriptions
- For patch operations, ensure the `old` string is unique in the field
- For multiple edits, make multiple patch calls
- Omit fields you don't need to change
