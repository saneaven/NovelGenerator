# Chapter Editing Payload

Chapter: **{{ variable.chapterName }}**

{% if context.contextData %}
## Project Context

{{ context.contextData | json }}
{% endif %}

## Current Chapter Content

{{ variable.currentContent }}

{% if variable.userInput %}
## User Request

{{ variable.userInput }}
{% endif %}