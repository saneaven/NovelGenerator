# User Message Context

This system tag provides minimal context for non-last user messages (primarily function call results).

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