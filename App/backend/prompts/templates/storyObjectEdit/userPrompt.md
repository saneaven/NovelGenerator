# Story Object Edit Request

{{#if project.basicInfo}}
## Project Context

### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

{{#if (hasItems storyObjectEdit.contextIds)}}
{{#with (filterByIds project.objects storyObjectEdit.contextIds) as |selectedObjects|}}

{{#if (hasItems (filterByType selectedObjects "character"))}}
### Characters

{{#each (filterByType selectedObjects "character")}}
- **{{ this.name }}** (ID: {{ this.id }}): {{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "organization"))}}
### Organizations

{{#each (filterByType selectedObjects "organization")}}
- **{{ this.name }}** (ID: {{ this.id }}): {{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "location"))}}
### Locations

{{#each (filterByType selectedObjects "location")}}
- **{{ this.name }}** (ID: {{ this.id }}): {{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "lorebook"))}}
### Lorebook

{{#each (filterByType selectedObjects "lorebook")}}
- **{{ this.name }}** (ID: {{ this.id }}): {{ this.description }}
{{/each}}
{{/if}}

{{/with}}

{{#if project.outline}}
{{#each project.outline.acts}}
{{#with (filterByIds this.chapters @root.storyObjectEdit.contextIds) as |selectedChapters|}}
{{#if (hasItems selectedChapters)}}
### Story Outline

#### Act: {{ ../name }} (ID: {{ ../id }})

{{ ../description }}

**Chapters:**
{{#each selectedChapters}}
- **{{ this.name }}** (ID: {{ this.id }}): {{ this.description }}
{{/each}}

{{/if}}
{{/with}}
{{/each}}
{{/if}}

{{/if}}
{{/if}}

## Target Objects to Edit

{{#if (hasItems storyObjectEdit.targetIds)}}
{{#each (filterByIds project.objects storyObjectEdit.targetIds)}}
### {{ this.type }}: {{ this.name }} (ID: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}
