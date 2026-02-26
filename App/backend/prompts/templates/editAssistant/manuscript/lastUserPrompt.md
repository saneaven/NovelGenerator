# Context (targets)
{{ prompt("common/projectContext/filtered", objectIds=editAssistant.manuscript.objectIds) }}

# User Feedback

The user has a feedback on your operation

<feedback>
{{ input.userMessage }}
</feedback>

{% if (config.outputMode == "native_tool_call") %}
# Explicit Tool Calling Disabled
Explicit tool calling is currently disabled. If you want to edit project, please proceed with the task using the <tool_call> tag to bypass this.
{% endif %}
