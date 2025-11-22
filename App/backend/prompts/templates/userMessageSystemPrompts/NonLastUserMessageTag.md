# User Message Context

This system tag provides minimal context for non-last user messages (primarily function call results).

{% if context.functionResults.size > 0 %}
# Function Call Results
{% for result in context.functionResults %}
Function call {{ result.functionName }} was {% if result.success %}accepted{% else %}rejected{% endif %}. {{ result.resultMessage }}
{% endfor %}
{% endif %}