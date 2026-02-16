{% if (((agent.previousSummaries)|length > 0) or ((agent.relevantChats)|length > 0)) %}
# Memory

{% if ((agent.previousSummaries)|length > 0) %}
## Previous Summary

{% for this in agent.previousSummaries %}
{{ this }}

{% endfor %}
{% endif %}

{% if ((agent.relevantChats)|length > 0) %}
## Relevant Archived Chats

{% for this in agent.relevantChats %}
<chat id="{{ messageId }}" role="{{ role }}">
{% if (match.kind == "tool_call") %}
{% if toolCall %}
<function_call name="{{ toolCall.name }}" status="{{ toolCall.status }}">
<result>{{ toolCall.result }}</result>
{{ matched_snippet }}
</function_call>
{% endif %}
{% else %}
{{ matched_snippet }}
{% endif %}
</chat>

{% endfor %}
{% endif %}
{% endif %}
