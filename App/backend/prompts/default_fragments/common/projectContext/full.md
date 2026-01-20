## Project Context

### Basic Information

- **Title**: {{ project.basicInfo.title }}
- **Logline**: {{ project.basicInfo.logline }}
- **Genre**: {{ project.basicInfo.genre }}

{{#if (hasItems (filterByType project.objects "character"))}}
### Characters

{{#each (filterByType project.objects "character")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType project.objects "organization"))}}
### Organizations

{{#each (filterByType project.objects "organization")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType project.objects "location"))}}
### Locations

{{#each (filterByType project.objects "location")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if (hasItems (filterByType project.objects "lorebook"))}}
### Lorebook

{{#each (filterByType project.objects "lorebook")}}
#### {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if project.outline}}
{{#each project.outline.outlines}}
### Story Outline - {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{#if (hasItems this.acts)}}
{{#each this.acts}}
#### Act: {{ this.name }} (id: {{ this.id }})

{{ this.description }}

{{#if (hasItems this.chapters)}}
**Chapters:**
{{#each this.chapters}}
- **{{ this.name }}** (id: {{ this.id }}): {{ this.description }}
{{/each}}
{{/if}}

{{/each}}
{{/if}}
{{/each}}
{{/if}}
