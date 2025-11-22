# User Message Context

This system tag provides context information appended to the last user message in the conversation.

{% if context.functionResults.size > 0 %}
# Function Call Results
{% for result in context.functionResults %}
Function call {{ result.functionName }} was {% if result.success %}accepted{% else %}rejected{% endif %}. {{ result.resultMessage }}
{% endfor %}
{% endif %}

{% if context.storyContext %}
# Current Project Status
```json
{{ context.storyContext | json }}
```
{% endif %}

{% if context.novelContent %}
# Current Novel Content
```json
{{ context.novelContent | json }}
```
{% endif %}

{% if context.customSections.size > 0 %}
{% for section in context.customSections %}
# {{ section.heading }}
{% if section.format == 'json' %}
```json
{{ section.content | json }}
```
{% elsif section.format == 'text' %}
```text
{{ section.content }}
```
{% else %}
{{ section.content }}
{% endif %}
{% endfor %}
{% endif %}