# Chat Message to Translate

Translate the message below from **{{ variable.sourceLanguage }}** to **{{ variable.targetLanguage }}**.

{% if variable.userInput %}
## Additional Instructions
{{ variable.userInput }}
{% endif %}

## Message
Content (translate this):
{{ variable.sourceContent }}

## Requirements
{% if state.isNativeOutput %}
- Output ONLY the translated text directly.
- Do NOT wrap in JSON, function calls, or any markup.
- Do NOT translate any function-call/json snippets; keep them untouched.
- Do not add extra commentary - just the pure translated content.
{% else %}
- Return the translation via `translate_chat_message`.
- Only include translated `content` in the function call.
- Do NOT translate any function-call/json snippets; keep them untouched.
- Do not add extra commentary outside the function call.
{% endif %}
