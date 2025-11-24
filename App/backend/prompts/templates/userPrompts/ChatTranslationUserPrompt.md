# Chat Message to Translate

Translate the message below from **{{ variable.sourceLanguage }}** to **{{ variable.targetLanguage }}**.

{% if variable.userInstructions %}
## Additional Instructions
{{ variable.userInstructions }}
{% endif %}

## Message
Content (translate this):
{{ variable.sourceContent }}

## Requirements
- Return the translation via `translate_chat_message`.
- Only include translated `content` in the function call.
- Do NOT translate any function-call/json snippets; keep them untouched.
- Do not add extra commentary outside the function call.
