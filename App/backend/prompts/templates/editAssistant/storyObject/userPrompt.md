# Story Object Edit Request

{{prompt "common/projectContext/filtered" editAssistant.storyObject.contextIds}}

## Target Objects to Edit

{{#if (hasItems editAssistant.storyObject.targetIds)}}
{{#each (filterByIds project.objects editAssistant.storyObject.targetIds)}}
### {{ this.type }}: {{ this.name }} (ID: {{ this.id }})

{{ this.description }}

{{/each}}
{{/if}}

{{#if input.userMessage}}
## User Request

{{ input.userMessage }}
{{/if}}
