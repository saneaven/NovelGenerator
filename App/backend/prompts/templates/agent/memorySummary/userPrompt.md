Update the rolling memory summary using the previous summary and the new messages.

<language>
{{ memorySummary.language }}
</language>

<previous_summary>
{{ memorySummary.previousSummary }}
</previous_summary>

<messages archive_until_message_id="{{ memorySummary.archiveUntilMessageId }}">
{% for this in memorySummary.messages %}
<message id="{{ this.messageId }}" role="{{ this.role }}" created_at="{{ this.createdAt }}">
{{ this.content }}
</message>
{% endfor %}
</messages>

Return the updated summary only.