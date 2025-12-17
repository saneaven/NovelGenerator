# Translation Request

Translate the following content from **{{ translation.sourceLanguage }}** to **{{ translation.targetLanguage }}**.

{{#if input.userMessage}}
## Additional Instructions

{{ input.userMessage }}
{{/if}}

## Content to Translate ({{ translation.sourceLanguage }})

{{#if project.basicInfo}}
{{#if (hasItems (filterByIds (array project.basicInfo) translation.objectIds))}}
### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

{{/if}}
{{/if}}

{{#if (hasItems (filterByIds project.objects translation.objectIds))}}
### Story Objects

{{#with (filterByIds project.objects translation.objectIds) as |objectsToTranslate|}}
{{#each objectsToTranslate}}
#### {{ this.type }}: {{ this.name }} (ID: `{{ this.id }}`)

{{ this.description }}

{{/each}}
{{/with}}
{{/if}}

{{#if project.outline}}
{{#each project.outline.acts}}
{{#if (hasItems (filterByIds (array this) @root.translation.objectIds))}}
### Act: {{ this.name }} (ID: `{{ this.id }}`)

{{ this.description }}

{{/if}}
{{#if (hasItems (filterByIds this.chapters @root.translation.objectIds))}}
{{#with (filterByIds this.chapters @root.translation.objectIds) as |chaptersToTranslate|}}
{{#each chaptersToTranslate}}
### Chapter: {{ this.name }} (ID: `{{ this.id }}`)

{{ this.description }}

{{/each}}
{{/with}}
{{/if}}
{{/each}}
{{/if}}

{{#if (hasItems (filterByIds project.manuscripts translation.objectIds))}}
### Manuscripts

{{#with (filterByIds project.manuscripts translation.objectIds) as |manuscriptsToTranslate|}}
{{#each manuscriptsToTranslate}}
#### {{ this.chapterName }} (ID: `{{ this.id }}`)

{{ this.content }}

---
{{/each}}
{{/with}}
{{/if}}

{{#if (hasItems (getSubLanguageObjects project translation.targetLanguage translation.objectIds))}}
## Existing Translations ({{ translation.targetLanguage }}) - For Reference

Use these existing translations to maintain consistency in terminology and style:

{{#each (getSubLanguageObjects project translation.targetLanguage translation.objectIds)}}
### {{ this.type }}: {{ this.name }} (ID: `{{ this.id }}`)

{{ this.description }}

{{/each}}
{{/if}}

## Critical Instructions

**You MUST translate ALL content above** - do not skip any items.

{{#if config.isNativeOutputMode}}
Output your translations as a JSON array.

Requirements:
- Use the `id` from the source as the `id` field in your JSON output
- Maintain consistency in terminology, character names, and style across all content
- Include the appropriate translated fields based on object type:
  - For basic_info: id, title, logline, genre
  - For story objects (character, location, organization, lorebook): id, name, description
  - For act/chapter: id, name, description
  - For manuscript: id (chapterId), content

Example output format:
```json
[
  {"id": "basic-info-id", "title": "...", "logline": "...", "genre": "..."},
  {"id": "char-1", "name": "Translated Name", "description": "Translated description"},
  {"id": "chapter-1", "content": "Translated manuscript content..."}
]
```
{{else}}
You will make function calls (one per item).

Requirements:
- Use the `id` from the source as the `id` parameter
- Maintain consistency in terminology, character names, and style across all content
- Include the appropriate translated fields based on object type:
  - For basic_info: id, title, logline, genre
  - For story objects (character, location, organization, lorebook): id, name, description
  - For act/chapter: id, name, description
  - For manuscript: id (chapterId), content
{{/if}}
