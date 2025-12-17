# Chapter Editing Payload

Chapter: **{{ editAssistant.manuscript.currentChapterName }}** (ID: `{{ editAssistant.manuscript.currentChapterId }}`)

{{#if project.basicInfo}}
## Project Context

### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

{{#if (hasItems editAssistant.manuscript.objectIds)}}
{{#with (filterByIds project.objects editAssistant.manuscript.objectIds) as |selectedObjects|}}

{{#if (hasItems (filterByType selectedObjects "character"))}}
### Characters

{{#each (filterByType selectedObjects "character")}}
#### {{ this.name }}

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "organization"))}}
### Organizations

{{#each (filterByType selectedObjects "organization")}}
#### {{ this.name }}

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "location"))}}
### Locations

{{#each (filterByType selectedObjects "location")}}
#### {{ this.name }}

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "lorebook"))}}
### Lorebook

{{#each (filterByType selectedObjects "lorebook")}}
#### {{ this.name }}

{{ this.description }}

{{/each}}
{{/if}}

{{/with}}

{{#if project.outline}}
{{#each project.outline.acts}}
{{#with (filterByIds this.chapters @root.editAssistant.manuscript.objectIds) as |selectedChapters|}}
{{#if (hasItems selectedChapters)}}
### Story Outline

#### Act: {{ ../name }}

{{ ../description }}

**Chapters:**
{{#each selectedChapters}}
- **{{ this.name }}**: {{ this.description }}
{{/each}}

{{/if}}
{{/with}}
{{/each}}
{{/if}}

{{#with (filterByIds project.manuscripts editAssistant.manuscript.objectIds) as |selectedManuscripts|}}
{{#if (hasItems selectedManuscripts)}}
### Reference Novel Content

{{#each selectedManuscripts}}
#### {{ this.chapterName }} ({{ this.wordCount }} words)

{{ this.content }}

---
{{/each}}
{{/if}}
{{/with}}

{{/if}}
{{/if}}

## Current Chapter Content

{{ editAssistant.manuscript.currentChapterManuscript }}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}
