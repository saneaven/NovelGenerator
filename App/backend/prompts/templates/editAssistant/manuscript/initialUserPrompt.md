# Manuscript Editing Payload

Manuscript ID: `{{ editAssistant.manuscript.currentId }}`
Chapter: **{{ editAssistant.manuscript.currentChapterName }}**

{% with params = [editAssistant.manuscript.objectIds] %}{% include "fragment:common/projectContext/filtered" %}{% endwith %}

## Current Chapter Content

{{ editAssistant.manuscript.currentChapterManuscript }}

{% if input.userMessage %}
## User Request

{{ input.userMessage }}
{% endif %}
