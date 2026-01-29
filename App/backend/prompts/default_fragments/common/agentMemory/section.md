{{#if (or (hasItems agent.previousSummary) (hasItems agent.relevantChats))}}
# Memory

{{#if (hasItems agent.previousSummary)}}
## Previous Summary

{{#each agent.previousSummary}}
{{this}}

{{/each}}
{{/if}}

{{#if (hasItems agent.relevantChats)}}
## Relevant Archived Chats

{{#each agent.relevantChats}}
<chat id="{{this.messageId}}" role="{{this.role}}">
{{#if this.content}}
{{this.content}}
{{/if}}

{{#if this.toolCall}}
<function_call name="{{this.toolCall.name}}" status="{{this.toolCall.status}}">
<result>{{this.toolCall.result}}</result>
</function_call>
{{else}}
{{#if (hasItems this.toolCalls)}}
{{#each this.toolCalls}}
<function_call name="{{this.name}}" status="{{this.status}}">
<result>{{this.result}}</result>
</function_call>
{{/each}}
{{/if}}
{{/if}}
</chat>

{{/each}}
{{/if}}
{{/if}}
