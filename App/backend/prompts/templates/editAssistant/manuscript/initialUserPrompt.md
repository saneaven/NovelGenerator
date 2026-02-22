# Manuscript Editing Payload

Manuscript ID: `{{ editAssistant.manuscript.currentId }}`
Chapter: **{{ editAssistant.manuscript.currentChapterName }}**

{{ prompt("common/projectContext/filtered", objectIds=editAssistant.manuscript.objectIds) }}

## Current Chapter Content

{{ editAssistant.manuscript.currentChapterManuscript }}

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}
