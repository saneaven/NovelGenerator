# User Message Context

This system tag provides context information appended to the last user message in the conversation.

{% if context.functionResults.size > 0 %}
# Function Call Results

Based on your previous suggestions, the user made the following decisions:

{% for result in context.functionResults %}
{% if result.success %}
- {{ result.functionName }}: APPLIED - {{ result.resultMessage }}
{% elsif result.isRejected %}
- {{ result.functionName }}: REJECTED BY USER - User chose not to apply this change
{% else %}
- {{ result.functionName }}: FAILED - {{ result.resultMessage }}
{% endif %}
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

# Language Instruction
You must use {{ variable.language }} only.