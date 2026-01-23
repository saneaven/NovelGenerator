# Story Object Edit Request

{{prompt "common/projectContext/filtered" editAssistant.storyObject.contextIds}}

## Target Objects to Edit

{{#if (hasItems editAssistant.storyObject.targetIds)}}
{{#with editAssistant.storyObject.targetIds as |targetIds|}}

{{#each (filterByIds project.objects targetIds)}}
### {{ this.type }}: {{ this.name }} (ID: {{ this.id }})

{{ this.content }}

{{/each}}

{{#if project.outline}}
{{#each project.outline.outlines}}
{{#if (includes targetIds this.id)}}
### Outline: {{ this.name }} (ID: {{ this.id }})

{{ this.content }}

{{/if}}

{{#each (filterByIds this.acts targetIds)}}
### Act: {{ this.name }} (ID: {{ this.id }}, Outline: {{ ../name }})

{{ this.content }}

{{/each}}

{{#each this.acts}}
{{#each (filterByIds this.chapters targetIds)}}
### Chapter: {{ this.name }} (ID: {{ this.id }}, Act: {{ ../name }}, Outline: {{ ../../name }})

{{ this.content }}

{{/each}}
{{/each}}

{{/each}}
{{/if}}

{{/with}}
{{/if}}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}
