{{#if (or (hasItems agent.previousSummaries) (hasItems agent.relevantChats))}}
# Memory

{{#if (hasItems agent.previousSummaries)}}
## Previous Summary

{{#each agent.previousSummaries}}
{{this}}

{{/each}}
{{/if}}

{{#if (hasItems agent.relevantChats)}}
## Relevant Archived Chats

{{#each agent.relevantChats}}
<chat id="{{messageId}}" role="{{role}}">
{{#if (eq match.kind "tool_call")}}
{{#if toolCall}}
<function_call name="{{toolCall.name}}" status="{{toolCall.status}}">
<result>{{toolCall.result}}</result>
{{matched_snippet}}
</function_call>
{{/if}}
{{else}}
{{matched_snippet}}
{{/if}}
</chat>

{{/each}}
{{/if}}
{{/if}}
