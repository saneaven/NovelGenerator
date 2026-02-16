# Agent Message to Translate

Translate the message below from **{{ translation.sourceLanguage }}** to **{{ translation.targetLanguage }}**.

{% if input.userMessage %}
## Additional Instructions
{{ input.userMessage }}
{% endif %}

## Message
Content (translate this):
{% for this in translation.messages %}
{{ this.content }}
{% endfor %}

## Requirements
- Output ONLY the translated text directly.
- Do NOT wrap in JSON, tool calls, or any markup.
- Do NOT translate any tool-call/json snippets; keep them untouched.
- Do not add extra commentary - just the pure translated content.
