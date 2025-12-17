{{#if (hasItems input.functionResults)}}
# Function Call Results

Based on your previous suggestions, the user made the following decisions:

{{#each input.functionResults}}
{{#if this.success}}
- {{ this.functionName }}: APPLIED - {{ this.resultMessage }}
{{else}}
{{#if this.isRejected}}
- {{ this.functionName }}: REJECTED BY USER - User chose not to apply this change
{{else}}
- {{ this.functionName }}: FAILED - {{ this.resultMessage }}
{{/if}}
{{/if}}
{{/each}}
{{/if}}

{{#if project.basicInfo}}
# Current Project Status

## Basic Info
- **Title**: {{ project.basicInfo.title }}
{{#if project.basicInfo.logline}}- **Logline**: {{ project.basicInfo.logline }}{{/if}}
{{#if project.basicInfo.genre}}- **Genre**: {{ project.basicInfo.genre }}{{/if}}

{{#if (hasItems (filterByType project.objects "character"))}}
## Characters
{{#each (filterByType project.objects "character")}}
### {{ this.name }} (id: {{ this.id }})
{{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType project.objects "organization"))}}
## Organizations
{{#each (filterByType project.objects "organization")}}
### {{ this.name }} (id: {{ this.id }})
{{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType project.objects "location"))}}
## Locations
{{#each (filterByType project.objects "location")}}
### {{ this.name }} (id: {{ this.id }})
{{ this.description }}
{{/each}}
{{/if}}

{{#if (hasItems (filterByType project.objects "lorebook"))}}
## Lorebook
{{#each (filterByType project.objects "lorebook")}}
### {{ this.name }} (id: {{ this.id }})
{{ this.description }}
{{/each}}
{{/if}}

{{#if project.outline}}
{{#if (hasItems project.outline.acts)}}
## Story Outline
{{#each project.outline.acts}}
### {{ this.name }} (id: {{ this.id }})
{{ this.description }}
{{#each this.chapters}}
- **{{ this.name }}** (id: {{ this.id }}): {{ this.description }}
{{/each}}
{{/each}}
{{/if}}
{{/if}}
{{/if}}

# Language Instruction
You must use {{ config.mainLanguage }} only.

# User Message

{{ input.userMessage }}