## Project Context

{{!-- This fragment expects objectIds to be passed as the first positional parameter --}}
{{!-- Usage: {{prompt "common/projectContext/filtered" someContext.objectIds}} --}}

### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

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
{{#with (filterByIds project.outline.outlines params.[0]) as |selectedOutlines|}}
{{#each selectedOutlines}}
### Story Outline - {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{#with (filterByIds this.acts @root.params.[0]) as |selectedActs|}}
{{#if (hasItems selectedActs)}}
{{#each selectedActs}}
#### Act: {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{#with (filterByIds this.chapters @root.params.[0]) as |selectedChapters|}}
{{#if (hasItems selectedChapters)}}
**Chapters:**
{{#each selectedChapters}}
- **{{ this.name }}** (id: {{ this.id }}): {{ this.description }}
{{/each}}
{{/if}}
{{/with}}

{{/each}}
{{/if}}
{{/with}}
{{/each}}
{{/with}}
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
