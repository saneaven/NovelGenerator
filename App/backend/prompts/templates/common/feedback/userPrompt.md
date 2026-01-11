{{! Feedback Template }}

# User Feedback

The user has a feedback on your operation

<feedback>
{{ input.userMessage }}
</feedback>

{{#if config.isNativeFunctionCallMode}}
# Explit Function Calling Disabled
Explicit function calling (tool call) is currently disabled. If you want to edit project, please proceed with the task using the <function_calls> tag to bypass this.
{{/if}}