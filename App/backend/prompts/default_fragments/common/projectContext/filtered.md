## Project Context

{{!-- This fragment expects objectIds to be passed as the first positional parameter --}}
{{!-- Usage: {{prompt "common/projectContext/filtered" someContext.objectIds}} --}}

{{#if project.basicInfo}}
{{#if (hasItems (filterByIds (array project.basicInfo) params.[0]))}}
### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

{{/if}}
{{/if}}

{{#if (hasItems params.[0])}}
{{#with (filterByIds project.objects params.[0]) as |selectedObjects|}}

{{#if (hasItems (filterByType selectedObjects "character"))}}
### Characters

{{#each (filterByType selectedObjects "character")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "organization"))}}
### Organizations

{{#each (filterByType selectedObjects "organization")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "location"))}}
### Locations

{{#each (filterByType selectedObjects "location")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType selectedObjects "lorebook"))}}
### Lorebook

{{#each (filterByType selectedObjects "lorebook")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{/with}}

{{#if project.outline}}
{{#each project.outline.acts}}
{{#with (filterByIds this.chapters @root.params.[0]) as |selectedChapters|}}
{{#if (hasItems selectedChapters)}}
### Story Outline

#### Act: {{ ../name }} (id: {{ ../id }})

{{ ../description }}

**Chapters:**
{{#each selectedChapters}}
- **{{ this.name }}** (id: {{ this.id }}): {{ this.description }}
{{/each}}

{{/if}}
{{/with}}
{{/each}}
{{/if}}

{{#with (filterByIds project.manuscripts params.[0]) as |selectedManuscripts|}}
{{#if (hasItems selectedManuscripts)}}
### Reference Novel Content

{{#each selectedManuscripts}}
#### {{ this.chapterName }} (id: {{ this.id }})

{{ this.content }}

---
{{/each}}
{{/if}}
{{/with}}

{{/if}}
