{% set hasSummaries = (memory.summaries|length > 0) %}
{% set hasRagTexts = (memory.ragTexts|length > 0) %}
{% set hasHistoryChats = (memory.historyChats|length > 0) %}
{% if hasSummaries or hasRagTexts or hasHistoryChats %}
# Memory

{% if hasSummaries %}
## Summaries

{% for this in memory.summaries %}
{{ this }}

{% endfor %}
{% endif %}

{% if hasRagTexts %}
## Relevant Project Context

{% for this in memory.ragTexts %}
<rag_text object_type="{{ this.objectType }}" object_id="{{ this.objectId }}" field_path="{{ this.fieldPath }}" chunk_index="{{ this.chunkIndex }}">
{{ this.text }}
</rag_text>

{% endfor %}
{% endif %}

{% if hasHistoryChats %}
## Relevant Archived Chats

{% for this in memory.historyChats %}
<chat id="{{ this.messageId }}" role="{{ this.role }}">
{% if (this.match.kind == "tool_call") and this.toolCall %}
<function_call name="{{ this.toolCall.name }}" status="{{ this.toolCall.status }}">
<result>{{ this.toolCall.result }}</result>
{{ this.matchedSnippet }}
</function_call>
{% else %}
{{ this.matchedSnippet }}
{% endif %}
</chat>

{% endfor %}
{% endif %}
{% endif %}
