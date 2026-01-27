Update the rolling memory summary using the previous summary and the new messages.

<language>
{{memorySummary.language}}
</language>

<previous_summary>
{{memorySummary.previousSummary}}
</previous_summary>

<messages archive_until_message_id="{{memorySummary.archiveUntilMessageId}}">
{{#each memorySummary.messages}}
<message id="{{this.messageId}}" role="{{this.role}}" created_at="{{this.createdAt}}">
{{this.content}}
</message>
{{/each}}
</messages>

Return the updated summary only.

